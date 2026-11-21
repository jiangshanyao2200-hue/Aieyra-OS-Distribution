// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/userdata/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: migrationLock; journalName; transferWork; transferJournal; migrationHooks; Migrate; migrate; samePath; overlaps; sourceRoots; nonce; writeJSON; inventorySHA; readJournal; sourceReader; sourceHash; fileHash; copyEntry; verifyDestination; inventoryDifference; sameInventory; CancelMigration
// Impact: python -B scripts/code-atlas.py show Core/userdata/migrate.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package userdata

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"time"

	"github.com/aieyra/aieyra-os/CORE/internal/privatefile"
	"github.com/aieyra/aieyra-os/CORE/platform"
	"github.com/aieyra/aieyra-os/CORE/sessionservice"
	"github.com/aieyra/aieyra-os/contracts/storage"
)

const migrationLock = ".aieyra-migration-owner.lock"
const journalName = ".aieyra-transfer.json"
const transferWork = ".aieyra-transfer-work"

type transferJournal struct {
	Schema    int               `json:"schema"`
	Cancelled bool              `json:"cancelled,omitempty"`
	Migration storage.Migration `json:"migration"`
	Inventory inventory         `json:"inventory"`
}
type migrationHooks struct {
	checkpoint func(string) error
	processes  func(string, string, string) ([]int, error)
}

// Migrate performs an offline, resumable copy. Originals remain byte-for-byte
// intact. A durable source barrier prevents new clients from reopening them.
func Migrate(ctx context.Context, config, destination string) (storage.Profile, error) {
	return migrate(ctx, config, destination, migrationHooks{processes: platform.ActiveProfileProcesses})
}
func migrate(ctx context.Context, config, destination string, hooks migrationHooks) (storage.Profile, error) {
	fail := func(err error) (storage.Profile, error) { return storage.Profile{}, err }
	check := func(stage string) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		if hooks.checkpoint != nil {
			return hooks.checkpoint(stage)
		}
		return nil
	}
	source, err := storage.Inspect(config)
	if err != nil {
		return fail(err)
	}
	if strings.TrimSpace(destination) == "" {
		return fail(fmt.Errorf("migration destination is required"))
	}
	destination, err = filepath.Abs(destination)
	if err != nil {
		return fail(err)
	}
	for _, root := range sourceRoots(source) {
		if overlaps(root, destination) {
			return fail(fmt.Errorf("migration source and destination must not overlap"))
		}
	}
	for _, p := range []string{source.Config, source.Root, destination, filepath.Join(source.Root, migrationLock)} {
		if err = ordinary(p); err != nil {
			return fail(err)
		}
	}
	if err = validateConfig(source.Config); err != nil {
		return fail(err)
	}
	// Source root must already exist. Migration never invents a legacy profile.
	st, err := os.Stat(source.Root)
	if err != nil {
		return fail(err)
	}
	if !st.IsDir() {
		return fail(fmt.Errorf("source data root is not a directory"))
	}
	unlock, err := sessionservice.Lock(filepath.Join(source.Root, migrationLock))
	if err != nil {
		return fail(fmt.Errorf("another migration owns this source: %w", err))
	}
	defer unlock()
	m, err := storage.ReadMigration(source.Root, storage.MigrationBarrier)
	if err != nil {
		return fail(err)
	}
	fresh := m == nil
	started := false
	if fresh {
		// Do not momentarily fence clients which are already using this profile.
		// The second scan after publication still closes the new-owner race.
		owners, e := storage.Owners(source.Root)
		if e != nil {
			return fail(e)
		}
		if len(owners) > 0 {
			return fail(fmt.Errorf("profile is in use by %d registered processes; close them before migration", len(owners)))
		}
		m = &storage.Migration{Schema: 1, ID: nonce(), State: "copying", SourceConfig: source.Config, SourceRoot: source.Root, Destination: destination, ProfileID: nonce()}
		if source.Unified {
			m.ProfileID = source.ID
		}
		if err = writeJSON(filepath.Join(source.Root, storage.MigrationBarrier), m); err != nil {
			return fail(err)
		}
	} else if !samePath(m.SourceConfig, source.Config) || !samePath(m.SourceRoot, source.Root) || !samePath(m.Destination, destination) {
		return fail(fmt.Errorf("source belongs to a different migration; originals retained"))
	}
	// Refusal before a durable destination transaction does not strand the
	// source. Once copying begins, only resuming this exact move can release it.
	defer func() {
		if fresh && !started {
			_ = os.Remove(filepath.Join(source.Root, storage.MigrationBarrier))
		}
	}()
	if m.State == "complete" {
		resolved, e := storage.ResolveConfig(source.Config)
		if e != nil {
			return fail(e)
		}
		return storage.Bind(resolved)
	}
	inactive := func() error {
		owners, e := storage.Owners(source.Root)
		if e != nil {
			return e
		}
		if len(owners) > 0 {
			return fmt.Errorf("profile is in use by %d registered processes; close them before migration", len(owners))
		}
		if hooks.processes == nil {
			return fmt.Errorf("legacy process inspection is required")
		}
		pids, e := hooks.processes(platform.AppRoot(), source.Config, source.Root)
		if e != nil {
			return e
		}
		if len(pids) > 0 {
			return fmt.Errorf("profile is in use by %d older processes; close them before migration", len(pids))
		}
		return nil
	}
	if err = inactive(); err != nil {
		return fail(err)
	}
	if err = check("fenced"); err != nil {
		return fail(err)
	}
	if err = os.MkdirAll(destination, 0700); err != nil {
		return fail(err)
	}
	if err = ordinary(filepath.Join(destination, lockName)); err != nil {
		return fail(err)
	}
	releaseTarget, err := sessionservice.Lock(filepath.Join(destination, lockName))
	if err != nil {
		return fail(fmt.Errorf("migration destination is in use: %w", err))
	}
	defer releaseTarget()
	journal, err := readJournal(destination)
	if err != nil {
		return fail(err)
	}
	marker, err := storage.ReadMarker(destination)
	if err != nil {
		return fail(err)
	}
	if journal != nil {
		if journal.Cancelled {
			return fail(fmt.Errorf("destination belongs to a cancelled transfer; choose an empty directory"))
		}
		if journal.Migration != *m {
			return fail(fmt.Errorf("destination belongs to a different migration"))
		}
		started = true
		if marker != nil && (marker.ID != m.ProfileID || marker.State != "migrating" && marker.State != "ready") {
			return fail(fmt.Errorf("destination declaration does not match migration"))
		}
		if marker != nil && marker.State == "ready" {
			// Verification is sealed before ready. The destination may already have
			// new user writes; recovery must never recopy or compare them to the past.
			completed := *m
			completed.State = "complete"
			completed.InventorySHA = inventorySHA(journal.Inventory)
			receipt, e := storage.ReadMigration(destination, storage.MigrationReceiptFile)
			if e != nil {
				return fail(e)
			}
			if receipt == nil || *receipt != completed {
				return fail(fmt.Errorf("ready destination has no matching verification receipt"))
			}
			if err = writeJSON(filepath.Join(source.Root, storage.MigrationBarrier), completed); err != nil {
				return fail(err)
			}
			return storage.Bind(filepath.Join(destination, "Config", "config.json"))
		}
	} else {
		entries, e := os.ReadDir(destination)
		if e != nil {
			return fail(e)
		}
		for _, entry := range entries {
			if entry.Name() != lockName {
				return fail(fmt.Errorf("migration destination must be empty or belong to this interrupted transfer"))
			}
		}
	}
	current, err := legacyInventory(source, m.ProfileID)
	if err != nil {
		return fail(err)
	}
	locked := map[string]*os.File{}
	defer func() {
		for _, f := range locked {
			_ = f.Close()
		}
	}()
	for _, entry := range current.Files {
		if !entry.Directory && strings.HasSuffix(strings.ToLower(entry.Source), ".lock") {
			f, e := sessionservice.OpenLocked(entry.Source)
			if e != nil {
				return fail(fmt.Errorf("source still has an active file owner: %w", e))
			}
			locked[entry.Source] = f
		}
	}
	for i := range current.Files {
		entry := &current.Files[i]
		if entry.Directory {
			continue
		}
		if err = check("hashing"); err != nil {
			return fail(err)
		}
		entry.SHA256, err = sourceHash(*entry, locked)
		if err != nil {
			return fail(err)
		}
	}
	if journal != nil {
		if !sameInventory(current, journal.Inventory) {
			return fail(fmt.Errorf("migration source changed after the transfer started (%s); originals and partial destination retained", inventoryDifference(journal.Inventory, current)))
		}
		current = journal.Inventory
	} else {
		journal = &transferJournal{Schema: 1, Migration: *m, Inventory: current}
		if err = writeJSON(filepath.Join(destination, journalName), journal); err != nil {
			return fail(err)
		}
		started = true
	}
	if marker == nil {
		if err = writeMarker(destination, storage.Marker{Schema: storage.ProfileSchema, ID: m.ProfileID, State: "migrating", Config: "Config/config.json"}); err != nil {
			return fail(err)
		}
	}
	if err = check("declared"); err != nil {
		return fail(err)
	}
	for _, entry := range current.Files {
		if err = check("copying"); err != nil {
			return fail(err)
		}
		if err = copyEntry(destination, entry, locked); err != nil {
			return fail(err)
		}
		if err = check("copied:" + entry.Target); err != nil {
			return fail(err)
		}
	}
	if err = validateConfig(filepath.Join(destination, "Config", "config.json")); err != nil {
		return fail(err)
	}
	if err = writeJSON(filepath.Join(destination, storage.OriginsFile), current.Origins); err != nil {
		return fail(err)
	}
	// Re-enumerate and hash the source, and verify every completed destination.
	// New files, source edits, short writes and destination collisions all refuse
	// activation; no user transcript or opaque database is interpreted or edited.
	again, err := legacyInventory(source, m.ProfileID)
	if err != nil {
		return fail(err)
	}
	for i := range again.Files {
		entry := &again.Files[i]
		if entry.Directory {
			continue
		}
		entry.SHA256, err = sourceHash(*entry, locked)
		if err != nil {
			return fail(err)
		}
	}
	if !sameInventory(again, current) {
		return fail(fmt.Errorf("source changed while copying (%s); transfer was not activated", inventoryDifference(current, again)))
	}
	if err = verifyDestination(destination, current); err != nil {
		return fail(err)
	}
	if err = inactive(); err != nil {
		return fail(err)
	}
	if err = check("verified"); err != nil {
		return fail(err)
	}
	completed := *m
	completed.State = "complete"
	completed.InventorySHA = inventorySHA(current)
	if err = writeJSON(filepath.Join(destination, storage.MigrationReceiptFile), completed); err != nil {
		return fail(err)
	}
	if err = check("sealed"); err != nil {
		return fail(err)
	}
	if err = writeMarker(destination, storage.Marker{Schema: storage.ProfileSchema, ID: m.ProfileID, State: "ready", Config: "Config/config.json"}); err != nil {
		return fail(err)
	}
	if err = check("ready"); err != nil {
		return fail(err)
	}
	if err = writeJSON(filepath.Join(source.Root, storage.MigrationBarrier), completed); err != nil {
		return fail(err)
	}
	if err = check("complete"); err != nil {
		return fail(err)
	}
	return storage.Bind(filepath.Join(destination, "Config", "config.json"))
}

func samePath(a, b string) bool { return strings.EqualFold(filepath.Clean(a), filepath.Clean(b)) }
func overlaps(a, b string) bool {
	inside := func(parent, child string) bool {
		r, e := filepath.Rel(parent, child)
		return e == nil && (r == "." || r != ".." && !strings.HasPrefix(r, ".."+string(filepath.Separator)) && !filepath.IsAbs(r))
	}
	return inside(a, b) || inside(b, a)
}
func sourceRoots(p storage.Profile) []string {
	roots := []string{p.Root}
	if !p.Unified && strings.EqualFold(filepath.Base(filepath.Dir(p.Config)), "Config") {
		roots = append(roots, filepath.Dir(p.Config), filepath.Join(p.Overrides, "Prompt"))
	}
	return roots
}
func nonce() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b[:])
}
func writeJSON(file string, value any) error {
	if err := ordinary(file); err != nil {
		return err
	}
	b, err := json.Marshal(value)
	if err != nil {
		return err
	}
	if len(b) > 64<<20 {
		return fmt.Errorf("migration metadata exceeds size limit")
	}
	return privatefile.Write(file, append(b, '\n'))
}
func inventorySHA(value inventory) string {
	b, _ := json.Marshal(value)
	return fmt.Sprintf("%x", sha256.Sum256(b))
}
func readJournal(root string) (*transferJournal, error) {
	file := filepath.Join(root, journalName)
	if err := ordinary(file); err != nil {
		return nil, err
	}
	st, err := os.Lstat(file)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if !st.Mode().IsRegular() || st.Size() > 64<<20 {
		return nil, fmt.Errorf("invalid transfer journal")
	}
	f, err := os.Open(file)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	var j transferJournal
	d := json.NewDecoder(io.LimitReader(f, (64<<20)+1))
	d.DisallowUnknownFields()
	if d.Decode(&j) != nil || d.Decode(new(any)) != io.EOF || j.Schema != 1 || len(j.Inventory.Files) > 100000 {
		return nil, fmt.Errorf("damaged transfer journal; originals retained")
	}
	return &j, nil
}
func sourceReader(entry transferFile, locked map[string]*os.File) (io.Reader, func(), error) {
	if f := locked[entry.Source]; f != nil {
		return io.NewSectionReader(f, 0, entry.Bytes+1), func() {}, nil
	}
	if err := ordinary(entry.Source); err != nil {
		return nil, nil, err
	}
	f, err := os.Open(entry.Source)
	if err != nil {
		return nil, nil, err
	}
	st, err := f.Stat()
	if err != nil || !st.Mode().IsRegular() || st.Size() != entry.Bytes || st.ModTime().UnixNano() != entry.Modified {
		f.Close()
		return nil, nil, fmt.Errorf("source file changed during migration")
	}
	return io.LimitReader(f, entry.Bytes+1), func() { _ = f.Close() }, nil
}
func sourceHash(entry transferFile, locked map[string]*os.File) (string, error) {
	r, close, err := sourceReader(entry, locked)
	if err != nil {
		return "", err
	}
	defer close()
	h := sha256.New()
	n, err := io.Copy(h, r)
	if err != nil {
		return "", err
	}
	if n != entry.Bytes {
		return "", fmt.Errorf("source size changed during migration")
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}
func fileHash(file string) (string, int64, error) {
	if err := ordinary(file); err != nil {
		return "", 0, err
	}
	f, err := os.Open(file)
	if err != nil {
		return "", 0, err
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		return "", 0, err
	}
	if !st.Mode().IsRegular() {
		return "", 0, fmt.Errorf("destination is not a regular file")
	}
	h := sha256.New()
	n, err := io.Copy(h, f)
	return hex.EncodeToString(h.Sum(nil)), n, err
}
func copyEntry(root string, entry transferFile, locked map[string]*os.File) error {
	target := filepath.Join(root, filepath.FromSlash(entry.Target))
	if err := ordinary(target); err != nil {
		return err
	}
	if entry.Directory {
		return os.MkdirAll(target, 0700)
	}
	if _, err := os.Lstat(target); err == nil {
		hash, n, e := fileHash(target)
		if e != nil {
			return e
		}
		if n != entry.Bytes || hash != entry.SHA256 {
			return fmt.Errorf("destination conflict; existing file retained: %s", entry.Target)
		}
		return nil
	} else if !os.IsNotExist(err) {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(target), 0700); err != nil {
		return err
	}
	work := filepath.Join(root, transferWork)
	if err := ordinary(work); err != nil {
		return err
	}
	if err := os.MkdirAll(work, 0700); err != nil {
		return err
	}
	temp, err := privatefile.CreateTemporary(work)
	if err != nil {
		return err
	}
	defer os.Remove(temp.Name())
	r, close, err := sourceReader(entry, locked)
	if err != nil {
		temp.Close()
		return err
	}
	defer close()
	h := sha256.New()
	n, err := io.Copy(io.MultiWriter(temp, h), r)
	if err == nil && (n != entry.Bytes || hex.EncodeToString(h.Sum(nil)) != entry.SHA256) {
		err = fmt.Errorf("source digest changed during copy")
	}
	if err == nil {
		err = temp.Chmod(0600 | fs.FileMode(entry.Mode)&0100)
	}
	if err == nil {
		err = temp.Sync()
	}
	if e := temp.Close(); err == nil {
		err = e
	}
	if err != nil {
		return err
	}
	if err = os.Chtimes(temp.Name(), time.Unix(0, entry.Modified), time.Unix(0, entry.Modified)); err != nil {
		return err
	}
	// Publishing with link is atomic and never replaces an existing file.
	return os.Link(temp.Name(), target)
}
func verifyDestination(root string, inv inventory) error {
	allowed := map[string]bool{".": true, lockName: true, journalName: true, storage.ProfileMarker: true, storage.OriginsFile: true, storage.MigrationReceiptFile: true}
	for _, entry := range inv.Files {
		for p := filepath.FromSlash(entry.Target); p != "."; p = filepath.Dir(p) {
			allowed[filepath.ToSlash(p)] = true
		}
		target := filepath.Join(root, filepath.FromSlash(entry.Target))
		if entry.Directory {
			st, err := os.Stat(target)
			if err != nil {
				return err
			}
			if !st.IsDir() {
				return fmt.Errorf("destination directory replaced")
			}
			continue
		}
		hash, n, err := fileHash(target)
		if err != nil {
			return err
		}
		if n != entry.Bytes || hash != entry.SHA256 {
			return fmt.Errorf("destination verification failed: %s", entry.Target)
		}
	}
	return filepath.WalkDir(root, func(file string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if err = ordinary(file); err != nil {
			return err
		}
		rel, err := filepath.Rel(root, file)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)
		if rel == transferWork {
			return filepath.SkipDir
		}
		if !allowed[rel] {
			return fmt.Errorf("unexpected destination file; retained: %s", rel)
		}
		return nil
	})
}

func inventoryDifference(a, b inventory) string {
	if len(a.Files) != len(b.Files) {
		return "file count"
	}
	for i := range a.Files {
		if a.Files[i] != b.Files[i] {
			return fmt.Sprintf("%s: size %d/%d, modified %d/%d, mode %d/%d, digest differs %t", a.Files[i].Target, a.Files[i].Bytes, b.Files[i].Bytes, a.Files[i].Modified, b.Files[i].Modified, a.Files[i].Mode, b.Files[i].Mode, a.Files[i].SHA256 != b.Files[i].SHA256)
		}
	}
	return "ownership mapping"
}

// Directory timestamps can settle after child handles close on Windows. A full
// entry list and every file digest establish contents; directory mtime does not.
func sameInventory(a, b inventory) bool {
	normalize := func(v inventory) inventory {
		v.Files = append([]transferFile(nil), v.Files...)
		for i := range v.Files {
			if v.Files[i].Directory {
				v.Files[i].Modified = 0
				v.Files[i].Bytes = 0
			}
		}
		return v
	}
	return reflect.DeepEqual(normalize(a), normalize(b))
}

// CancelMigration releases an interrupted source without deleting either copy.
// A sealed, ready destination may already have user writes and cannot be undone.
func CancelMigration(config, destination string) error {
	source, err := storage.Inspect(config)
	if err != nil {
		return err
	}
	destination, err = filepath.Abs(destination)
	if err != nil {
		return err
	}
	for _, p := range []string{source.Root, destination, filepath.Join(source.Root, migrationLock)} {
		if err = ordinary(p); err != nil {
			return err
		}
	}
	unlock, err := sessionservice.Lock(filepath.Join(source.Root, migrationLock))
	if err != nil {
		return err
	}
	defer unlock()
	m, err := storage.ReadMigration(source.Root, storage.MigrationBarrier)
	if err != nil {
		return err
	}
	if m == nil || m.State != "copying" || !samePath(m.SourceConfig, source.Config) || !samePath(m.Destination, destination) {
		return fmt.Errorf("no matching interrupted migration to cancel")
	}
	if _, err = os.Stat(destination); os.IsNotExist(err) {
		return os.Remove(filepath.Join(source.Root, storage.MigrationBarrier))
	} else if err != nil {
		return err
	}
	if err = ordinary(filepath.Join(destination, lockName)); err != nil {
		return err
	}
	release, err := sessionservice.Lock(filepath.Join(destination, lockName))
	if err != nil {
		return err
	}
	defer release()
	marker, err := storage.ReadMarker(destination)
	if err != nil {
		return err
	}
	if marker != nil && (marker.ID != m.ProfileID || marker.State != "migrating") {
		return fmt.Errorf("destination is already active or belongs to another profile")
	}
	journal, err := readJournal(destination)
	if err != nil {
		return err
	}
	if journal != nil {
		if journal.Migration != *m {
			return fmt.Errorf("destination transaction does not match source")
		}
		journal.Cancelled = true
		if err = writeJSON(filepath.Join(destination, journalName), journal); err != nil {
			return err
		}
	} else if marker != nil {
		return fmt.Errorf("destination journal is missing; retain originals for recovery")
	}
	return os.Remove(filepath.Join(source.Root, storage.MigrationBarrier))
}

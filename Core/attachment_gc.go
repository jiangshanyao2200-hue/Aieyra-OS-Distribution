// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: attachmentHashPattern; attachmentHashRunPattern; attachmentGCResult; attachmentUsagePath; attachmentLease; collectAttachments; scanAttachmentReferences; rememberAttachmentJSON
// Impact: python -B scripts/code-atlas.py show Core/attachment_gc.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"bufio"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"fmt"
	"github.com/aieyra/aieyra-os/contracts/storage"
	"io"
	"io/fs"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

var attachmentHashPattern = regexp.MustCompile(`[a-f0-9]{64}`)
var attachmentHashRunPattern = regexp.MustCompile(`[a-f0-9]{64,}`)

type attachmentGCResult struct {
	Removed  int    `json:"removed"`
	Bytes    int64  `json:"bytes"`
	Retained int    `json:"retained"`
	Skipped  string `json:"skipped,omitempty"`
}

func attachmentUsagePath(config string) (string, error) {
	if err := ValidatePrivateProfile(config); err != nil {
		return "", err
	}
	dir := PrivatePaths(config).Runtime
	if err := os.MkdirAll(dir, 0700); err != nil {
		return "", err
	}
	if !ordinaryRuntimeDirectory(dir) {
		return "", fmt.Errorf("attachment runtime is redirected")
	}
	p := filepath.Join(dir, "attachment-usage-v2.lock")
	if st, err := os.Lstat(p); err == nil && !st.Mode().IsRegular() {
		return "", fmt.Errorf("attachment lock is redirected")
	} else if err != nil && !os.IsNotExist(err) {
		return "", err
	}
	return p, nil
}

func attachmentLease(config string) (func(), error) {
	release, err := storage.Enter(config)
	if err != nil {
		return nil, err
	}
	p, err := attachmentUsagePath(config)
	if err != nil {
		release()
		return nil, err
	}
	unlock, err := lockAttachmentUsage(p, false)
	if err != nil {
		release()
		return nil, err
	}
	return func() { unlock(); release() }, nil
}

// Only v2 snapshots with an exact creation record can be collected. The old
// namespace is never touched. Unreadable references make the whole pass retain.
func collectAttachments(config string) (result attachmentGCResult) {
	releaseOwner, ownerErr := storage.Enter(config)
	if ownerErr != nil {
		result.Skipped = "profile_invalid"
		return result
	}
	defer releaseOwner()
	if err := ValidatePrivateProfile(config); err != nil {
		result.Skipped = "profile_invalid"
		return result
	}
	fail := func(reason string) attachmentGCResult { result.Skipped = reason; return result }
	paths := PrivatePaths(config)
	assetRoot, err := filepath.Abs(PrivatePaths(config).Attachments)
	if err != nil {
		return fail("asset_directory")
	}
	assets := filepath.Join(assetRoot, "v2")
	if _, err = os.Lstat(assets); os.IsNotExist(err) {
		return result
	}
	for _, dir := range []string{paths.Runtime, filepath.Dir(assets), assets} {
		if !ordinaryRuntimeDirectory(dir) {
			return fail("asset_directory")
		}
	}
	lock, err := attachmentUsagePath(config)
	if err != nil {
		return fail("usage_lock")
	}
	release, err := lockAttachmentUsage(lock, true)
	if err != nil {
		return fail("active_context")
	}
	defer release()
	assetEntries, err := os.ReadDir(assets)
	if err != nil {
		return fail("catalog_unreadable")
	}
	known := map[string]bool{}
	for _, entry := range assetEntries {
		h := strings.TrimSuffix(entry.Name(), ".json")
		if len(h) == 64 && strings.HasSuffix(entry.Name(), ".json") && attachmentHashPattern.MatchString(h) {
			known[h] = true
		}
	}
	if len(known) == 0 {
		return result
	}
	if len(known) > 20000 {
		return fail("catalog_limit")
	}

	// Old versions do not know the v2 usage lock. Hold their known session and
	// manager locks too; uncertain or live discovery records retain everything.
	discovery := paths.MatrixAPI
	if _, e := os.Lstat(discovery); e == nil && !ordinaryRuntimeDirectory(discovery) {
		return fail("discovery_directory")
	} else if e != nil && !os.IsNotExist(e) {
		return fail("discovery_unreadable")
	}
	entries, err := os.ReadDir(discovery)
	if err != nil && !os.IsNotExist(err) {
		return fail("discovery_unreadable")
	}
	for _, entry := range entries {
		if !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		p := filepath.Join(paths.MatrixAPI, entry.Name())
		st, e := os.Lstat(p)
		if e != nil || !st.Mode().IsRegular() || st.Size() > 65536 {
			return fail("discovery_invalid")
		}
		data, e := os.ReadFile(p)
		var descriptor struct {
			PID int `json:"pid"`
		}
		if e != nil || json.Unmarshal(data, &descriptor) != nil || !attachmentProcessAbsent(descriptor.PID) {
			return fail("legacy_context")
		}
	}
	var refs = map[string]bool{}
	remember := func(value string) {
		for _, run := range attachmentHashRunPattern.FindAllString(value, -1) {
			for i := 0; i+64 <= len(run); i++ {
				h := run[i : i+64]
				if known[h] {
					refs[h] = true
				}
			}
		}
	}
	var locks []func()
	defer func() {
		for i := len(locks) - 1; i >= 0; i-- {
			locks[i]()
		}
	}()
	locked := map[string]bool{}
	takeLock := func(p string) error {
		if locked[p] {
			return nil
		}
		if st, e := os.Lstat(p); e == nil && !st.Mode().IsRegular() {
			return fmt.Errorf("redirected legacy lock")
		} else if e != nil && !os.IsNotExist(e) {
			return e
		}
		u, e := lockSession(p)
		if e != nil {
			return e
		}
		locks = append(locks, u)
		locked[p] = true
		return nil
	}
	var files []string
	var size int64
	// Every durable executor/archive namespace can hold attachment references.
	// The global usage lease excludes current writers; old kernel locks remain
	// checked below. Never infer retention solely from a running task window.
	for _, source := range []struct{ root, lease string }{
		{paths.Sessions, ""}, {paths.Tasks, "manager"}, {paths.Conversations, ""},
		{paths.Workspaces, ""}, {paths.CLIWorkspaces, ""}, {paths.Reports, ""},
		{paths.Memory, ""}, {paths.Context, ""}, {paths.Agents, "manager"},
		{paths.Workflows, "manager"}, {paths.ImageBatches, ""}, {paths.Programs, ""},
		{paths.Gallery, ""}, {paths.GeneratedImages, ""},
		{filepath.Join(paths.Runtime, "os"), "runtime"},
		{filepath.Join(paths.Runtime, "cli"), "runtime"},
		{filepath.Join(paths.Attachments, "references-v2"), ""},
	} {
		root := source.root
		if _, e := os.Lstat(root); os.IsNotExist(e) {
			continue
		}
		err = filepath.WalkDir(root, func(p string, d fs.DirEntry, e error) error {
			if e != nil {
				return e
			}
			if d.IsDir() {
				if !ordinaryRuntimeDirectory(p) {
					return fmt.Errorf("redirected reference directory")
				}
				if d.Name() == "desktop" && source.lease == "runtime" {
					return filepath.SkipDir
				}
				if sessionIDPattern.MatchString(d.Name()) {
					if source.lease == "manager" {
						return takeLock(filepath.Join(p, "manager.lock"))
					}
					if source.lease == "runtime" {
						return takeLock(p + ".lock")
					}
				}
				return nil
			}
			st, e := os.Lstat(p)
			if e != nil || !st.Mode().IsRegular() {
				return fmt.Errorf("invalid reference file")
			}
			if strings.HasSuffix(p, ".lock") {
				return takeLock(p)
			}
			if strings.HasSuffix(p, ".jsonl") {
				if e = takeLock(strings.TrimSuffix(p, ".jsonl") + ".lock"); e != nil {
					return e
				}
			}
			size += st.Size()
			if size > 512<<20 || len(files) >= 20000 {
				return fmt.Errorf("reference census limit")
			}
			files = append(files, p)
			return nil
		})
		if err != nil {
			return fail("references_or_legacy_lock")
		}
	}
	for _, p := range files {
		if err = scanAttachmentReferences(p, remember); err != nil {
			return fail("references_unreadable")
		}
	}
	entries, err = os.ReadDir(assets)
	if err != nil {
		return fail("catalog_unreadable")
	}
	type candidate struct {
		hash  string
		bytes int64
	}
	var candidates []candidate
	for _, entry := range entries {
		if !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		hash := strings.TrimSuffix(entry.Name(), ".json")
		if len(hash) != 64 || !attachmentHashPattern.MatchString(hash) {
			continue
		}
		p := filepath.Join(assets, entry.Name())
		st, e := os.Lstat(p)
		if e != nil || !st.Mode().IsRegular() || st.Size() > 1024 {
			return fail("catalog_invalid")
		}
		data, e := os.ReadFile(p)
		var record struct {
			Version int    `json:"version"`
			SHA256  string `json:"sha256"`
			Bytes   int64  `json:"bytes"`
		}
		if e != nil || json.Unmarshal(data, &record) != nil || record.Version != 2 || record.SHA256 != hash || record.Bytes < 0 || record.Bytes > 32<<20 {
			return fail("catalog_invalid")
		}
		if refs[hash] {
			result.Retained++
			continue
		}
		candidates = append(candidates, candidate{hash, record.Bytes})
	}
	// Validate every candidate before deleting any. os.Root confines the removal
	// to this namespace; links, modified files and unknown files are preserved.
	root, err := os.OpenRoot(assets)
	if err != nil {
		return fail("asset_directory")
	}
	defer root.Close()
	for _, c := range candidates {
		st, e := root.Lstat(c.hash)
		if os.IsNotExist(e) {
			continue
		}
		if e != nil || !st.Mode().IsRegular() || st.Size() != c.bytes {
			return fail("asset_changed")
		}
		f, e := root.Open(c.hash)
		if e != nil {
			return fail("asset_unreadable")
		}
		h := sha256.New()
		n, e := io.Copy(h, io.LimitReader(f, 32<<20+1))
		f.Close()
		if e != nil || n != c.bytes || fmt.Sprintf("%x", h.Sum(nil)) != c.hash {
			return fail("asset_changed")
		}
	}
	for _, c := range candidates {
		if err = root.Remove(c.hash); err != nil && !os.IsNotExist(err) {
			return fail("remove_failed")
		}
		if err == nil {
			result.Removed++
			result.Bytes += c.bytes
		}
		if err = root.Remove(c.hash + ".json"); err != nil {
			return fail("catalog_remove_failed")
		}
	}
	return result
}

func scanAttachmentReferences(path string, remember func(string)) error {
	if strings.HasSuffix(path, ".sqlite") || strings.HasSuffix(path, ".db") {
		sqlitePath := filepath.ToSlash(path)
		if filepath.VolumeName(path) != "" && !strings.HasPrefix(sqlitePath, "/") {
			sqlitePath = "/" + sqlitePath
		}
		u := url.URL{Scheme: "file", Path: sqlitePath}
		q := url.Values{"mode": {"ro"}, "_pragma": {"query_only(1)"}}
		u.RawQuery = q.Encode()
		db, err := sql.Open("sqlite", u.String())
		if err != nil {
			return err
		}
		defer db.Close()
		db.SetMaxOpenConns(1)
		rows, err := db.Query("SELECT name FROM sqlite_master WHERE type='table'")
		if err != nil {
			return err
		}
		var tables []string
		for rows.Next() {
			var name string
			if err = rows.Scan(&name); err != nil {
				rows.Close()
				return err
			}
			tables = append(tables, name)
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return err
		}
		for _, table := range tables {
			r, err := db.Query(`SELECT * FROM "` + strings.ReplaceAll(table, `"`, `""`) + `"`)
			if err != nil {
				return err
			}
			cols, err := r.Columns()
			if err != nil {
				r.Close()
				return err
			}
			values := make([]any, len(cols))
			pointers := make([]any, len(cols))
			for i := range values {
				pointers[i] = &values[i]
			}
			for r.Next() {
				if err = r.Scan(pointers...); err != nil {
					r.Close()
					return err
				}
				for _, v := range values {
					switch t := v.(type) {
					case string:
						remember(t)
					case []byte:
						remember(string(t))
					}
				}
			}
			err = r.Err()
			r.Close()
			if err != nil {
				return err
			}
		}
		return nil
	}
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	if strings.HasSuffix(path, ".json") {
		data, err := io.ReadAll(io.LimitReader(f, 64<<20+1))
		if err != nil || len(data) > 64<<20 {
			return fmt.Errorf("reference size")
		}
		var value any
		if err = json.Unmarshal(data, &value); err != nil {
			return err
		}
		if filepath.Base(filepath.Dir(path)) == "references-v2" {
			var record struct {
				Version int                 `json:"version"`
				Owner   string              `json:"owner"`
				Refs    []string            `json:"refs"`
				Pending map[string][]string `json:"pending"`
				Sends   map[string][]string `json:"sends"`
			}
			if json.Unmarshal(data, &record) != nil || record.Version != 2 || record.Owner != strings.TrimSuffix(filepath.Base(path), ".json") || record.Refs == nil || record.Pending == nil || record.Sends == nil {
				return fmt.Errorf("invalid durable references")
			}
			valid := func(values []string) bool {
				for _, h := range values {
					if len(h) != 64 || !attachmentHashPattern.MatchString(h) {
						return false
					}
				}
				return true
			}
			if !valid(record.Refs) {
				return fmt.Errorf("invalid durable references")
			}
			for _, values := range record.Pending {
				if !valid(values) {
					return fmt.Errorf("invalid pending references")
				}
			}
			for _, values := range record.Sends {
				if !valid(values) {
					return fmt.Errorf("invalid send references")
				}
			}
		}
		remember(string(data))
		rememberAttachmentJSON(value, remember)
		return nil
	}
	if strings.HasSuffix(path, ".jsonl") {
		s := bufio.NewScanner(f)
		s.Buffer(make([]byte, 65536), 64<<20)
		for s.Scan() {
			if strings.TrimSpace(s.Text()) == "" {
				continue
			}
			var value any
			if err = json.Unmarshal(s.Bytes(), &value); err != nil {
				return err
			}
			remember(s.Text())
			rememberAttachmentJSON(value, remember)
		}
		return s.Err()
	}
	buf := make([]byte, 65536)
	tail := ""
	for {
		n, e := f.Read(buf)
		if n > 0 {
			data := tail + string(buf[:n])
			remember(data)
			if len(data) > 63 {
				tail = data[len(data)-63:]
			} else {
				tail = data
			}
		}
		if e == io.EOF {
			return nil
		}
		if e != nil {
			return e
		}
	}
}

func rememberAttachmentJSON(v any, remember func(string)) {
	switch t := v.(type) {
	case string:
		remember(t)
	case []any:
		for _, v := range t {
			rememberAttachmentJSON(v, remember)
		}
	case map[string]any:
		for k, v := range t {
			remember(k)
			rememberAttachmentJSON(v, remember)
		}
	}
}

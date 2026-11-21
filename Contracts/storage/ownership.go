// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Contracts/storage/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: MigrationBarrier; OwnerDirectory; Owner; ownerLease; ownerLeases; CheckAvailable; Enter; enterProfile; Owners
// Impact: python -B scripts/code-atlas.py show Contracts/storage/ownership.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package storage

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

const MigrationBarrier = ".aieyra-migration.json"
const OwnerDirectory = ".aieyra-profile-owners"

type Owner struct {
	Schema int    `json:"schema"`
	PID    int    `json:"pid"`
	Config string `json:"config"`
}

type ownerLease struct {
	users int
	file  string
}

var ownerLeases = struct {
	sync.Mutex
	roots map[string]*ownerLease
}{roots: map[string]*ownerLease{}}

// CheckAvailable never interprets a partial migration as a legacy layout.
func CheckAvailable(root string) error {
	_, err := os.Lstat(filepath.Join(root, MigrationBarrier))
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	return fmt.Errorf("profile migration requires recovery or selection of the destination configuration; original retained")
}

// Enter publishes ownership before the first filesystem effect. A migrator
// publishes its barrier before scanning owners. The second barrier check closes
// the race: either the new owner withdraws, or migration sees it and refuses.
// Records have unique names; only their owner removes them during normal use.
func Enter(config string) (func(), error) {
	p, err := Bind(config)
	if err != nil {
		return nil, err
	}
	return enterProfile(p)
}

func enterProfile(p Profile) (func(), error) {
	ownerLeases.Lock()
	defer ownerLeases.Unlock()
	if err := CheckAvailable(p.Root); err != nil {
		return nil, err
	}
	key := pathKey(p.Root)
	l := ownerLeases.roots[key]
	if l == nil {
		dir := filepath.Join(p.Root, OwnerDirectory)
		if err := os.MkdirAll(dir, 0700); err != nil {
			return nil, err
		}
		real, err := filepath.EvalSymlinks(dir)
		if err != nil || pathKey(real) != pathKey(dir) {
			return nil, fmt.Errorf("profile owner directory is redirected")
		}
		var nonce [16]byte
		if _, err = rand.Read(nonce[:]); err != nil {
			return nil, err
		}
		file := filepath.Join(dir, fmt.Sprintf("%d-%s.json", os.Getpid(), hex.EncodeToString(nonce[:])))
		f, err := os.OpenFile(file, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if err != nil {
			return nil, err
		}
		data, _ := json.Marshal(Owner{Schema: 1, PID: os.Getpid(), Config: p.Config})
		_, err = f.Write(data)
		if err == nil {
			err = f.Sync()
		}
		if closed := f.Close(); err == nil {
			err = closed
		}
		if err == nil {
			err = CheckAvailable(p.Root)
		}
		if err != nil {
			_ = os.Remove(file)
			return nil, err
		}
		l = &ownerLease{file: file}
		ownerLeases.roots[key] = l
	}
	l.users++
	var once sync.Once
	return func() {
		once.Do(func() {
			ownerLeases.Lock()
			defer ownerLeases.Unlock()
			l.users--
			if l.users == 0 {
				_ = os.Remove(l.file)
				delete(ownerLeases.roots, key)
			}
		})
	}, nil
}

// Owners does not delete stale records. Migration may ignore a dead PID only
// while holding its kernel owner lock and published barrier. Unknown state is
// an error, and a reused live PID conservatively retains ownership.
func Owners(root string) ([]Owner, error) {
	dir := filepath.Join(root, OwnerDirectory)
	entries, err := os.ReadDir(dir)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	real, err := filepath.EvalSymlinks(dir)
	if err != nil || pathKey(real) != pathKey(dir) {
		return nil, fmt.Errorf("profile owner directory is redirected")
	}
	var out []Owner
	for _, e := range entries {
		file := filepath.Join(dir, e.Name())
		st, err := os.Lstat(file)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return nil, err
		}
		if !st.Mode().IsRegular() || st.Size() > 4096 {
			return nil, fmt.Errorf("invalid profile owner record")
		}
		data, err := os.ReadFile(file)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return nil, err
		}
		var o Owner
		if len(data) > 4096 || json.Unmarshal(data, &o) != nil || o.Schema != 1 || o.PID <= 0 || o.Config == "" {
			return nil, fmt.Errorf("incomplete profile owner record; retry after startup has settled")
		}
		if !ProcessAbsent(o.PID) {
			out = append(out, o)
		}
	}
	return out, nil
}

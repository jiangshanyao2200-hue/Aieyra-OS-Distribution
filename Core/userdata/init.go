// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/userdata/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: lockName; ordinary; Init; initialize; validateConfig; writeMarker
// Impact: python -B scripts/code-atlas.py show Core/userdata/init.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Package userdata initializes an explicitly selected private profile. It does
// not discover, open, copy or migrate existing user databases.
package userdata

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/aieyra/aieyra-os/CORE/internal/privatefile"
	"github.com/aieyra/aieyra-os/CORE/sessionservice"
	"github.com/aieyra/aieyra-os/contracts/storage"
)

const lockName = ".aieyra-userdata.lock"

// ordinary checks each existing ancestor before creating or writing anything.
func ordinary(file string) error {
	for p := file; ; p = filepath.Dir(p) {
		st, err := os.Lstat(p)
		if err == nil {
			if st.Mode()&os.ModeSymlink != 0 {
				return fmt.Errorf("user-data path is redirected: %s", p)
			}
			real, err := filepath.EvalSymlinks(p)
			if err != nil || !strings.EqualFold(filepath.Clean(real), filepath.Clean(p)) {
				return fmt.Errorf("user-data path is redirected: %s", p)
			}
		} else if !os.IsNotExist(err) {
			return err
		}
		if filepath.Dir(p) == p {
			return nil
		}
	}
}

func Init(root string) (storage.Profile, error) { return initialize(root, nil) }

// checkpoint is used by recovery tests to stop at actual durable boundaries.
func initialize(root string, checkpoint func(string) error) (storage.Profile, error) {
	fail := func(err error) (storage.Profile, error) { return storage.Profile{}, err }
	if strings.TrimSpace(root) == "" {
		return fail(fmt.Errorf("user-data root is required"))
	}
	root, err := filepath.Abs(root)
	if err != nil {
		return fail(err)
	}
	if err = ordinary(root); err != nil {
		return fail(err)
	}
	if err = os.MkdirAll(root, 0700); err != nil {
		return fail(err)
	}
	if err = ordinary(filepath.Join(root, lockName)); err != nil {
		return fail(err)
	}
	unlock, err := sessionservice.Lock(filepath.Join(root, lockName))
	if err != nil {
		return fail(fmt.Errorf("user-data initialization is already in use: %w", err))
	}
	defer unlock()
	m, err := storage.ReadMarker(root)
	if err != nil {
		return fail(err)
	}
	config := filepath.Join(root, "Config", "config.json")
	if m != nil && m.State == "ready" {
		return storage.Bind(config)
	}
	if m != nil && m.State != "initializing" {
		return fail(fmt.Errorf("user-data migration must be resumed with profile migrate"))
	}
	if m == nil {
		entries, err := os.ReadDir(root)
		if err != nil {
			return fail(err)
		}
		for _, e := range entries {
			if e.Name() != lockName {
				return fail(fmt.Errorf("user-data initialization requires an empty directory; existing files retained"))
			}
		}
		var id [16]byte
		if _, err = rand.Read(id[:]); err != nil {
			return fail(err)
		}
		m = &storage.Marker{Schema: storage.ProfileSchema, ID: hex.EncodeToString(id[:]), State: "initializing", Config: "Config/config.json"}
		if err = writeMarker(root, *m); err != nil {
			return fail(err)
		}
	}
	if checkpoint != nil {
		if err = checkpoint("declared"); err != nil {
			return fail(err)
		}
	}
	dirs := []string{filepath.Dir(config), filepath.Join(root, "Overrides", "Prompt", "Matrix")}
	for _, area := range storage.Describe(root) {
		p, _ := storage.RootInLayout(root, area.ID, true)
		if area.ID == "desk_mode" || area.ID == "module_order" {
			p = filepath.Dir(p)
		}
		dirs = append(dirs, p)
	}
	for _, d := range dirs {
		if err = ordinary(d); err != nil {
			return fail(err)
		}
		if err = os.MkdirAll(d, 0700); err != nil {
			return fail(err)
		}
	}
	if err = ordinary(config); err != nil {
		return fail(err)
	}
	f, err := os.OpenFile(config, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err == nil {
		_, err = f.WriteString("{}\n")
		if err == nil {
			err = f.Sync()
		}
		if e := f.Close(); err == nil {
			err = e
		}
	} else if os.IsExist(err) {
		err = nil
	}
	if err != nil {
		return fail(err)
	}
	if err = validateConfig(config); err != nil {
		return fail(err)
	}
	if checkpoint != nil {
		if err = checkpoint("configured"); err != nil {
			return fail(err)
		}
	}
	m.State = "ready"
	if err = writeMarker(root, *m); err != nil {
		return fail(err)
	}
	return storage.Bind(config)
}

func validateConfig(file string) error {
	st, err := os.Lstat(file)
	if err != nil {
		return err
	}
	if !st.Mode().IsRegular() || st.Size() > 4<<20 {
		return fmt.Errorf("invalid configuration; original retained")
	}
	data, err := os.ReadFile(file)
	if err != nil {
		return err
	}
	var value map[string]json.RawMessage
	if len(data) > 4<<20 || json.Unmarshal(data, &value) != nil || value == nil {
		return fmt.Errorf("incomplete configuration; original retained")
	}
	return nil
}

func writeMarker(root string, m storage.Marker) error {
	data, err := json.Marshal(m)
	if err != nil {
		return err
	}
	return privatefile.Write(filepath.Join(root, storage.ProfileMarker), append(data, '\n'))
}

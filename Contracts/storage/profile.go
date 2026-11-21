// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Contracts/storage/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: ProfileMarker; ProfileSchema; Marker; Profile; profileID; profiles; pathKey; ParseMarker; ReadMarker; legacyProfile; Bind; Inspect; Bound; profileRootBound
// Impact: python -B scripts/code-atlas.py show Contracts/storage/profile.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package storage

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"unicode/utf8"
)

const ProfileMarker = ".aieyra-userdata.json"
const ProfileSchema = "aieyra.user-data/1"

type Marker struct {
	Schema string `json:"schema"`
	ID     string `json:"id"`
	State  string `json:"state"`
	Config string `json:"config"`
}

type Profile struct {
	origins   *originSet
	Root      string `json:"root"`
	Config    string `json:"config"`
	Overrides string `json:"overrides"`
	ID        string `json:"id,omitempty"`
	Unified   bool   `json:"unified"`
}

var profileID = regexp.MustCompile(`^[a-f0-9]{32}$`)
var profiles = struct {
	sync.RWMutex
	configs map[string]Profile
	roots   map[string]bool
}{configs: map[string]Profile{}, roots: map[string]bool{}}

func pathKey(p string) string {
	p, _ = filepath.Abs(p)
	p = filepath.Clean(p)
	if runtime.GOOS == "windows" {
		p = strings.ToLower(p)
	}
	return p
}

func ParseMarker(data []byte) (Marker, error) {
	var m Marker
	if len(data) > 4096 || !utf8.Valid(data) {
		return m, fmt.Errorf("invalid user-data declaration")
	}
	d := json.NewDecoder(bytes.NewReader(data))
	d.DisallowUnknownFields()
	if d.Decode(&m) != nil || d.Decode(new(any)) != io.EOF || m.Schema != ProfileSchema || !profileID.MatchString(m.ID) || m.Config != "Config/config.json" || (m.State != "initializing" && m.State != "migrating" && m.State != "ready") {
		return Marker{}, fmt.Errorf("damaged or unsupported user-data declaration; original retained")
	}
	return m, nil
}

// ReadMarker reads only the small layout declaration, never private payloads.
// A missing declaration means legacy; unreadable/damaged metadata is an error.
func ReadMarker(root string) (*Marker, error) {
	file := filepath.Join(root, ProfileMarker)
	st, err := os.Lstat(file)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if !st.Mode().IsRegular() || st.Size() > 4096 {
		return nil, fmt.Errorf("user-data declaration must be a regular bounded file")
	}
	real, err := filepath.EvalSymlinks(root)
	if err != nil || pathKey(real) != pathKey(root) {
		return nil, fmt.Errorf("user-data root must not be redirected")
	}
	dir, err := os.OpenRoot(root)
	if err != nil {
		return nil, err
	}
	defer dir.Close()
	f, err := dir.Open(ProfileMarker)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	opened, err := f.Stat()
	if err != nil || !os.SameFile(st, opened) {
		return nil, fmt.Errorf("user-data declaration changed while opening")
	}
	data, err := io.ReadAll(io.LimitReader(f, 4097))
	if err != nil {
		return nil, err
	}
	m, err := ParseMarker(data)
	if err != nil {
		return nil, err
	}
	return &m, nil
}

func legacyProfile(config string) Profile {
	dir := filepath.Dir(config)
	root, overrides := dir, dir
	if strings.EqualFold(filepath.Base(dir), "Config") {
		overrides = filepath.Dir(dir)
		root = filepath.Join(overrides, "Data")
	}
	return Profile{Root: root, Config: config, Overrides: overrides}
}

// Bind is called at configuration/service admission before filesystem effects.
// A binding stays fixed for the life of this process. Migration requires the
// old writers to exit; editing a declaration cannot redirect an active task.
func Bind(config string) (Profile, error) {
	if strings.TrimSpace(config) == "" {
		return Profile{}, fmt.Errorf("configuration identity is required")
	}
	abs, err := filepath.Abs(config)
	if err != nil {
		return Profile{}, err
	}
	key := pathKey(abs)
	profiles.RLock()
	prior, exists := profiles.configs[key]
	profiles.RUnlock()
	if exists {
		if err := CheckAvailable(prior.Root); err != nil {
			return Profile{}, err
		}
		return prior, nil
	}
	p, err := Inspect(abs)
	if err != nil {
		return Profile{}, err
	}
	if err := CheckAvailable(p.Root); err != nil {
		return Profile{}, err
	}
	profiles.Lock()
	defer profiles.Unlock()
	if prior, exists = profiles.configs[key]; exists {
		return prior, nil
	}
	profiles.configs[key] = p
	if p.Unified {
		profiles.roots[pathKey(p.Root)] = true
	}
	return p, nil
}

// Inspect reads layout metadata without admission or binding. Migration uses
// it to resume a fenced source; ordinary services must use Bind instead.
func Inspect(config string) (Profile, error) {
	if strings.TrimSpace(config) == "" {
		return Profile{}, fmt.Errorf("configuration identity is required")
	}
	abs, err := filepath.Abs(config)
	if err != nil {
		return Profile{}, err
	}
	key := pathKey(abs)
	p := legacyProfile(abs)
	root := filepath.Dir(abs)
	if strings.EqualFold(filepath.Base(root), "Config") {
		root = filepath.Dir(root)
	}
	m, err := ReadMarker(root)
	if err != nil {
		return Profile{}, err
	}
	if m != nil {
		if m.State != "ready" {
			return Profile{}, fmt.Errorf("user-data initialization or migration is incomplete; resume it before opening this profile")
		}
		if pathKey(abs) != pathKey(filepath.Join(root, filepath.FromSlash(m.Config))) {
			return Profile{}, fmt.Errorf("configuration does not match the declared user-data profile")
		}
		realConfig, e := filepath.EvalSymlinks(abs)
		st, se := os.Lstat(abs)
		if e != nil || se != nil || !st.Mode().IsRegular() || pathKey(realConfig) != key {
			return Profile{}, fmt.Errorf("declared configuration is missing or redirected")
		}
		p = Profile{Root: root, Config: abs, Overrides: filepath.Join(root, "Overrides"), ID: m.ID, Unified: true}
		p.origins, err = readOrigins(root, m.ID)
		if err != nil {
			return Profile{}, err
		}
	}
	return p, nil
}

// Bound is a pure accessor for admitted services. Unbound legacy path queries
// keep their historical lexical mapping; public IO entrypoints must call Bind.
func Bound(config string) Profile {
	profiles.RLock()
	p, ok := profiles.configs[pathKey(config)]
	profiles.RUnlock()
	if ok {
		return p
	}
	return legacyProfile(config)
}

func profileRootBound(root string) bool {
	profiles.RLock()
	defer profiles.RUnlock()
	return profiles.roots[pathKey(root)]
}

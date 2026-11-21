// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Theme/contract/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: Preset; presetID; validatePresets; resolvePreset
// Impact: python -B scripts/code-atlas.py show Theme/contract/presets.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package contract

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
)

type Preset struct {
	Name    string                     `json:"name"`
	Extends json.RawMessage            `json:"extends,omitempty"`
	Values  map[string]json.RawMessage `json:"values"`
}

var presetID = regexp.MustCompile(`^[a-z][a-z0-9_-]{0,63}$`)

func validatePresets(p Definition) error {
	if len(p.Presets) > 16 {
		return fmt.Errorf("theme supports at most 16 presets")
	}
	for id, preset := range p.Presets {
		if !presetID.MatchString(id) || strings.TrimSpace(preset.Name) == "" || len(preset.Name) > 160 || strings.ContainsAny(preset.Name, "\x00\x01\x02\x03\x04\x05\x06\x07\x08\x09\x0a\x0b\x0c\x0d\x0e\x0f\x10\x11\x12\x13\x14\x15\x16\x17\x18\x19\x1a\x1b\x1c\x1d\x1e\x1f") {
			return fmt.Errorf("invalid theme preset identity")
		}
		resolved, err := resolvePreset(p, id, map[string]bool{})
		if err != nil {
			return err
		}
		resolved.Presets = p.Presets
		raw, err := json.Marshal(resolved)
		if err != nil || len(raw) > 65536 {
			return fmt.Errorf("resolved theme definition exceeds 64 KiB")
		}
	}
	return nil
}

func resolvePreset(p Definition, id string, seen map[string]bool) (Definition, error) {
	preset, ok := p.Presets[id]
	if !ok {
		return Definition{}, fmt.Errorf("unknown parent theme preset")
	}
	if seen[id] || len(seen) >= 8 {
		return Definition{}, fmt.Errorf("theme preset inheritance is cyclic or exceeds 8 levels")
	}
	seen[id] = true
	base := p
	base.Presets = nil
	if len(preset.Extends) > 0 {
		var parent string
		if err := json.Unmarshal(preset.Extends, &parent); err != nil || parent == "" {
			return Definition{}, fmt.Errorf("invalid parent theme preset")
		}
		var err error
		base, err = resolvePreset(p, parent, seen)
		if err != nil {
			return Definition{}, err
		}
	}
	raw, err := json.Marshal(base)
	if err != nil {
		return Definition{}, err
	}
	var fields map[string]json.RawMessage
	if err = json.Unmarshal(raw, &fields); err != nil {
		return Definition{}, err
	}
	if preset.Values == nil {
		return Definition{}, fmt.Errorf("preset values must be an object")
	}
	for group, patch := range preset.Values {
		if group == "styles" {
			if string(patch) == "null" {
				delete(fields, group)
			} else {
				if len(patch) == 0 || patch[0] != '[' {
					return Definition{}, fmt.Errorf("preset styles must be an array or null")
				}
				fields[group] = patch
			}
			continue
		}
		if group != "tokens" && group != "layouts" && group != "renderers" {
			return Definition{}, fmt.Errorf("unknown preset field: %s", group)
		}
		var updates map[string]json.RawMessage
		if err = json.Unmarshal(patch, &updates); err != nil || updates == nil {
			return Definition{}, fmt.Errorf("preset values must be an object")
		}
		values := map[string]json.RawMessage{}
		if old := fields[group]; old != nil {
			if err = json.Unmarshal(old, &values); err != nil {
				return Definition{}, err
			}
		}
		for key, value := range updates {
			valid := token.MatchString(key)
			if group == "layouts" {
				_, valid = catalog.Surfaces[key]
			} else if group == "renderers" {
				_, valid = catalog.Renderers[key]
			}
			if !valid {
				return Definition{}, fmt.Errorf("unknown preset property: %s", key)
			}
			if string(value) == "null" {
				delete(values, key)
			} else {
				values[key] = value
			}
		}
		fields[group], err = json.Marshal(values)
		if err != nil {
			return Definition{}, err
		}
	}
	raw, err = json.Marshal(fields)
	if err != nil {
		return Definition{}, err
	}
	return Decode(raw)
}

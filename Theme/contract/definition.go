// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Theme/contract/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: elements; Node; Rule; Definition; LayoutSpec; catalog; init; token; unsafeValue; css; properties; Decode; validateTrees
// Impact: python -B scripts/code-atlas.py show Theme/contract/definition.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Package contract describes theme layouts independently of a renderer.
package contract

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"fmt"
	"io"
	"regexp"
	"slices"
	"strings"
)

//go:embed elements.json
var elements []byte

type Node struct {
	Slot     string            `json:"slot,omitempty"`
	Tag      string            `json:"tag,omitempty"`
	Label    string            `json:"label,omitempty"`
	Style    map[string]string `json:"style,omitempty"`
	Children []Node            `json:"children,omitempty"`
}
type Rule struct {
	Element    string            `json:"element"`
	State      string            `json:"state,omitempty"`
	Properties map[string]string `json:"properties"`
}
type Definition struct {
	Schema    string            `json:"schema"`
	Elements  string            `json:"elements"`
	Tokens    map[string]string `json:"tokens,omitempty"`
	Styles    []Rule            `json:"styles,omitempty"`
	Layouts   map[string]Node   `json:"layouts,omitempty"`
	Renderers map[string]Node   `json:"renderers,omitempty"`
	Assets    map[string]Asset  `json:"assets,omitempty"`
	Sounds    map[string]string `json:"sounds,omitempty"`
	Presets   map[string]Preset `json:"presets,omitempty"`
}

type LayoutSpec struct {
	Slots  map[string]string `json:"slots"`
	Inline bool              `json:"inline"`
}

var catalog struct {
	Version    string                `json:"version"`
	Surfaces   map[string]LayoutSpec `json:"surfaces"`
	Renderers  map[string]LayoutSpec `json:"renderers"`
	Elements   map[string]string     `json:"elements"`
	States     map[string]string     `json:"states"`
	Properties []string              `json:"properties"`
}

func init() {
	if err := json.Unmarshal(elements, &catalog); err != nil {
		panic(err)
	}
}

var token = regexp.MustCompile(`^--ui-[a-z0-9-]{1,64}$`)
var unsafeValue = regexp.MustCompile(`(?i)[\\;{}<>@\x00-\x1f]|(?:url|image-set|expression|attr|src)\s*\(|javascript:|https?:`)

func css(v string) bool { return len(v) <= 512 && !unsafeValue.MatchString(v) }
func properties(v map[string]string, assets map[string]Asset) error {
	for k, value := range v {
		if !slices.Contains(catalog.Properties, k) || !css(value) || !assetProperty(k, value, assets) {
			return fmt.Errorf("unsupported theme property: %s", k)
		}
	}
	return nil
}

func Decode(raw []byte) (Definition, error) {
	var p Definition
	if len(raw) > 65536 {
		return p, fmt.Errorf("theme definition exceeds 64 KiB")
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if err := d.Decode(&p); err != nil {
		return p, err
	}
	if d.Decode(new(any)) != io.EOF {
		return p, fmt.Errorf("theme definition has trailing content")
	}
	var envelope struct {
		Presets json.RawMessage `json:"presets"`
		Sounds  json.RawMessage `json:"sounds"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return p, err
	}
	if bytes.Equal(bytes.TrimSpace(envelope.Presets), []byte("null")) {
		return p, fmt.Errorf("theme presets must be an object")
	}
	if bytes.Equal(bytes.TrimSpace(envelope.Sounds), []byte("null")) {
		return p, fmt.Errorf("theme sounds must be an object")
	}
	if err := validateSounds(p.Sounds, p.Assets); err != nil {
		return p, err
	}
	if p.Schema != "aieyra.theme/1" || p.Elements != catalog.Version {
		return p, fmt.Errorf("unsupported theme or element contract")
	}
	if err := validateAssets(p.Assets); err != nil {
		return p, err
	}
	for k, v := range p.Tokens {
		if !token.MatchString(k) || !css(v) || assetCall.MatchString(v) {
			return p, fmt.Errorf("invalid theme token: %s", k)
		}
	}
	if len(p.Styles) > 256 {
		return p, fmt.Errorf("too many theme styles")
	}
	for _, r := range p.Styles {
		if _, ok := catalog.Elements[r.Element]; !ok {
			return p, fmt.Errorf("unknown theme element: %s", r.Element)
		}
		state := r.State
		if state == "" {
			state = "default"
		}
		if _, ok := catalog.States[state]; !ok {
			return p, fmt.Errorf("unknown theme state: %s", state)
		}
		if err := properties(r.Properties, p.Assets); err != nil {
			return p, err
		}
	}
	if err := validateTrees(p.Layouts, catalog.Surfaces, p.Assets); err != nil {
		return p, err
	}
	if err := validateTrees(p.Renderers, catalog.Renderers, p.Assets); err != nil {
		return p, err
	}
	if err := validatePresets(p); err != nil {
		return p, err
	}
	return p, nil
}

func validateTrees(trees map[string]Node, specs map[string]LayoutSpec, assets map[string]Asset) error {
	for surface, tree := range trees {
		spec, ok := specs[surface]
		if !ok {
			return fmt.Errorf("unknown theme surface or content schema: %s", surface)
		}
		seen, count := map[string]bool{}, 0
		var walk func(Node, int) error
		walk = func(n Node, depth int) error {
			count++
			if count > 128 || depth > 12 {
				return fmt.Errorf("theme layout is too complex")
			}
			if err := properties(n.Style, assets); err != nil {
				return err
			}
			if n.Slot != "" {
				if _, ok := spec.Slots[n.Slot]; !ok || seen[n.Slot] || n.Children != nil || n.Tag != "" || n.Label != "" {
					return fmt.Errorf("invalid or duplicate theme slot: %s", n.Slot)
				}
				seen[n.Slot] = true
				return nil
			}
			if !slices.Contains([]string{"", "div", "section", "article", "header", "footer", "nav", "aside", "main", "span"}, n.Tag) || len(n.Label) > 160 || strings.ContainsRune(n.Label, 0) {
				return fmt.Errorf("unsupported theme container")
			}
			if spec.Inline && n.Tag != "span" {
				return fmt.Errorf("theme attachment containers must be spans")
			}
			if len(n.Children) == 0 {
				return fmt.Errorf("theme container needs children")
			}
			for _, child := range n.Children {
				if err := walk(child, depth+1); err != nil {
					return err
				}
			}
			return nil
		}
		if err := walk(tree, 0); err != nil {
			return err
		}
		for slot := range spec.Slots {
			if !seen[slot] {
				return fmt.Errorf("theme omits required slot: %s.%s", surface, slot)
			}
		}
	}
	return nil
}

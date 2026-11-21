// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Halo/contract/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: Schema; states; identifier; color; Definition; Layer; Motion; Frame; bounded; noNull; exactKeys; exactDefinition; Decode; Validate
// Impact: python -B scripts/code-atlas.py show Halo/contract/definition.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Package contract validates the independent, non-executable Halo Mod contract.
package contract

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"regexp"
	"strings"
)

const Schema = "aieyra.halo/1"

var states = map[string]bool{"boot": true, "connecting": true, "compacting": true, "offline": true, "thinking": true, "body": true, "tool": true, "preparing": true, "waiting": true, "queued": true, "confirming": true, "idle": true, "cancelling": true, "waiting_user": true, "error": true}
var identifier = regexp.MustCompile(`^\w{1,32}$`)
var color = regexp.MustCompile(`^(none|currentColor|#[a-fA-F0-9]{6})$`)

type Definition struct {
	Schema string  `json:"schema"`
	Preset *string `json:"preset,omitempty"`
	Layers []Layer `json:"layers,omitempty"`
}
type Layer struct {
	ID      string      `json:"id"`
	Shape   string      `json:"shape"`
	CX      *float64    `json:"cx,omitempty"`
	CY      *float64    `json:"cy,omitempty"`
	RX      *float64    `json:"rx,omitempty"`
	RY      *float64    `json:"ry,omitempty"`
	Points  [][]float64 `json:"points,omitempty"`
	Stroke  *string     `json:"stroke,omitempty"`
	Fill    *string     `json:"fill,omitempty"`
	Width   *float64    `json:"width,omitempty"`
	Opacity *float64    `json:"opacity,omitempty"`
	States  []string    `json:"states,omitempty"`
	Motion  *Motion     `json:"motion,omitempty"`
}
type Motion struct {
	Duration float64 `json:"duration"`
	Easing   string  `json:"easing"`
	Frames   []Frame `json:"frames"`
}
type Frame struct {
	Offset  *float64 `json:"offset"`
	Rotate  *float64 `json:"rotate,omitempty"`
	Scale   *float64 `json:"scale,omitempty"`
	X       *float64 `json:"x,omitempty"`
	Y       *float64 `json:"y,omitempty"`
	Opacity *float64 `json:"opacity,omitempty"`
}

func bounded(v *float64, min, max float64, required bool) bool {
	if v == nil {
		return !required
	}
	return !math.IsNaN(*v) && !math.IsInf(*v, 0) && *v >= min && *v <= max
}

// Null is not a declarative value; reject it instead of silently coercing it
// into a Go zero value. This matches the browser validator.
func noNull(v any) bool {
	switch x := v.(type) {
	case nil:
		return false
	case []any:
		for _, y := range x {
			if !noNull(y) {
				return false
			}
		}
	case map[string]any:
		for _, y := range x {
			if !noNull(y) {
				return false
			}
		}
	}
	return true
}

func exactKeys(value any, allowed string) bool {
	object, ok := value.(map[string]any)
	if !ok {
		return false
	}
	for key := range object {
		if !strings.Contains(" "+allowed+" ", " "+key+" ") {
			return false
		}
	}
	return true
}
func exactDefinition(value any) bool {
	if !exactKeys(value, "schema preset layers") {
		return false
	}
	root := value.(map[string]any)
	layers, _ := root["layers"].([]any)
	for _, layer := range layers {
		if !exactKeys(layer, "id shape cx cy rx ry points stroke fill width opacity states motion") {
			return false
		}
		motion, has := layer.(map[string]any)["motion"]
		if !has {
			continue
		}
		if !exactKeys(motion, "duration easing frames") {
			return false
		}
		frames, _ := motion.(map[string]any)["frames"].([]any)
		for _, frame := range frames {
			if !exactKeys(frame, "offset rotate scale x y opacity") {
				return false
			}
		}
	}
	return true
}
func Decode(raw []byte) (Definition, error) {
	var v Definition
	if len(raw) > 65536 {
		return v, fmt.Errorf("halo definition exceeds 64 KiB")
	}
	var generic any
	if err := json.Unmarshal(raw, &generic); err != nil {
		return v, err
	}
	if !noNull(generic) || !exactDefinition(generic) {
		return v, fmt.Errorf("halo fields must match exactly and cannot be null")
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if err := d.Decode(&v); err != nil {
		return v, err
	}
	if d.Decode(new(any)) != io.EOF {
		return v, fmt.Errorf("trailing halo content")
	}
	return v, v.Validate()
}
func (v Definition) Validate() error {
	bad := func() error { return fmt.Errorf("invalid halo geometry, state or motion") }
	if v.Schema != Schema {
		return bad()
	}
	if v.Preset != nil {
		if *v.Preset != "classic" || v.Layers != nil {
			return bad()
		}
		return nil
	}
	if len(v.Layers) < 1 || len(v.Layers) > 24 {
		return bad()
	}
	ids := map[string]bool{}
	for _, l := range v.Layers {
		if !identifier.MatchString(l.ID) || ids[l.ID] {
			return bad()
		}
		ids[l.ID] = true
		switch l.Shape {
		case "ellipse":
			if !bounded(l.CX, 0, 100, true) || !bounded(l.CY, 0, 100, true) || !bounded(l.RX, .1, 50, true) || !bounded(l.RY, .1, 50, true) || l.Points != nil {
				return bad()
			}
		case "polygon", "polyline":
			min := 2
			if l.Shape == "polygon" {
				min = 3
			}
			if len(l.Points) < min || len(l.Points) > 64 || l.CX != nil || l.CY != nil || l.RX != nil || l.RY != nil {
				return bad()
			}
			for _, p := range l.Points {
				if len(p) != 2 || !bounded(&p[0], 0, 100, true) || !bounded(&p[1], 0, 100, true) {
					return bad()
				}
			}
		default:
			return bad()
		}
		for _, c := range []*string{l.Stroke, l.Fill} {
			if c != nil && !color.MatchString(*c) {
				return bad()
			}
		}
		if !bounded(l.Width, .1, 10, false) || !bounded(l.Opacity, 0, 1, false) {
			return bad()
		}
		if l.States != nil && len(l.States) == 0 {
			return bad()
		}
		seen := map[string]bool{}
		for _, s := range l.States {
			if !states[s] || seen[s] {
				return bad()
			}
			seen[s] = true
		}
		if m := l.Motion; m != nil {
			if !bounded(&m.Duration, 600, 60000, true) || (m.Easing != "linear" && m.Easing != "ease-in-out") || len(m.Frames) < 2 || len(m.Frames) > 16 {
				return bad()
			}
			previous := -1.0
			for _, f := range m.Frames {
				if !bounded(f.Offset, 0, 1, true) || *f.Offset <= previous || !bounded(f.Rotate, -720, 720, false) || !bounded(f.Scale, .1, 2, false) || !bounded(f.X, -50, 50, false) || !bounded(f.Y, -50, 50, false) || !bounded(f.Opacity, 0, 1, false) {
					return bad()
				}
				previous = *f.Offset
			}
			if *m.Frames[0].Offset != 0 || previous != 1 {
				return bad()
			}
		}
	}
	return nil
}

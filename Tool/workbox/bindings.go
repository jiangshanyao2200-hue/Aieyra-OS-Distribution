// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Tool/workbox/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: pointerParts; Select; reference; validateBindings; Bind; bind
// Impact: python -B scripts/code-atlas.py show Tool/workbox/bindings.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package workbox

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
)

func pointerParts(pointer string) ([]string, error) {
	if pointer == "" {
		return nil, nil
	}
	if !strings.HasPrefix(pointer, "/") || len(pointer) > 2048 {
		return nil, fmt.Errorf("binding path must be a bounded JSON pointer")
	}
	parts := strings.Split(pointer[1:], "/")
	if len(parts) > 16 {
		return nil, fmt.Errorf("binding path exceeds sixteen levels")
	}
	for i, part := range parts {
		for j := 0; j < len(part); j++ {
			if part[j] == '~' {
				if j+1 >= len(part) || part[j+1] != '0' && part[j+1] != '1' {
					return nil, fmt.Errorf("invalid JSON pointer escape")
				}
				j++
			}
		}
		parts[i] = strings.ReplaceAll(strings.ReplaceAll(part, "~1", "/"), "~0", "~")
	}
	return parts, nil
}

// Select reads data only. It cannot evaluate code, open a file or dereference
// an arbitrary package path.
func Select(value any, pointer string) (any, error) {
	parts, err := pointerParts(pointer)
	if err != nil {
		return nil, err
	}
	for _, part := range parts {
		switch v := value.(type) {
		case map[string]any:
			var ok bool
			value, ok = v[part]
			if !ok {
				return nil, fmt.Errorf("binding field is absent: %s", part)
			}
		case []any:
			i, e := strconv.Atoi(part)
			if e != nil || strconv.Itoa(i) != part || i < 0 || i >= len(v) {
				return nil, fmt.Errorf("binding array index is unavailable: %s", part)
			}
			value = v[i]
		default:
			return nil, fmt.Errorf("binding traverses a scalar value")
		}
	}
	return value, nil
}

func reference(v map[string]any) (kind, source, pointer string, err error) {
	if input, ok := v["$input"]; ok {
		pointer, ok = input.(string)
		if !ok || len(v) != 1 {
			err = fmt.Errorf("$input binding must contain only a JSON pointer")
		}
		return "input", "", pointer, err
	}
	if step, ok := v["$step"]; ok {
		source, ok = step.(string)
		pointer, _ = v["path"].(string)
		if !ok || !identifier.MatchString(source) || len(v) != 2 || v["path"] != pointer {
			err = fmt.Errorf("$step binding requires a step identity and path")
		}
		return "step", source, pointer, err
	}
	for key := range v {
		if strings.HasPrefix(key, "$") {
			return "", "", "", fmt.Errorf("unknown binding: %s", key)
		}
	}
	return "", "", "", nil
}

func validateBindings(value any, input map[string]any, steps map[string]bool, depth int) error {
	if depth > 16 {
		return fmt.Errorf("bindings exceed sixteen levels")
	}
	switch v := value.(type) {
	case map[string]any:
		kind, source, pointer, err := reference(v)
		if err != nil {
			return err
		}
		if kind != "" {
			parts, err := pointerParts(pointer)
			if err != nil {
				return err
			}
			if kind == "step" && !steps[source] {
				return fmt.Errorf("binding references a step outside declared dependencies: %s", source)
			}
			if kind == "input" && len(parts) > 0 {
				props, _ := input["properties"].(map[string]any)
				if props[parts[0]] == nil {
					return fmt.Errorf("binding references an undeclared input: %s", parts[0])
				}
			}
			return nil
		}
		for _, child := range v {
			if err := validateBindings(child, input, steps, depth+1); err != nil {
				return err
			}
		}
	case []any:
		for _, child := range v {
			if err := validateBindings(child, input, steps, depth+1); err != nil {
				return err
			}
		}
	}
	return nil
}

// Bind resolves only supplied completed step outputs. Missing results stop
// admission; they never become empty strings or guessed tool arguments.
func Bind(value any, input map[string]any, completed map[string]json.RawMessage) (any, error) {
	return bind(value, input, completed, 0)
}

func bind(value any, input map[string]any, completed map[string]json.RawMessage, depth int) (any, error) {
	if depth > 16 {
		return nil, fmt.Errorf("bindings exceed sixteen levels")
	}
	switch v := value.(type) {
	case map[string]any:
		kind, source, pointer, err := reference(v)
		if err != nil {
			return nil, err
		}
		if kind == "input" {
			return Select(input, pointer)
		}
		if kind == "step" {
			var result any
			if json.Unmarshal(completed[source], &result) != nil {
				return nil, fmt.Errorf("step output is unavailable: %s", source)
			}
			return Select(result, pointer)
		}
		out := map[string]any{}
		for key, child := range v {
			out[key], err = bind(child, input, completed, depth+1)
			if err != nil {
				return nil, err
			}
		}
		return out, nil
	case []any:
		out := make([]any, len(v))
		for i, child := range v {
			var err error
			out[i], err = bind(child, input, completed, depth+1)
			if err != nil {
				return nil, err
			}
		}
		return out, nil
	default:
		return value, nil
	}
}

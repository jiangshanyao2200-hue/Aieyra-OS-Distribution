// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: API/parameters/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: cloneOptions; ValidValue; Number
// Impact: python -B scripts/code-atlas.py show API/parameters/values.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package parameters

import (
	"encoding/json"
	"math"
)

func cloneOptions(o map[string]any) map[string]any {
	if o == nil {
		return nil
	}
	b, _ := json.Marshal(o)
	var out map[string]any
	_ = json.Unmarshal(b, &out)
	return out
}
func ValidValue(f Spec, value any) bool {
	switch f.Type {
	case "boolean":
		_, ok := value.(bool)
		return ok
	case "enum":
		v, ok := value.(string)
		if !ok {
			return false
		}
		for _, x := range f.Values {
			if x == v {
				return true
			}
		}
		return false
	case "strings":
		v, ok := value.([]any)
		if !ok || len(v) > 4 {
			return false
		}
		for _, x := range v {
			t, ok := x.(string)
			if !ok || t == "" || len(t) > 1024 {
				return false
			}
		}
		return true
	case "number", "integer":
		v, ok := Number(value)
		return ok && !math.IsNaN(v) && !math.IsInf(v, 0) && v >= f.Min && v <= f.Max && (f.Type != "integer" || math.Trunc(v) == v)
	}
	return false
}
func Number(value any) (float64, bool) {
	switch v := value.(type) {
	case float64:
		return v, true
	case int:
		return float64(v), true
	case json.Number:
		n, e := v.Float64()
		return n, e == nil
	}
	return 0, false
}

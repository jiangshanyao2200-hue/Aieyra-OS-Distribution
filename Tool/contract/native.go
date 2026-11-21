// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Tool/contract/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: NativeTool; DecodeNative
// Impact: python -B scripts/code-atlas.py show Tool/contract/native.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package contract

// Native packages describe compiled host adapters. The host must separately
// match the entire package digest against its compiled trust catalogue before
// accepting one. Importing source never executes or replaces native code.
type NativeTool struct {
	Schema  string   `json:"schema"`
	Name    string   `json:"name"`
	Aliases []string `json:"aliases"`
}

func DecodeNative(raw []byte) (NativeTool, error) {
	var result NativeTool
	err := strictJSON(raw, &result)
	return result, err
}

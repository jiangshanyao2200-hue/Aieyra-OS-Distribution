// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Contracts/protocol/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: SchemaObject; SchemaString; SchemaStrings; SchemaEnum
// Impact: python -B scripts/code-atlas.py show Contracts/protocol/schema.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package protocol

func SchemaObject(props map[string]any, required ...string) map[string]any {
	return map[string]any{"type": "object", "properties": props, "required": append([]string{}, required...), "additionalProperties": false}
}
func SchemaString() map[string]any  { return map[string]any{"type": "string"} }
func SchemaStrings() map[string]any { return map[string]any{"type": "array", "items": SchemaString()} }
func SchemaEnum(values ...string) map[string]any {
	return map[string]any{"type": "string", "enum": values}
}

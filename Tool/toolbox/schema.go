// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Tool/toolbox/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: Query; textInput; enumInput; integerInput; pageInput; query; Queries
// Impact: python -B scripts/code-atlas.py show Tool/toolbox/schema.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package toolbox

// Query is a public input shape for an explicit call, not an instruction to
// preexecute it. Observation can capture private data; recovery changes state;
// even content queries can initialize the owning service's storage.
type Query struct {
	Action string         `json:"action"`
	Effect string         `json:"effect"`
	Input  map[string]any `json:"input"`
	Host   string         `json:"-"`
}

func textInput() map[string]any { return map[string]any{"type": "string", "minLength": 1} }
func enumInput(values ...string) map[string]any {
	return map[string]any{"type": "string", "enum": values}
}
func integerInput(minimum int) map[string]any {
	return map[string]any{"type": "integer", "minimum": minimum}
}
func pageInput() map[string]any {
	return map[string]any{"offset": integerInput(0), "limit": map[string]any{"type": "integer", "minimum": 1, "maximum": 100}}
}
func query(action, effect string, properties map[string]any, required ...string) Query {
	if properties == nil {
		properties = map[string]any{}
	}
	properties["action"] = enumInput(action)
	return Query{Action: action, Effect: effect, Input: map[string]any{
		"type": "object", "properties": properties,
		"required": append([]string{"action"}, required...), "additionalProperties": false,
	}}
}

// Queries returns independent maps/slices on every call. These are deliberately
// small subsets of existing contracts; the opened manual covers other actions.
// No user configuration, private prompt text or returned values are embedded.
func Queries(name string) []Query {
	switch name {
	case "settings":
		properties := pageInput()
		properties["scope"] = enumInput("config", "profile", "appearance", "interface", "runtime", "prompt", "runtime_prompt")
		properties["query"] = textInput()
		return []Query{
			query("schema", "query", properties),
			query("inspect", "query", map[string]any{"scope": enumInput("config", "profile", "appearance", "interface", "runtime")}, "scope"),
		}
	case "software_api":
		rows := []Query{
			query("describe", "query", nil), query("modules", "query", nil),
			query("receipt", "query", map[string]any{"request_id": textInput(), "operation_session": textInput()}, "request_id"),
		}
		for i := range rows {
			rows[i].Host = "os_matrix"
		}
		return rows
	case "server":
		return []Query{query("list", "query", nil)}
	case "video_gen":
		return []Query{query("list", "query", pageInput()), query("status", "query", map[string]any{"request_id": textInput()}, "request_id"), query("recover", "recovery", map[string]any{"request_id": textInput()}, "request_id"), query("query", "network_query", map[string]any{"request_id": textInput()}, "request_id"), query("download", "download", map[string]any{"request_id": textInput()}, "request_id")}
	case "image_gen":
		status, recover := pageInput(), pageInput()
		status["batch_id"], recover["batch_id"] = textInput(), textInput()
		return []Query{query("list", "query", pageInput()), query("status", "query", status, "batch_id"), query("recover", "recovery", recover, "batch_id")}
	case "browser":
		return []Query{query("tabs", "query", nil), query("snapshot", "observation", map[string]any{"tab_id": textInput()}, "tab_id")}
	case "computer":
		return []Query{query("list", "observation", map[string]any{"pid": integerInput(1)}), query("observe", "observation", map[string]any{"window_id": textInput()}, "window_id")}
	}
	return nil
}

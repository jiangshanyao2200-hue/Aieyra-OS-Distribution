// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: modelRuntimePrefix
// Impact: python -B scripts/code-atlas.py show Core/model_runtime_capabilities.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

// Protocol facts follow the selected wire transport. Editable personality/work
// layers and original conversation messages are preserved; unavailable local
// runtime instructions are not advertised as executable capabilities.
func modelRuntimePrefix(settings *Settings, prefix []Message, tools []ToolDefinition) ([]Message, []ToolDefinition) {
	if !requestProfile(settings, false).TextOnly {
		return prefix, tools
	}
	request := make([]Message, 0, len(prefix)+1)
	for _, message := range prefix {
		switch message.Name {
		case "aieyra_shell_runtime", "conversation_work", "core_link_catalog", "aieyra_toolbox_catalogue", "workspace_role_contract", "capability_reference", "canvas_communication", "memory_runtime_contract", "matrix_child_contract":
			continue
		}
		request = append(request, message)
	}
	request = append(request, Message{Role: RoleSystem, Name: "aieyra_transport_capabilities", Content: string(rawJSON(map[string]any{
		"response_transport": "text_only", "local_tools": []string{}, "local_filesystem_access": false,
		"local_browser_access": false, "local_artifact_delivery": false,
		"remote_environment": "Any provider-side computer and files are separate from the user's Aieyra OS workspace.",
	}))})
	return request, nil
}

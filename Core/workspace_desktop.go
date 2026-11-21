// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: workspaceDesktopAction; desktopToolDefinition
// Impact: python -B scripts/code-atlas.py show Core/workspace_desktop.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

// OS 桌面工具经现有宿主桥接执行。Workspace 画布与 Editor 已移出 Aieyra OS
// ，这里只保留 Link 与 Eyra 输入。
func workspaceDesktopAction(action string) bool {
	switch action {
	case "link_status", "link_open", "eyra_open", "eyra_close":
		return true
	}
	return false
}

func desktopToolDefinition(d ToolDefinition) ToolDefinition {
	properties := d.Parameters.(map[string]any)["properties"].(map[string]any)
	actions := properties["action"].(map[string]any)
	actions["enum"] = append(actions["enum"].([]string), "link_status", "link_open", "eyra_open", "eyra_close")
	d.Description += runtimePrompt("Matrix/工具说明/桌面操作补充.txt")
	return d
}

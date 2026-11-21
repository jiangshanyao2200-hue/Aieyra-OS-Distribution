// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: LinkToolDefinition; hostPluginTool; capabilityRow; capabilityReference
// Impact: python -B scripts/code-atlas.py show Core/host_plugins.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

func LinkToolDefinition() ToolDefinition {
	return ToolDefinition{Type: "function", Name: "link", Description: runtimePrompt("Matrix/工具说明/Link办公室.txt"), Parameters: map[string]any{
		"type": "object", "properties": map[string]any{"action": schemaString()}, "required": []string{"action"}, "additionalProperties": true,
	}}
}

// link、server 由桌面宿主执行：宿主持有办公室连接、SSH 凭据，模型只看到结果。
func hostPluginTool(ctx context.Context, name string, raw json.RawMessage) (json.RawMessage, error) {
	c, ok := ctx.Value(workspaceContextKey{}).(workspaceContext)
	bound, program := ctx.Value(programAgentContextKey{}).(programAgentContext)
	if !program && (!ok || c.workspace == nil || c.workspace.service == nil || c.workspace.Mode() != HostOS || c.workspace.isTerminal()) {
		return nil, fmt.Errorf("%s 只在 Aieyra OS 桌面可用", name)
	}
	if name == "server" {
		var p struct {
			Action    string `json:"action"`
			Confirmed bool   `json:"confirmed"`
		}
		if json.Unmarshal(raw, &p) != nil {
			return nil, fmt.Errorf("arguments 必须为对象")
		}
		if (p.Action == "add" || p.Action == "probe" || p.Action == "remove" || p.Action == "vault_remove") && !p.Confirmed {
			return nil, fmt.Errorf("这一步会改动用户的服务器或列表：先用 ask_user 征得同意，再带 confirmed=true 调用")
		}
	}

	if program {
		return bound.serviceCall(ctx, name, raw)
	}
	return c.workspace.service.CallTool(ctx, name, c.workspace.state.ID, raw)
}

type capabilityRow struct {
	Name    string `json:"name"`
	Kind    string `json:"kind"`
	Summary string `json:"summary"`
	Use     string `json:"use"`
}

// 宿主在启动、安装、卸载时重写这份清单，这里每次请求都读，新东西不用等重启。
func (w *Workspace) capabilityReference() string {
	if w.host == nil {
		return ""
	}
	data, err := os.ReadFile(filepath.Join(PrivatePaths(w.host.config).Runtime, "capabilities.json"))
	if err != nil || len(data) > 1<<18 {
		return ""
	}
	var doc struct {
		Items []capabilityRow `json:"items"`
	}
	if json.Unmarshal(data, &doc) != nil || len(doc.Items) == 0 {
		return ""
	}
	var b strings.Builder
	b.WriteString(runtimePrompt("Matrix/辅助指令/本机能力.txt"))
	for _, row := range doc.Items {
		b.WriteString("\n- " + row.Name + "（" + row.Kind + "）：" + row.Summary)
		if row.Use != "" {
			b.WriteString(" 用法：" + row.Use)
		}
	}
	return b.String()
}

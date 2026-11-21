// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestToolboxActivitySaysWhatItDid
// Impact: python -B scripts/code-atlas.py show Core/activity_title_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"strings"
	"testing"
)

// 工具记录说清楚做了什么，内部编号不显示。
func TestToolboxActivitySaysWhatItDid(t *testing.T) {
	call := ToolCall{ID: "c", Function: FunctionCall{Name: "toolbox", Arguments: `{"action":"call","name":"settings","arguments":{"action":"model_test","model_id":"matrix-8b397e3e60a72f766204"}}`}}
	v := activityPreview(call, "c", "")
	if v.Tool != "settings" || v.Action != "model_test" || v.Title != "测试模型响应" {
		t.Fatal(v.Tool, v.Action, v.Title)
	}
	if strings.Contains(strings.Join(v.Targets, " "), "matrix-") {
		t.Fatal(v.Targets)
	}
	named := ToolCall{ID: "d", Function: FunctionCall{Name: "toolbox", Arguments: `{"action":"call","name":"browser","arguments":{"action":"navigate","url":"https://example.com/"}}`}}
	if v := activityPreview(named, "d", ""); len(v.Targets) != 1 || v.Targets[0] != "https://example.com/" {
		t.Fatal(v.Targets)
	}
	unknown := ToolCall{ID: "e", Function: FunctionCall{Name: "toolbox", Arguments: `{"action":"call","name":"settings","arguments":{"action":"never_seen"}}`}}
	if v := activityPreview(unknown, "e", ""); v.Title != "" {
		t.Fatal("raw action shown", v.Title)
	}
}

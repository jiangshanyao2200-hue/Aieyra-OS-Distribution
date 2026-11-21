// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: ExecRequest; WaitRequest; ExecOutput; NestedToolRecord; ExecResult; IsRuntimeTool; IsDisplayTool; executionNestedTools; OrchestrationToolDefinitions; Display; InspectorText; Display; RuntimeToolPreview; ToolDisplayResult
// Impact: python -B scripts/code-atlas.py show Core/orchestration_tools.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"encoding/json"
	"fmt"
	viewcontract "github.com/aieyra/aieyra-os/tool/base/official/view_image/contract"
	viewtext "github.com/aieyra/aieyra-os/tool/base/official/view_image/presentation/text"
	"strings"
)

type ExecRequest struct {
	Code            string `json:"code"`
	Description     string `json:"description,omitempty"`
	YieldTimeMS     *int   `json:"yield_time_ms,omitempty"`
	MaxOutputTokens int    `json:"max_output_tokens,omitempty"`
}

type WaitRequest struct {
	CellID      string `json:"cell_id"`
	YieldTimeMS *int   `json:"yield_time_ms,omitempty"`
	MaxTokens   int    `json:"max_tokens,omitempty"`
	Terminate   bool   `json:"terminate,omitempty"`
}

type ExecOutput struct {
	Type    string `json:"type"`
	Text    string `json:"text,omitempty"`
	ImageID string `json:"image_id,omitempty"`
}

type NestedToolRecord struct {
	ID     int      `json:"id"`
	Call   ToolCall `json:"call"`
	Output string   `json:"output,omitempty"`
	State  string   `json:"state"`
}

type ExecResult struct {
	OK          bool         `json:"ok"`
	State       string       `json:"state"`
	CellID      string       `json:"cell_id,omitempty"`
	Description string       `json:"description,omitempty"`
	Output      []ExecOutput `json:"output,omitempty"`
	HasMore     bool         `json:"has_more,omitempty"`
	Error       *ShellError  `json:"error,omitempty"`
	// 详细调用/原始结果只进入本地查看器，不反复回传模型。
	Records []NestedToolRecord `json:"-"`
}

func IsRuntimeTool(name string) bool { return name == "exec" || name == "wait" || name == "view_image" }
func IsDisplayTool(name string) bool {
	return IsShellTool(name) || IsRuntimeTool(name) || name == "toolbox" || name == "agents"
}

// The worker and model documentation share this list so a newly documented
// nested method can never silently be absent from the execution cell.
var executionNestedTools = [...]string{"terminal", "exec_command", "write_stdin", "read_shell_output", "apply_patch", "view_image"}

func OrchestrationToolDefinitions() []ToolDefinition {
	yield := map[string]any{"type": "integer", "minimum": 0, "maximum": 30000, "description": "Time to await new output/completion. 0 returns immediately. Default exec 1000 ms, wait 10000 ms; does not stop the execution cell."}
	nested := "tools." + strings.Join(executionNestedTools[:], ", tools.")
	return []ToolDefinition{
		{Type: "function", Name: "exec", Description: runtimePrompt("Matrix/工具说明/运行脚本.txt") + nested + runtimePrompt("Matrix/工具说明/异步调用.txt"), Parameters: schemaObject(map[string]any{"code": schemaString(), "description": schemaString(), "yield_time_ms": yield, "max_output_tokens": map[string]any{"type": "integer", "minimum": 1, "maximum": 32000}}, "code")},
		{Type: "function", Name: "wait", Description: runtimePrompt("Matrix/工具说明/继续脚本.txt"), Parameters: schemaObject(map[string]any{"cell_id": schemaString(), "yield_time_ms": yield, "max_tokens": map[string]any{"type": "integer", "minimum": 1, "maximum": 32000}, "terminate": map[string]any{"type": "boolean"}}, "cell_id")},
	}
}

func (r ExecResult) Display() ShellResult {
	return ShellResult{OK: r.OK, State: r.State, Description: r.Description, Error: r.Error, Exec: &r}
}

// 完整原始文本只在用户打开查看器时生成，普通 30fps 帧不重复拼接日志。
func (r ExecResult) InspectorText() string {
	var b strings.Builder
	for _, item := range r.Output {
		if item.Type == "text" {
			b.WriteString(item.Text + "\n")
		} else {
			fmt.Fprintf(&b, "图片快照 %s\n", item.ImageID)
		}
	}
	for _, item := range r.Records {
		fmt.Fprintf(&b, "\n%s · %s\n%s\n%s\n", item.Call.Function.Name, item.State, item.Call.Function.Arguments, item.Output)
	}
	return b.String()
}

func (r ImageResult) Display() ShellResult {
	return ShellResult{OK: r.OK, State: r.State, Description: r.Description, Error: (*ShellError)(r.Error), Image: &r, Output: viewtext.Summary(viewcontract.Result(r))}
}

func RuntimeToolPreview(call ToolCall) ShellResult {
	if call.Function.Name == "agents" {
		return ShellResult{State: "queued", Description: "智能体", System: &ToolboxResult{}}
	}
	if call.Function.Name == "toolbox" {
		var a struct {
			Action string
			Name   string
		}
		_ = json.Unmarshal([]byte(call.Function.Arguments), &a)
		return ShellResult{State: "queued", Description: toolboxDescription(call), System: &ToolboxResult{}}
	}
	if call.Function.Name == "view_image" {
		return imageResultFromCall(call).Display()
	}
	var args struct {
		Description string `json:"description"`
		CellID      string `json:"cell_id"`
	}
	_ = json.Unmarshal([]byte(call.Function.Arguments), &args)
	if args.Description == "" {
		args.Description = "编排工具"
		if call.Function.Name == "wait" {
			args.Description = "等待编排结果"
		}
	}
	return ExecResult{State: "queued", CellID: args.CellID, Description: args.Description}.Display()
}

func ToolDisplayResult(call ToolCall, output string) (ShellResult, error) {
	if call.Function.Name == "toolbox" || call.Function.Name == "agents" {
		var r ToolboxResult
		err := json.Unmarshal([]byte(output), &r)
		return ShellResult{OK: r.OK, State: r.State, Description: r.Description, Output: string(r.Data), Error: r.Error, System: &r}, err
	}
	if call.Function.Name == "exec" || call.Function.Name == "wait" {
		var r ExecResult
		err := json.Unmarshal([]byte(output), &r)
		if r.Description == "" {
			r.Description = RuntimeToolPreview(call).Description
		}
		return r.Display(), err
	}
	if call.Function.Name == "view_image" {
		r := imageResultFromCall(call)
		err := json.Unmarshal([]byte(output), &r)
		return r.Display(), err
	}
	if IsLegacyFileTool(call.Function.Name) {
		var r LegacyFileResult
		if err := json.Unmarshal([]byte(output), &r); err != nil {
			return ShellResult{}, err
		}
		preview := LegacyFilePreview(call)
		r.Tool = call.Function.Name
		if r.Path == "" {
			r.Path = preview.Path
		}
		if r.Detail == "" {
			r.Detail = preview.Detail
		}
		if r.Description == "" {
			r.Description = preview.Description
		}
		return r.Display(), nil
	}
	var r ShellResult
	err := json.Unmarshal([]byte(output), &r)
	return r, err
}

// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: ToolboxCatalog; toolboxManuals; settingsManual; ToolboxDefinition; ToolboxState; Clone; Details; ToolboxResult; Execute; failWithData; toolboxDescription; toolboxDescribe; toolboxContextKey; toolboxExecution; WithToolbox; executeToolbox; RestoreToolbox
// Impact: python -B scripts/code-atlas.py show Core/toolbox.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	toolcontract "github.com/aieyra/aieyra-os/tool/contract"
	toolruntime "github.com/aieyra/aieyra-os/tool/runtime"
	toolboxowner "github.com/aieyra/aieyra-os/tool/toolbox"
	"sort"
	"strings"
)

func ToolboxCatalog() string { return runtimePrompt("Matrix/工具说明/目录.txt") }

func toolboxManuals() map[string]string {
	manuals := map[string]string{}
	for _, entry := range toolboxowner.Catalog() {
		if entry.Name == "video_gen" {
			manuals[entry.Name] = VideoGenManual()
		} else if entry.Name == "image_gen" {
			manuals[entry.Name] = ImageGenManual()
		} else {
			manuals[entry.Name] = runtimePrompt(entry.Manual)
		}
	}
	return manuals
}

func settingsManual() string { return runtimePrompt("Matrix/工具说明/设置.txt") }

func ToolboxDefinition() ToolDefinition {
	return ToolDefinition{Type: "function", Name: "toolbox", Description: runtimePrompt("Matrix/工具说明/工具箱操作.txt"), Parameters: schemaObject(map[string]any{
		"action":    schemaEnum("list", "open", "close", "call"),
		"section":   schemaEnum("settings", "software", "tools"),
		"name":      map[string]any{"type": "string", "description": "Required for open, close and call. Use an available tool name from the caller's catalogue."},
		"arguments": map[string]any{"type": "object", "additionalProperties": true, "description": "Required for action=call. Put the complete target tool input inside this object, including its own action and other fields from the opened manual. Omit for list/open/close."},
	}, "action")}
}

type ToolboxState struct {
	Manuals  map[string]string `json:"manuals,omitempty"`
	Open     map[string]bool   `json:"open"`
	ChoiceID string            `json:"-"`
}

func (t *ToolboxState) Clone() *ToolboxState {
	r := &ToolboxState{Open: map[string]bool{}}
	if t != nil {
		r.Manuals = map[string]string{}
		for k, v := range t.Manuals {
			r.Manuals[k] = v
		}
		for k, v := range t.Open {
			r.Open[k] = v
		}
	}
	return r
}
func (t *ToolboxState) Details() string {
	if t == nil || !CurrentReleaseStage().Toolbox {
		return ""
	}
	var names []string
	for k, v := range t.Open {
		if v && stageToolAllowed(k) {
			names = append(names, k)
		}
	}
	sort.Strings(names)
	var parts []string
	manuals := toolboxManuals()
	for _, k := range names {
		if v, ok := manuals[k]; ok {
			label := k
			if section := toolboxowner.SystemSection(k); section != "" {
				label = "system section=" + section + " (legacy name=" + k + ")"
			}
			parts = append(parts, label+": "+v)
		} else if v := t.Manuals[k]; v != "" {
			parts = append(parts, k+": "+v)
		}
	}
	return strings.Join(parts, "\n")
}

type ToolboxResult struct {
	Package          string            `json:"package,omitempty"`
	CellID           string            `json:"cell_id,omitempty"`
	PreviewTruncated bool              `json:"preview_truncated,omitempty"`
	Presentation     *ToolPresentation `json:"presentation,omitempty"`
	OK               bool              `json:"ok"`
	State            string            `json:"state"`
	Description      string            `json:"description"`
	Output           string            `json:"output,omitempty"`
	Error            *ShellError       `json:"error,omitempty"`
	Open             map[string]bool   `json:"open,omitempty"`
	Data             json.RawMessage   `json:"data,omitempty"`
	Manuals          map[string]string `json:"manuals,omitempty"`
}

func (t *ToolboxState) Execute(ctx context.Context, config string, call ToolCall) ToolboxResult {
	r := ToolboxResult{State: "failed", Description: "工具箱"}
	fail := func(msg string) ToolboxResult { r.Error = &ShellError{Code: "toolbox_error", Message: msg}; return r }
	if !CurrentReleaseStage().Toolbox {
		return fail("Toolbox 在基础能力阶段暂未开放")
	}
	if ctx.Err() != nil {
		return fail("操作已取消")
	}
	var a struct {
		Action    string          `json:"action"`
		Name      string          `json:"name"`
		Section   string          `json:"section"`
		Arguments json.RawMessage `json:"arguments"`
	}
	if err := json.Unmarshal([]byte(call.Function.Arguments), &a); err != nil {
		return fail("工具箱参数必须为 JSON 对象")
	}
	if a.Name == "system" && a.Action != "list" {
		a.Name = toolboxowner.SystemTarget(a.Section)
		if a.Name == "" {
			return fail("system requires section=settings (configuration), software (OS modules), or tools (tool factory)")
		}
	}
	if t.Open == nil {
		t.Open = map[string]bool{}
	}
	r.Description = toolboxDescription(call)
	if a.Action == "list" {
		r.Output = workspaceToolboxCatalog(ctx)
	} else {
		if !toolAllowed(ctx, a.Name) {
			return fail("tool_not_assigned: " + a.Name)
		}
		if _, ok := toolboxowner.Find(a.Name); !ok && !toolcontract.VersionedID(a.Name) {
			return fail("未知工具")
		}
		if a.Action == "call" {
			if err := admitOfficialToolCall(ctx, ToolCall{Function: FunctionCall{Name: a.Name, Arguments: string(a.Arguments)}}); err != nil {
				return fail(err.Error())
			}
		}
		switch a.Action {
		case "open":
			if toolcontract.VersionedID(a.Name) {
				manager, ok := ctx.Value(agentManagerKey{}).(agentManagerContext)
				if !ok || manager.manager == nil {
					return fail("工具注册服务未初始化")
				}
				v, err := manager.manager.versionedTool(ctx, a.Name)
				if err != nil {
					return fail(err.Error())
				}
				r.Presentation = v.Presentation
				if toolcontract.ValidPackageID(a.Name) {
					r.Package = a.Name
				}
				if toolcontract.ValidPackageID(v.ID) {
					if err = versionedToolPermitted(ctx, v); err != nil {
						return fail(err.Error())
					}
				} else {
					for _, cap := range v.Capabilities {
						if !toolAllowed(ctx, cap) {
							return fail("tool_not_assigned: " + cap)
						}
					}
				}
				if t.Manuals == nil {
					t.Manuals = map[string]string{}
				}
				b, _ := json.Marshal(v.Schema)
				t.Manuals[a.Name] = v.Manual + " Input schema: " + string(b)
			}
			t.Open[a.Name] = true
			r.Output = toolboxOpenedDescription(ctx, a.Name)
		case "close":
			delete(t.Open, a.Name)
			delete(t.Manuals, a.Name)
			r.Output = "Tool closed. Detailed instructions removed from subsequent requests."
		case "call":
			if !t.Open[a.Name] {
				return fail("请先打开该工具")
			}
			// Reject before any capability dispatch. Missing input is never an
			// invitation to infer or replay a potentially mutating operation.
			a.Arguments = bytes.TrimSpace(a.Arguments)
			if len(a.Arguments) == 0 || a.Arguments[0] != '{' {
				r.Error = &ShellError{Code: "invalid_toolbox_arguments", Message: "action=call 必须包含 arguments 对象：把目标工具的完整输入（含它自己的 action）放在 arguments 内，不能省略、传 null、字符串或放到外层。请按已打开的手册重新构造调用；本次未派发目标工具。"}
				return r
			}
			if a.Name == "human" {
				manager, ok := ctx.Value(agentManagerKey{}).(agentManagerContext)
				if !ok || manager.manager == nil {
					return fail("人工事项服务未初始化")
				}
				data, err := manager.manager.requestHuman(ctx, manager.owner, a.Arguments)
				if err != nil {
					return fail(err.Error())
				}
				r.Data, _ = json.Marshal(data)
				r.Output = "Human request prepared. This task pauses only after this tool transaction is durably committed; no decision has been made."
				break
			}
			if a.Name == "tool_factory" || toolcontract.VersionedID(a.Name) {
				manager, ok := ctx.Value(agentManagerKey{}).(agentManagerContext)
				if !ok || manager.manager == nil {
					return fail("工具注册服务未初始化")
				}
				if a.Name == "tool_factory" {
					data, err := manager.manager.toolFactory(ctx, a.Arguments)
					if err != nil {
						return fail(err.Error())
					}
					r.Data, _ = json.Marshal(data)
				} else {
					if toolcontract.ValidPackageID(a.Name) && manager.manager.savedWorkflow(ctx, manager.owner, a.Name, a.Arguments) {
						return t.workflowResult(ctx, manager, a.Name, a.Arguments)
					}
					v, err := manager.manager.versionedTool(ctx, a.Name)
					if err != nil {
						return fail(err.Error())
					}
					r.Presentation = v.Presentation
					if toolcontract.ValidPackageID(a.Name) {
						r.Package = a.Name
					}
					for _, cap := range v.Capabilities {
						if !toolAllowed(ctx, cap) {
							return fail("tool_not_assigned: " + cap)
						}
					}
					if v.Kind == "workbox" {
						return t.workflowResult(ctx, manager, a.Name, a.Arguments)
					}
					source, err := toolruntime.JavaScript(v.CustomTool, a.Arguments)
					if err != nil {
						return fail(err.Error())
					}
					if err = versionedToolPermitted(ctx, v); err != nil {
						return fail(err.Error())
					}
					if manager.shell == nil {
						return fail("Shell executor unavailable")
					}
					encoded, _ := json.Marshal(ExecRequest{Code: source, Description: utf8Prefix(v.Description, 256)})
					identity, _ := ctx.Value(toolInvocationKey{}).(string)
					if identity == "" {
						identity = call.ID
					}
					result, _ := manager.shell.execution.execute(WithToolPermissions(ctx, v.Capabilities), ToolCall{ID: call.ID, Function: FunctionCall{Name: "exec", Arguments: string(encoded)}}, identity)
					r.Data, _ = json.Marshal(result)
					r.State, r.CellID, r.OK, r.Error = result.State, result.CellID, result.OK, result.Error
					r.Output = "See data for the versioned tool receipt; a running cell requires wait."
					r.Open, r.Manuals = t.Clone().Open, t.Clone().Manuals
					return r
				}
				r.Output = "See data for the versioned tool receipt; a running cell requires wait."
				break
			}
			if a.Name == "compact" {
				var p map[string]any
				if json.Unmarshal(a.Arguments, &p) != nil || p == nil || len(p) != 0 {
					return fail("compact arguments 必须为空对象")
				}
				data, err := requestContextCompaction(ctx, map[string]any{"action": "compact"}, call.ID)
				if err != nil {
					return fail(err.Error())
				}
				r.Data = rawJSON(data)
				r.Output = "Compaction scheduled at the next safe boundary; not yet completed."
				break
			}
			if a.Name == "browser" || a.Name == "computer" {
				if len(a.Arguments) == 0 || !json.Valid(a.Arguments) || a.Arguments[0] != '{' {
					return fail("arguments 必须为对象")
				}
				service, ok := ctx.Value(settingsServiceKey{}).(settingsServiceContext)
				if !ok || service.client == nil {
					return fail("交互服务未初始化")
				}
				owner := service.session
				if a.Name == "browser" {
					var err error
					owner, err = browserToolSession(ctx, owner)
					if err != nil {
						return fail(err.Error())
					}
				}
				data, err := service.client.CallTool(ctx, a.Name, owner, a.Arguments)
				if err != nil {
					return fail(err.Error())
				}
				r.Data = data
				var outcome struct {
					OK bool `json:"ok"`
				}
				if json.Unmarshal(data, &outcome) != nil || !outcome.OK {
					return failWithData(r, "交互操作未完成，请查看 data")
				}
				r.Output = "Interaction completed; see data."
				break
			}
			if a.Name == "project" {
				data := executeWorkspaceTool(ctx, ToolCall{ID: call.ID, Function: FunctionCall{Name: "project", Arguments: string(a.Arguments)}})
				r.Data, _ = json.Marshal(data)
				var outcome struct {
					OK    *bool  `json:"ok"`
					Error string `json:"error"`
				}
				_ = json.Unmarshal(r.Data, &outcome)
				if outcome.OK != nil && !*outcome.OK || outcome.Error != "" {
					return failWithData(r, "项目操作未完成，请查看 data")
				}
				r.Output = "Project operation returned; see data."
				break
			}
			if a.Name == "agents" {
				if len(a.Arguments) == 0 || !json.Valid(a.Arguments) || a.Arguments[0] != '{' {
					return fail("arguments 必须为对象")
				}
				manager, ok := ctx.Value(agentManagerKey{}).(agentManagerContext)
				if !ok || manager.manager == nil {
					return fail("专项 Agent 服务未初始化")
				}
				data, err := manager.manager.Call(ctx, manager.owner, a.Arguments)
				if err != nil {
					return fail(err.Error())
				}
				r.Data, _ = json.Marshal(data)
				r.Output = "Agent scheduling completed; inspect data and independently review the result."
				break
			}
			if a.Name == "video_gen" {
				data, err := runVideoGen(ctx, config, a.Arguments)
				r.Data, _ = json.Marshal(data)
				if err != nil {
					return fail(err.Error())
				}
				r.Output = "Video task receipt saved; inspect its actual state and recovery instructions."
				break
			}
			if a.Name == "image_gen" {
				if c, ok := ctx.Value(workspaceContextKey{}).(workspaceContext); ok && c.workspace != nil {
					ctx = context.WithValue(ctx, imageGenTaskKey{}, c.workspace.state.ID)
				}
				data, err := runImageGen(ctx, config, a.Arguments)
				if err != nil {
					r.Data, _ = json.Marshal(data)
					return fail(err.Error())
				}
				r.Data, _ = json.Marshal(data)
				r.Output = runtimePrompt("Matrix/辅助指令/生成图片读回.txt")
				break
			}
			if a.Name == "software_api" {
				data, handled, normalized, err := softwareAPICall(ctx, a.Arguments, call.ID)
				if handled {
					r.Data = data
					if err != nil {
						return failWithData(r, err.Error())
					}
					var outcome struct {
						OK bool `json:"ok"`
					}
					if json.Unmarshal(data, &outcome) != nil || !outcome.OK {
						return failWithData(r, "软件操作未完成，请查看 data 中的实际状态和回执")
					}
					r.Output = "Software operation returned an observed result; see data."
					break
				}
				a.Arguments = normalized
			}
			if a.Name == "link" || a.Name == "server" {
				data, err := hostPluginTool(ctx, a.Name, a.Arguments)
				if err != nil {
					return fail(err.Error())
				}
				r.Data = data
				r.Output = "Operation completed; see data."
				break
			}
			if a.Name == "community" || a.Name == "cloud_report" {
				data, err := toolboxRouted(ctx, a.Name, a.Arguments)
				if err != nil {
					r.Data = data
					return fail(err.Error())
				}
				if data != nil {
					r.Data = data
					r.Output = "Operation completed; see data."
					break
				}
				// software_api 的其余动作走下面的 settings 服务。
			}
			if a.Name == "settings" || a.Name == "software_api" {
				data, handled, err := workspaceSettings(ctx, a.Arguments)
				if handled {
					if err != nil {
						return fail(err.Error())
					}
					r.Data = data
					var outcome struct {
						OK bool `json:"ok"`
					}
					_ = json.Unmarshal(data, &outcome)
					if !outcome.OK {
						return failWithData(r, "设置操作未完成，请查看 data")
					}
					break
				}
			}
			var p map[string]json.RawMessage
			if json.Unmarshal(a.Arguments, &p) != nil {
				return fail("settings arguments 必须为对象")
			}
			var action string
			_ = json.Unmarshal(p["action"], &action)
			if _, worker := ctx.Value(toolPermissionsKey{}).(map[string]bool); worker && (action == "choose_model" || action == "choice_result" || action == "choice_cancel") {
				return fail("专项 Agent 不能等待用户选型，请将选择需求交回 Matrix")
			}
			delete(p, "action")
			args, _ := json.Marshal(p)
			service, ok := ctx.Value(settingsServiceKey{}).(settingsServiceContext)
			if !ok || service.client == nil {
				return fail("设置服务未初始化")
			}
			data, err := service.client.Call(ctx, service.session, action, args)
			if err != nil {
				return fail(err.Error())
			}
			r.Data = data
			var outcome struct {
				OK        bool   `json:"ok"`
				RequestID string `json:"request_id"`
				State     string `json:"state"`
			}
			_ = json.Unmarshal(data, &outcome)
			if !outcome.OK {
				return failWithData(r, "设置操作未完成，请查看 data")
			}
			if action == "choose_model" && outcome.State == "pending" {
				t.ChoiceID = outcome.RequestID
			}
			r.Output = "Settings operation completed; see data."
		default:
			return fail(fmt.Sprintf("未知工具箱操作 %q", a.Action))
		}
	}
	r.OK = true
	r.State = "completed"
	r.Open = t.Clone().Open
	r.Manuals = t.Clone().Manuals
	return r
}
func failWithData(r ToolboxResult, msg string) ToolboxResult {
	r.Error = &ShellError{Code: "toolbox_operation_failed", Message: msg}
	return r
}

func toolboxDescription(call ToolCall) string {
	text, _ := toolboxDescribe(call)
	return text
}

// 返回完整说明和动作本身（比如“测试模型响应”）。动作没有中文说明时第二项为空，由界面兜底。
func toolboxDescribe(call ToolCall) (string, string) {
	var a struct {
		Action    string `json:"action"`
		Name      string `json:"name"`
		Arguments struct {
			Action       string `json:"action"`
			Title        string `json:"title"`
			ID           string `json:"id"`
			URL          string `json:"url"`
			Query        string `json:"query"`
			WindowID     string `json:"window_id"`
			TabID        string `json:"tab_id"`
			ConnectionID string `json:"connection_id"`
			ModelID      string `json:"model_id"`
		} `json:"arguments"`
	}
	_ = json.Unmarshal([]byte(call.Function.Arguments), &a)
	labels := map[string]string{"video_gen": "视频生成", "image_gen": "生图", "software_api": "软件操作", "cloud_report": "云端上报", "community": "社区", "link": "Link 办公室", "server": "服务器管理", "settings": "系统设置", "compact": "整理上下文", "browser": "浏览器", "computer": "电脑操作", "agents": "专项协作", "tool_factory": "专用工具", "human": "人工事项"}
	actions := map[string]string{"request": "请求你的决定", "list": "查看工具", "open": "打开", "close": "关闭", "call": "调用", "tabs": "查看标签", "activate": "切换标签", "upload": "选择附件", "downloads": "查看下载", "download_cancel": "取消下载", "navigate": "访问网页", "search": "搜索网页", "wait_for": "等待页面", "reload": "刷新网页", "handle_dialog": "处理网站提示", "snapshot": "读取网页", "inspect": "读取窗口", "attach": "连接窗口", "detach": "断开窗口", "click": "点击控件", "fill": "填写内容", "set_value": "填写内容", "select": "选择选项", "key": "按键", "keypress": "按键", "scroll": "滚动", "evaluate": "执行页面脚本", "screenshot": "截取画面", "back": "返回", "forward": "前进"}
	label := labels[a.Name]
	if toolcontract.VersionedID(a.Name) {
		label = "专用工具 " + strings.Split(strings.TrimPrefix(a.Name, "custom:"), ".")[0]
		if name, _, ok := toolcontract.ParsePackageID(a.Name); ok {
			label = "工具包 " + name
		}
	}
	if label == "" {
		label = "工具箱"
	}
	// 打开工具说明并未启动浏览器或专项窗口；明确实际效果，避免“系统·打开”。
	if a.Action == "open" {
		return label + " · 载入工具说明", ""
	}
	if a.Action == "close" {
		return label + " · 收起工具说明", ""
	}
	action := a.Action
	if action == "call" && a.Arguments.Action != "" {
		action = a.Arguments.Action
	}
	if a.Name == "software_api" {
		for k, v := range map[string]string{"describe": "读取软件操作规范", "modules": "查看模块状态", "module": "操作模块", "order": "调整模块顺序", "receipt": "查询操作回执", "settings": "调用共享设置"} {
			actions[k] = v
		}
	}
	if a.Name == "settings" || a.Name == "software_api" {
		for k, v := range map[string]string{"connection_recovery": "查看连接恢复点", "connection_restore": "恢复有效连接", "response_test": "检测模型响应", "response_save": "保存模型连接", "connection_draft": "读取连接参数", "read": "读取系统设置", "connections": "查看API连接", "connection_update": "保存API连接", "connection_remove": "删除API连接", "catalog": "获取模型目录", "catalog_add": "加入模型池", "matrix": "读取Matrix参数", "matrix_update": "保存Matrix参数", "model_update": "保存模型参数", "models": "查看可用模型", "pool": "查看模型池", "pool_action": "调整模型池", "parameters_probe": "探测模型参数", "capabilities_refresh": "更新参数资料", "model_test": "测试模型响应", "model_diagnostics": "诊断模型工具与缓存", "switch": "切换模型", "configure": "保存模型连接", "probe": "探测API协议", "appearance_read": "读取显示设置", "appearance_update": "保存显示设置", "choose_model": "请你选择模型", "update": "保存系统设置"} {
			actions[k] = v
		}
	}
	if a.Name == "agents" || a.Name == "tool_factory" {
		for k, v := range map[string]string{"create": "创建任务", "status": "查看进展", "result": "查看交付", "wait": "等待任务", "send": "补充任务", "cancel": "停止任务", "review": "验收任务", "models": "查看模型", "open_window": "展开协作窗口", "hide_window": "收起协作窗口", "activity": "查看执行过程", "events": "读取执行记录", "register": "注册工具", "remove": "移除工具"} {
			actions[k] = v
		}
		if a.Name == "agents" {
			actions["list"] = "查看任务"
		}
	}
	verb := actions[action]
	named := verb
	if action == "call" {
		named = ""
	}
	if verb == "" {
		verb = action
	}
	text := label + " · " + verb
	if a.Action == "call" {
		for _, target := range []string{a.Arguments.Title, a.Arguments.Query, a.Arguments.URL, a.Arguments.ID, a.Arguments.WindowID, a.Arguments.TabID, a.Arguments.ConnectionID} {
			if target != "" {
				text += " · " + utf8Prefix(strings.Join(strings.Fields(target), " "), 240)
				break
			}
		}
		if a.Arguments.ModelID != "" {
			text += " · " + utf8Prefix(a.Arguments.ModelID, 100)
		}
	}
	return text, named
}

type toolboxContextKey struct{}
type toolboxExecution struct {
	state  *ToolboxState
	config string
}

func WithToolbox(ctx context.Context, state *ToolboxState, config string) context.Context {
	return context.WithValue(ctx, toolboxContextKey{}, toolboxExecution{state, config})
}
func executeToolbox(ctx context.Context, call ToolCall) ToolboxResult {
	if v, ok := ctx.Value(toolboxContextKey{}).(toolboxExecution); ok {
		return v.state.Execute(ctx, v.config, call)
	}
	return ToolboxResult{State: "failed", Error: &ShellError{Code: "unavailable", Message: "工具箱未初始化"}}
}

// 只从已提交的收据恢复打开集合，不重新执行任何设置写入。
func RestoreToolbox(messages []Message) *ToolboxState {
	t := &ToolboxState{Open: map[string]bool{}}
	if !CurrentReleaseStage().Toolbox {
		return t
	}
	for _, m := range messages {
		if m.Role == RoleTool && m.Name == "toolbox" {
			var r ToolboxResult
			if json.Unmarshal([]byte(m.Content), &r) == nil && r.OK {
				t.Open = r.Open
				t.Manuals = r.Manuals
			}
		}
	}
	for name := range t.Open {
		if !stageToolAllowed(name) {
			delete(t.Open, name)
			delete(t.Manuals, name)
		}
	}
	return t
}

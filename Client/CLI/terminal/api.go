// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/CLI/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: apiProtocols; apiGroups; apiForm; apiMsg; apiPasteMsg; openAPI; loadAPI; requestAPI; newAPIInput; fillAPI; installAPIParameters; fieldIndex; textFocused; focusAPI; unchangedIdentity; roles; arguments; runAPI; completeAPI; fieldChanged; apiCatalog
// Impact: python -B scripts/code-atlas.py show Client/CLI/terminal/api.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package terminal

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/cursor"
	"github.com/charmbracelet/bubbles/textinput"
	tea "github.com/charmbracelet/bubbletea"
)

var apiProtocols = []string{"responses", "chat_completions", "anthropic_messages", "google_generate"}
var apiGroups = []string{"连接与模型池", "连接", "模型", "参数与预算", "角色"}

type apiForm struct {
	state                                 apiState
	fields                                []textinput.Model
	definitions                           []settingsField
	baseline                              []string
	draft                                 settingsResult
	version, proof                        string
	group, focus, selected, offset, total int
	pending, picking, mainRole, subRole   bool
	initialMain, initialSub               bool
	notice, filter, confirmation          string
	choices                               []settingsModel
	catalog                               []settingsModel
	catalogLocal                          bool
	paramModel, paramProtocol             string
	providerIndex                         int
	request                               int
	schema                                int
	catalogEnd                            bool
	cancel                                context.CancelFunc
	caretRow, caretCol                    int
}
type apiMsg struct {
	epoch, request int
	action         string
	result         settingsResult
	state          apiState
	err            error
}
type apiPasteMsg struct {
	epoch, schema, index int
	text                 string
	err                  error
}

func (c *model) openAPI() tea.Cmd {
	if c.api != nil && c.api.cancel != nil {
		c.api.cancel()
	}
	c.apiEpoch++
	c.api = &apiForm{notice: "正在读取共享 OS 配置", providerIndex: -1}
	c.fillAPI(settingsResult{})
	c.api.group = 0
	if c.opts.Settings == nil {
		c.api.notice = "宿主未提供共享设置服务"
		return nil
	}
	return c.loadAPI()
}

func (c *model) loadAPI() tea.Cmd { return c.requestAPI("load", nil) }

func (c *model) requestAPI(action string, args any) tea.Cmd {
	f := c.api
	if f == nil || f.pending || c.opts.Settings == nil {
		return nil
	}
	f.pending = true
	f.request++
	f.confirmation = ""
	message := map[string]string{"load": "正在读取共享 OS 配置", "draft": "正在读取精确档案", "parameters": "正在读取参数规格", "catalog": "正在读取缓存目录", "catalog_refresh": "正在更新模型目录", "test": "正在检测一次文字响应", "save": "正在保存共享 OS 配置", "update": "正在保存档案参数", "pool_action": "正在更新模型池"}
	f.notice = message[action]
	call, epoch, request := c.opts.Settings, c.apiEpoch, f.request
	ctx, cancel := context.WithTimeout(c.ctx, 60*time.Second)
	if action == "load" || action == "draft" || action == "parameters" || action == "catalog" {
		cancel()
		ctx, cancel = context.WithTimeout(c.ctx, 20*time.Second)
	}
	f.cancel = cancel
	state, version := f.state, f.version
	return func() tea.Msg {
		defer cancel()
		out := apiMsg{epoch: epoch, request: request, action: action}
		if action == "load" {
			var connections, pool, providers settingsResult
			connections, out.err = callSettings(ctx, call, "connections", nil)
			if out.err != nil {
				return out
			}
			pool, out.err = callSettings(ctx, call, "pool", nil)
			if out.err != nil {
				return out
			}
			providers, out.err = callSettings(ctx, call, "onboarding_status", nil)
			if out.err != nil {
				return out
			}
			out.result, out.err = callSettings(ctx, call, "connection_draft", nil)
			if out.err != nil {
				return out
			}
			main := out.result
			out.state = apiState{connections: connections.Connections, models: pool.Models, providers: providers.Providers, main: main.ProfileID, active: pool.Active, subconscious: pool.Subconscious}
			if p, ok := args.(map[string]any); ok && p["id"] != nil && p["id"] != "" && p["id"] != main.ProfileID {
				out.result, out.err = callSettings(ctx, call, "connection_draft", args)
			}
			// Mixing revisions would silently bless an outdated role or connection.
			if out.err == nil && (connections.Version != pool.Version || pool.Version != main.Version || main.Version != out.result.Version) {
				out.err = fmt.Errorf("读取期间配置有变化，请按 F5 重新读取")
			}
			return out
		}
		method := map[string]string{"draft": "connection_draft", "parameters": "onboarding_parameters", "test": "response_test", "save": "response_save", "update": "model_update", "pool_action": "pool_action", "catalog": "catalog", "catalog_refresh": "catalog"}[action]
		if action == "catalog_refresh" {
			if p, ok := args.(map[string]any); ok && p["connection_id"] == nil {
				method = "onboarding_catalog"
			}
		}
		out.result, out.err = callSettings(ctx, call, method, args)
		if action == "draft" && out.err == nil && out.result.Version != version {
			out.err = fmt.Errorf("读取期间配置有变化，请按 F5 重新读取")
		}
		out.state = state
		return out
	}
}

func newAPIInput(def settingsField, value string) textinput.Model {
	f := textinput.New()
	f.Prompt = ""
	f.CharLimit = 16384
	f.Cursor.SetMode(cursor.CursorStatic)
	f.Placeholder = def.Placeholder
	if def.Key == "api_key" {
		f.EchoMode, f.EchoCharacter = textinput.EchoPassword, '•'
		f.Placeholder = "留空使用此地址已存 Key"
	}
	if def.Type == "strings" {
		value = encodeAPIStrings(value)
	}
	f.SetValue(value)
	return f
}

func (c *model) fillAPI(r settingsResult) {
	f := c.api
	f.schema++
	f.draft, f.version, f.proof = r, r.Version, ""
	f.mainRole = r.ProfileID != "" && f.state.main == r.ProfileID
	f.subRole = r.ProfileID != "" && f.state.subconscious == r.ProfileID
	if r.ProfileID == "" {
		f.mainRole = true
	}
	f.initialMain, f.initialSub = f.mainRole, f.subRole
	f.providerIndex = -1
	for i, p := range f.state.providers {
		if p.ID == r.Provider {
			f.providerIndex = i
		}
	}
	protocol := r.Protocol
	if protocol == "" {
		protocol = apiProtocols[0]
	}
	f.fields, f.definitions, f.baseline = nil, nil, nil
	base := []settingsField{{Key: "base_url", Label: "Base URL"}, {Key: "api_key", Label: "API Key"}, {Key: "model", Label: "模型"}, {Key: "api_protocol", Label: "协议", Type: "protocol"}}
	values := []string{r.BaseURL, "", r.Model, protocol}
	for i, def := range base {
		f.definitions = append(f.definitions, def)
		f.fields = append(f.fields, newAPIInput(def, values[i]))
		f.baseline = append(f.baseline, values[i])
	}
	c.installAPIParameters(r)
	f.group, f.focus, f.picking = 1, 0, false
	c.focusAPI()
}

func (c *model) installAPIParameters(r settingsResult) {
	f := c.api
	f.schema++
	f.paramModel, f.paramProtocol = f.fields[2].Value(), f.fields[3].Value()
	f.fields, f.definitions, f.baseline = f.fields[:4], f.definitions[:4], f.baseline[:4]
	definitions := r.Fields
	if len(definitions) == 0 {
		definitions = append(append([]settingsField(nil), r.ParameterSpecs...), r.ContextFields...)
	}
	// Budget controls are local service descriptors, shown before wire params.
	ordered := []settingsField{}
	for _, key := range []string{"compact_at_tokens"} {
		for _, d := range definitions {
			if strings.TrimPrefix(d.Key, "__param_") == key {
				ordered = append(ordered, d)
				break
			}
		}
	}
	ordered = append(ordered, definitions...)
	seen := map[string]bool{}
	for _, d := range ordered {
		d.Key = strings.TrimPrefix(d.Key, "__param_")
		if d.Key == "context_window" {
			continue // Capacity is service-owned metadata, including old descriptors.
		}
		if seen[d.Key] {
			continue
		}
		seen[d.Key] = true
		if d.Label == "" {
			d.Label = d.Key
		}
		value := parameterText(r.Parameters[d.Key])
		if d.Key == "compact_at_tokens" && len(r.CompactAt) > 0 {
			value = parameterText(r.CompactAt)
		}
		f.fields = append(f.fields, newAPIInput(d, value))
		f.definitions = append(f.definitions, d)
		f.baseline = append(f.baseline, f.fields[len(f.fields)-1].Value())
	}
}

func (f *apiForm) fieldIndex() int {
	switch f.group {
	case 1:
		if f.focus == 1 {
			return 0
		}
		if f.focus == 2 {
			return 1
		}
	case 2:
		if f.focus < 2 {
			return f.focus + 2
		}
	case 3:
		if f.focus < len(f.fields)-4 {
			return f.focus + 4
		}
	}
	return -1
}
func (f *apiForm) textFocused() bool {
	i := f.fieldIndex()
	return i >= 0 && !f.picking && !f.pending && len(f.optionValues(i)) == 0
}
func (c *model) focusAPI() {
	f := c.api
	for i := range f.fields {
		f.fields[i].Blur()
		if i == f.fieldIndex() {
			f.fields[i].Focus()
		}
	}
}
func (f *apiForm) unchangedIdentity() bool {
	return f.draft.ProfileID != "" && f.fields[0].Value() == f.baseline[0] && f.fields[1].Value() == "" && f.fields[2].Value() == f.baseline[2] && f.fields[3].Value() == f.baseline[3]
}
func (f *apiForm) roles() []string {
	roles := []string{}
	if f.mainRole {
		roles = append(roles, "main")
	}
	if f.subRole {
		roles = append(roles, "subconscious")
	}
	return roles
}
func (f *apiForm) arguments() map[string]any {
	p := map[string]any{"base_url": f.fields[0].Value(), "model": f.fields[2].Value(), "api_protocol": f.fields[3].Value()}
	if key := f.fields[1].Value(); key != "" {
		p["api_key"] = key
	}
	if f.draft.ConnectionID != "" {
		p["connection_id"] = f.draft.ConnectionID
	}
	if f.draft.ProfileID != "" {
		p["profile_id"] = f.draft.ProfileID
	}
	if f.draft.UserSlot != "" {
		p["user_slot"] = f.draft.UserSlot
	}
	parameters := map[string]any{}
	for i := 4; i < len(f.fields); i++ {
		if f.fields[i].Value() == f.baseline[i] {
			continue
		}
		d, value := f.definitions[i], f.fields[i].Value()
		var wire any = value
		if d.Type == "boolean" {
			if value == "true" {
				wire = true
			}
			if value == "false" {
				wire = false
			}
		}
		if d.Type == "strings" {
			wire = strings.Split(decodeAPIStrings(value), "\n")
			if value == "" {
				wire = ""
			}
		}
		if d.Key == "compact_at_tokens" {
			p[d.Key] = wire
		} else {
			parameters[d.Key] = wire
		}
	}
	p["parameters"] = parameters
	return p
}
func (c *model) runAPI(action string) tea.Cmd {
	f := c.api
	if f == nil || f.pending {
		return nil
	}
	switch action {
	case "test":
		f.proof = ""
		return c.requestAPI("test", f.arguments())
	case "save":
		if f.proof != "" {
			return c.requestAPI("save", map[string]any{"test_id": f.proof, "expected_version": f.version, "roles": f.roles()})
		}
		if f.unchangedIdentity() {
			p := f.arguments()
			p["id"] = f.draft.ProfileID
			p["expected_version"] = f.version
			if f.mainRole != f.initialMain || f.subRole != f.initialSub {
				p["roles"] = f.roles()
			}
			return c.requestAPI("update", p)
		}
		f.notice = "新连接或型号请先按 F3 检测，再选择角色保存"
	case "discover":
		return c.apiCatalog(false, 0)
	case "refresh":
		return c.apiCatalog(true, 0)
	}
	return nil
}

func (c *model) completeAPI(v apiMsg) tea.Cmd {
	if c.api == nil || v.epoch != c.apiEpoch || v.request != c.api.request {
		return nil
	}
	f := c.api
	f.pending = false
	f.cancel = nil
	if v.err != nil {
		if v.action == "test" || v.action == "save" || v.result.Code == "version_conflict" {
			f.proof = ""
		}
		f.notice = oneLine(v.err.Error())
		if key := f.fields[1].Value(); key != "" {
			f.notice = strings.ReplaceAll(f.notice, key, "[已遮盖]")
		}
		if v.result.Code == "version_conflict" {
			f.notice += " · F5 重新读取；未覆盖"
		}
		return nil
	}
	r := v.result
	switch v.action {
	case "load":
		f.state = v.state
		c.fillAPI(r)
		f.group = 0
		f.focus = 0
		f.notice = "与 Aieyra OS 共用配置 · Alt+0～4 分组 · Tab 选择 · Esc 返回"
	case "draft":
		c.fillAPI(r)
		f.notice = "按精确档案编辑 · Alt+2 模型 · Alt+3 参数 · Alt+4 角色"
	case "parameters":
		c.installAPIParameters(r)
		f.group = 3
		f.focus = 0
		f.notice = "参数来自共享设置 · 留空使用默认 · F3 检测 / F4 保存"
	case "catalog", "catalog_refresh":
		f.catalog = r.Models
		f.choices = r.Models
		f.offset = r.Offset
		f.total = r.Total
		f.catalogLocal = r.ConnectionID == ""
		if f.total == 0 && len(r.Models) > 0 {
			f.total = len(r.Models)
		}
		f.selected = 0
		if f.catalogEnd {
			f.selected = max(0, len(f.choices)-1)
		}
		f.catalogEnd = false
		f.picking = true
		f.notice = "缓存资料 · ↑↓选择 · PgUp/PgDn分页 · 输入筛选 · Enter应用"
		if r.Notice != "" {
			f.notice = r.Notice
		}
	case "test":
		if r.TestID == "" || !r.ResponseReceived {
			f.notice = "未收到有效文字检测回执"
			return nil
		}
		f.proof, f.version = r.TestID, r.Version
		c.installAPIParameters(r)
		f.group = 4
		f.focus = 0
		f.notice = "文字响应通过 · 工具/图片未检测 · 选择主意识 / 潜意识后 F4 保存"
	case "save", "update", "pool_action":
		f.proof = ""
		f.fields[1].SetValue("")
		id := r.ModelID
		if id == "" && v.action == "update" {
			id = f.draft.ProfileID
		}
		// Reload shared state after a confirmed write, never retry the write.
		cmd := c.requestAPI("load", map[string]any{"id": id})
		if cmd == nil {
			return nil
		}
		return func() tea.Msg {
			msg := cmd().(apiMsg)
			if msg.err == nil {
				msg.action = "saved"
				msg.result.Notice = "已保存到共享 OS 配置"
				msg.result.Warning = r.Warning
			}
			return msg
		}
	case "saved":
		f.state = v.state
		c.fillAPI(r)
		f.group = 4
		f.focus = 0
		f.notice = r.Notice
		if r.Warning != "" {
			f.notice += " · " + r.Warning
		}
	}
	c.focusAPI()
	return nil
}

func (f *apiForm) fieldChanged(index int, before string) {
	if before == f.fields[index].Value() {
		return
	}
	f.proof = ""
	f.confirmation = ""
	if index == 2 || index == 3 {
		f.schema++
		f.fields = f.fields[:4]
		f.definitions = f.definitions[:4]
		f.baseline = f.baseline[:4]
		f.paramModel = ""
	}
	f.notice = "草稿已修改 · F3 检测 / F4 保存 · Esc 取消"
}

func (c *model) apiCatalog(refresh bool, offset int) tea.Cmd {
	f := c.api
	f.catalogEnd = false
	p := map[string]any{"offset": offset, "limit": 30, "query": f.filter, "refresh": refresh}
	if f.draft.ConnectionID != "" && f.fields[0].Value() == f.draft.BaseURL && f.fields[1].Value() == "" {
		p["connection_id"] = f.draft.ConnectionID
	} else {
		if !refresh {
			f.notice = "新连接还没有缓存目录 · Alt+F2 获取，或手动填写模型"
			return nil
		}
		p = f.arguments()
	}
	if refresh {
		return c.requestAPI("catalog_refresh", p)
	}
	return c.requestAPI("catalog", p)
}

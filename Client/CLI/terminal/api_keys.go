// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/CLI/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: optionValues; focusCount; apiGroup; apiPoolAction; apiActivate; apiKey; apiCatalogKey; apiRoleLabel; apiCapacity
// Impact: python -B scripts/code-atlas.py show Client/CLI/terminal/api_keys.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package terminal

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
)

func (f *apiForm) optionValues(index int) []settingsOption {
	d := f.definitions[index]
	if d.Type == "protocol" {
		var options []settingsOption
		for _, p := range apiProtocols {
			raw, _ := json.Marshal(p)
			options = append(options, settingsOption{Value: raw, Label: p})
		}
		return options
	}
	if len(d.Options) > 0 {
		return d.Options
	}
	var options []settingsOption
	if d.Type == "boolean" {
		options = append(options, settingsOption{Value: json.RawMessage(`""`), Label: "默认"}, settingsOption{Value: json.RawMessage(`true`), Label: "开启"}, settingsOption{Value: json.RawMessage(`false`), Label: "关闭"})
	}
	if d.Type == "enum" {
		options = append(options, settingsOption{Value: json.RawMessage(`""`), Label: "默认"})
		for _, raw := range d.Values {
			options = append(options, settingsOption{Value: raw, Label: parameterText(raw)})
		}
	}
	return options
}
func (f *apiForm) focusCount() int {
	switch f.group {
	case 0:
		return 4 + len(f.state.models) + len(f.state.connections)
	case 1:
		return 4
	case 2:
		return 5
	case 3:
		return max(1, len(f.fields)-4) + 1
	case 4:
		return 6
	}
	return 1
}
func (c *model) apiGroup(group int) tea.Cmd {
	f := c.api
	f.picking = false
	f.group = group
	f.focus = 0
	f.confirmation = ""
	if group == 3 && (f.paramModel != f.fields[2].Value() || f.paramProtocol != f.fields[3].Value() || len(f.fields) == 4) {
		return c.requestAPI("parameters", f.arguments())
	}
	c.focusAPI()
	return nil
}
func (c *model) apiPoolAction(operation, id string) tea.Cmd {
	return c.requestAPI("pool_action", map[string]any{"operation": operation, "id": id, "expected_version": c.api.version})
}
func (c *model) apiActivate() tea.Cmd {
	f := c.api
	switch f.group {
	case 0:
		i := f.focus
		if i == 0 {
			return c.requestAPI("draft", nil)
		}
		if i == 1 {
			if f.state.subconscious != "" {
				return c.requestAPI("draft", map[string]any{"id": f.state.subconscious})
			}
			version := f.version
			c.fillAPI(settingsResult{Version: version})
			f.mainRole = false
			f.subRole = true
			f.group = 1
			f.notice = "潜意识尚未设置 · 可单独配置"
			return nil
		}
		if i == 2 {
			return c.apiPoolAction("subconscious", "")
		}
		i -= 3
		if i < len(f.state.models) {
			return c.requestAPI("draft", map[string]any{"id": f.state.models[i].ID})
		}
		i -= len(f.state.models)
		if i < len(f.state.connections) {
			connection := f.state.connections[i]
			for _, profile := range f.state.models {
				if profile.ConnectionID == connection.ID {
					return c.requestAPI("draft", map[string]any{"id": profile.ID})
				}
			}
			version := f.version
			c.fillAPI(settingsResult{Version: version, ConnectionID: connection.ID, Provider: connection.Provider, BaseURL: connection.BaseURL, HasKey: connection.HasKey, UserSlot: connection.UserSlot})
			f.notice = "连接已选择 · Alt+2 填写或选择模型"
			return nil
		}
		version := f.version
		c.fillAPI(settingsResult{Version: version})
		f.notice = "新连接 · 选择供应商或填写地址和 Key"
		return nil
	case 1:
		if f.focus == 3 {
			return c.apiGroup(2)
		}
	case 2:
		if f.focus == 2 {
			return c.runAPI("discover")
		}
		if f.focus == 3 {
			return c.runAPI("refresh")
		}
		if f.focus == 4 {
			return c.apiGroup(3)
		}
	case 3:
		if f.fieldIndex() < 0 {
			return c.apiGroup(4)
		}
	case 4:
		switch f.focus {
		case 0:
			f.mainRole = !f.mainRole
			f.notice = "角色选择仅在保存后生效"
		case 1:
			f.subRole = !f.subRole
			f.notice = "角色选择仅在保存后生效"
		case 2:
			return c.runAPI("save")
		case 3:
			if f.draft.ProfileID != "" {
				return c.apiPoolAction("toggle", f.draft.ProfileID)
			}
		case 4:
			if f.draft.ProfileID != "" {
				if f.confirmation == f.draft.ProfileID {
					return c.apiPoolAction("remove", f.draft.ProfileID)
				}
				f.confirmation = f.draft.ProfileID
				f.notice = "再次 Enter 移除此档案 · 其他按键取消"
				return nil
			}
		case 5:
			return c.apiPoolAction("subconscious", "")
		}
		return nil
	}
	f.focus = (f.focus + 1) % f.focusCount()
	c.focusAPI()
	return nil
}

func (c *model) apiKey(k tea.KeyMsg) tea.Cmd {
	f := c.api
	if k.Type == tea.KeyEsc {
		if f.picking && !f.pending {
			f.picking = false
			f.group = 2
			f.focus = 0
			c.focusAPI()
			return nil
		}
		if f.cancel != nil {
			f.cancel()
		}
		c.apiEpoch++
		c.api = nil
		c.notice = ""
		if c.opts.SettingsOnly {
			return tea.Quit
		}
		return nil
	}
	if f.pending {
		return nil
	}
	if k.Alt && len(k.Runes) == 1 && k.Runes[0] >= '0' && k.Runes[0] <= '4' {
		return c.apiGroup(int(k.Runes[0] - '0'))
	}
	if k.String() == "ctrl+left" {
		return c.apiGroup((f.group + 4) % 5)
	}
	if k.String() == "ctrl+right" {
		return c.apiGroup((f.group + 1) % 5)
	}
	if k.String() == "f5" {
		return c.loadAPI()
	}
	if f.picking {
		return c.apiCatalogKey(k)
	}
	if k.String() == "f2" {
		f.filter = ""
		return c.runAPI("discover")
	}
	if k.String() == "alt+f2" {
		f.filter = ""
		return c.runAPI("refresh")
	}
	if k.String() == "f3" {
		return c.runAPI("test")
	}
	if k.String() == "f4" {
		return c.runAPI("save")
	}
	if k.String() == "enter" || k.String() == " " && f.group == 4 && f.focus < 2 {
		return c.apiActivate()
	}
	f.confirmation = ""
	switch k.String() {
	case "tab", "down":
		f.focus = (f.focus + 1) % f.focusCount()
		c.focusAPI()
		return nil
	case "shift+tab", "up":
		f.focus = (f.focus + f.focusCount() - 1) % f.focusCount()
		c.focusAPI()
		return nil
	case "pgdown":
		if f.group == 0 {
			f.focus = min(f.focusCount()-1, f.focus+max(1, c.height-4))
			return nil
		}
	case "pgup":
		if f.group == 0 {
			f.focus = max(0, f.focus-max(1, c.height-4))
			return nil
		}
	case "home":
		if f.group == 0 {
			f.focus = 0
			return nil
		}
	case "end":
		if f.group == 0 {
			f.focus = f.focusCount() - 1
			return nil
		}
	}
	if f.group == 1 && f.focus == 0 && (k.String() == "left" || k.String() == "right") {
		if len(f.state.providers) == 0 {
			return nil
		}
		delta := 1
		if k.String() == "left" {
			delta = -1
		}
		i := (f.providerIndex + delta + len(f.state.providers)) % len(f.state.providers)
		p := f.state.providers[i]
		version := f.version
		c.fillAPI(settingsResult{Version: version, Provider: p.ID, BaseURL: p.BaseURL, Protocol: p.Protocol})
		f.providerIndex = i
		f.focus = 0
		f.notice = "新连接草稿 · 已清空旧 Key 和型号"
		return nil
	}
	i := f.fieldIndex()
	if i < 0 {
		return nil
	}
	before := f.fields[i].Value()
	options := f.optionValues(i)
	if len(options) > 0 {
		if k.String() == "left" || k.String() == "right" {
			at := -1
			for j, o := range options {
				if parameterText(o.Value) == before {
					at = j
				}
			}
			delta := 1
			if k.String() == "left" {
				delta = -1
			}
			at = (at + delta + len(options)) % len(options)
			f.fields[i].SetValue(parameterText(options[at].Value))
			f.fieldChanged(i, before)
		}
		return nil
	}
	if k.String() == "ctrl+v" || k.String() == "shift+insert" {
		epoch, schema, read := c.apiEpoch, f.schema, readClipboardCmd()
		return func() tea.Msg {
			v := read().(clipboardTextMsg)
			return apiPasteMsg{epoch: epoch, schema: schema, index: i, text: v.text, err: v.err}
		}
	}
	if k.Paste {
		value := oneLine(string(k.Runes))
		if f.definitions[i].Type == "strings" {
			value = encodeAPIStrings(string(k.Runes))
		}
		f.fields[i].SetValue(value)
		f.fields[i].CursorEnd()
	} else {
		f.fields[i], _ = f.fields[i].Update(k)
	}
	f.fieldChanged(i, before)
	return nil
}

func (c *model) apiCatalogKey(k tea.KeyMsg) tea.Cmd {
	f := c.api
	switch k.String() {
	case "up":
		f.selected = max(0, f.selected-1)
	case "down":
		f.selected = min(max(0, len(f.choices)-1), f.selected+1)
	case "pgdown":
		if !f.catalogLocal && f.offset+len(f.choices) < f.total {
			return c.apiCatalog(false, f.offset+30)
		}
		f.selected = min(max(0, len(f.choices)-1), f.selected+10)
	case "pgup":
		if !f.catalogLocal && f.offset > 0 {
			return c.apiCatalog(false, max(0, f.offset-30))
		}
		f.selected = max(0, f.selected-10)
	case "home":
		if !f.catalogLocal && f.offset > 0 {
			return c.apiCatalog(false, 0)
		}
		f.selected = 0
	case "end":
		if !f.catalogLocal && f.offset+len(f.choices) < f.total {
			cmd := c.apiCatalog(false, ((f.total-1)/30)*30)
			f.catalogEnd = cmd != nil
			return cmd
		}
		f.selected = max(0, len(f.choices)-1)
	case "enter":
		if len(f.choices) == 0 {
			return nil
		}
		v := f.choices[f.selected]
		old := f.fields[2].Value()
		f.fields[2].SetValue(v.ID)
		f.fieldChanged(2, old)
		if v.Protocol != "" {
			old = f.fields[3].Value()
			f.fields[3].SetValue(v.Protocol)
			f.fieldChanged(3, old)
		}
		f.picking = false
		return c.apiGroup(3)
	default:
		filter := f.filter
		if k.Type == tea.KeyRunes && !k.Alt {
			filter += oneLine(string(k.Runes))
		}
		if k.Type == tea.KeyBackspace && filter != "" {
			r := []rune(filter)
			filter = string(r[:len(r)-1])
		}
		if k.Type == tea.KeyCtrlU {
			filter = ""
		}
		if filter != f.filter && len(filter) <= 200 {
			f.filter = filter
			f.selected = 0
			if !f.catalogLocal {
				return c.apiCatalog(false, 0)
			}
			f.choices = nil
			needle := strings.ToLower(filter)
			for _, v := range f.catalog {
				if strings.Contains(strings.ToLower(v.ID+" "+v.Name), needle) {
					f.choices = append(f.choices, v)
				}
			}
			f.total = len(f.choices)
			f.notice = fmt.Sprintf("筛选 %s · %d 个结果 · Ctrl+U 清空", filter, f.total)
		}
	}
	return nil
}

func apiRoleLabel(enabled bool) string {
	if enabled {
		return "[✓]"
	}
	return "[ ]"
}
func apiCapacity(raw json.RawMessage) string {
	text := parameterText(raw)
	if _, e := strconv.ParseInt(text, 10, 64); e != nil {
		return "未知"
	}
	return text
}

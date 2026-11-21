// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/CLI/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: displayName; profileLabel; apiControlLabels; apiRows
// Impact: python -B scripts/code-atlas.py show Client/CLI/terminal/api_view.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package terminal

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/x/ansi"
)

func (p settingsModel) displayName() string {
	if p.Name != "" {
		return p.Name
	}
	if p.Model != "" {
		return p.Model
	}
	return p.ID
}

func (f *apiForm) profileLabel(id string) string {
	if id == "" {
		return "未设置"
	}
	for _, p := range f.state.models {
		if p.ID == id {
			return p.displayName() + " · " + p.Protocol + " · " + p.ID
		}
	}
	return id
}
func (c *model) apiControlLabels() []string {
	f := c.api
	switch f.group {
	case 0:
		rows := []string{"主意识  " + f.profileLabel(f.state.main), "潜意识  " + f.profileLabel(f.state.subconscious), "清空潜意识"}
		for _, p := range f.state.models {
			roles := ""
			if p.ID == f.state.main {
				roles += " 主意识"
			}
			if p.ID == f.state.subconscious {
				roles += " 潜意识"
			}
			if p.Enabled != nil && !*p.Enabled {
				roles += " 已禁用"
			}
			rows = append(rows, p.displayName()+" · "+p.Protocol+" · "+p.ID+roles)
		}
		for _, p := range f.state.connections {
			rows = append(rows, "连接 "+p.Name+" · "+p.BaseURL)
		}
		return append(rows, "＋ 新连接")
	case 1:
		provider := f.draft.Provider
		if provider == "" {
			provider = "第三方 / 自定义"
		}
		return []string{"供应商  " + provider + "  ←→", "Base URL", "API Key", "继续选择模型  Alt+2"}
	case 2:
		return []string{"模型", "协议", "浏览缓存目录  F2", "联网更新目录  Alt+F2", "参数与预算  Alt+3"}
	case 3:
		var rows []string
		for i := 4; i < len(f.definitions); i++ {
			label := f.definitions[i].Label
			if f.definitions[i].Type == "strings" {
				label += " · 分行粘贴"
			}
			rows = append(rows, label)
		}
		if len(rows) == 0 {
			rows = append(rows, "先填写模型，读取共享参数规格")
		}
		return append(rows, "选择角色  Alt+4")
	case 4:
		return []string{apiRoleLabel(f.mainRole) + " 主意识", apiRoleLabel(f.subRole) + " 潜意识", "保存到 OS  F4", "启用 / 禁用此档案", "移除此档案", "清空潜意识"}
	}
	return nil
}

func (c *model) apiRows(room int) []string {
	if room <= 0 {
		return nil
	}
	f := c.api
	f.caretRow, f.caretCol = 0, 0
	header := "Eyra API · " + apiGroups[f.group] + fmt.Sprintf(" · %d/%d", f.focus+1, f.focusCount())
	if f.group == 3 {
		header += " · 上下文容量 " + apiCapacity(f.draft.ContextLimit)
	}
	if f.picking {
		position := f.offset + f.selected + 1
		if len(f.choices) == 0 {
			position = 0
		}
		header = fmt.Sprintf("模型 %d/%d · %s", position, f.total, f.filter)
	}
	headerRoom := 0
	if room >= 4 {
		headerRoom = 1
	}
	noticeRows := []string{}
	if room >= 2 && f.notice != "" {
		noticeRows = strings.Split(ansi.Hardwrap(oneLine(f.notice), max(1, c.width), true), "\n")
		limit := 1
		if room >= 6 {
			limit = 2
		}
		if len(noticeRows) > limit {
			noticeRows = noticeRows[:limit]
			noticeRows[limit-1] = cut(noticeRows[limit-1]+"…", c.width)
		}
	}
	contentRoom := max(1, room-headerRoom-len(noticeRows))
	var rows []string
	focusRow := f.focus
	if f.picking {
		focusRow = f.selected
		for i, v := range f.choices {
			prefix := "  "
			if i == f.selected {
				prefix = "› "
			}
			label := v.ID + " · " + apiCapacity(v.ContextWindow)
			if v.ReferenceOnly {
				label += " · 参考"
			}
			rows = append(rows, prefix+label)
		}
		if len(rows) == 0 {
			rows = []string{"› 没有匹配模型 · Ctrl+U 清空"}
			focusRow = 0
		}
	} else {
		for i, label := range c.apiControlLabels() {
			prefix := "  "
			if i == f.focus {
				prefix = "› "
			}
			field := -1
			switch f.group {
			case 1:
				if i == 1 {
					field = 0
				}
				if i == 2 {
					field = 1
				}
			case 2:
				if i < 2 {
					field = i + 2
				}
			case 3:
				if i < len(f.fields)-4 {
					field = i + 4
				}
			}
			if field >= 0 {
				prefix += label + "  "
				value, caret := apiFieldView(f.fields[field], max(1, c.width-ansi.StringWidth(prefix)))
				if options := f.optionValues(field); len(options) > 0 {
					for _, o := range options {
						if parameterText(o.Value) == f.fields[field].Value() {
							value = o.Label + "  ←→"
							break
						}
					}
				}
				if field == 1 && f.fields[1].Value() == "" && f.draft.HasKey {
					value = "已保存 · 留空保留"
				}
				if i == f.focus {
					f.caretCol = min(c.width-1, ansi.StringWidth(prefix)+caret)
				}
				rows = append(rows, prefix+value)
			} else {
				rows = append(rows, prefix+label)
			}
		}
	}
	start := max(0, min(focusRow-contentRoom/2, max(0, len(rows)-contentRoom)))
	end := min(len(rows), start+contentRoom)
	visible := append([]string(nil), rows[start:end]...)
	f.caretRow = max(0, focusRow-start)
	for i := range visible {
		if start+i == focusRow {
			visible[i] = neon("51", visible[i])
		} else {
			visible[i] = neon("141", visible[i])
		}
	}
	if headerRoom > 0 {
		visible = append([]string{neon("51", cut(header, c.width))}, visible...)
		f.caretRow++
	}
	// Show metadata only after every control fits; it never displaces focus.
	if f.picking && len(f.choices) > 0 && len(visible) < room-len(noticeRows) {
		v := f.choices[f.selected]
		vision := "未知"
		if v.CatalogVision != nil {
			if *v.CatalogVision {
				vision = "目录支持"
			} else {
				vision = "目录不支持"
			}
		}
		info := "看图 " + vision + " · 工具/图片实测另计"
		if v.Summary != "" {
			info = v.Summary + " · " + info
		}
		visible = append(visible, neon("87", cut(info, c.width)))
	}
	for len(visible) < room-len(noticeRows) {
		visible = append(visible, "")
	}
	for _, line := range noticeRows {
		visible = append(visible, neon("141", line))
	}
	return visible[:min(room, len(visible))]
}

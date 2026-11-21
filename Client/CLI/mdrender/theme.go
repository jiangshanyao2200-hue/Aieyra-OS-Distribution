// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/CLI/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: styleText
// Impact: python -B scripts/code-atlas.py show Client/CLI/mdrender/theme.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package mdrender

import (
	"github.com/charmbracelet/lipgloss"
)

var (
	colNeon       = lipgloss.Color("159") // 霓虹青：主强调（键名、选中态、扫描线）
	colCyan       = lipgloss.Color("116") // 亮青：次强调（深度层、用户标识）
	colCyanDeep   = lipgloss.Color("67")  // 暗青：最外层深度与边框
	colMagenta    = lipgloss.Color("147") // 品红：扫光与关键数值
	colViolet     = lipgloss.Color("61")  // 电紫：标签栏底色
	colVioletDeep = lipgloss.Color("54")  // 深紫：标题栏底色

	colText  = lipgloss.Color("252")
	colDim   = lipgloss.Color("245")
	colFaint = lipgloss.Color("240")
	colGhost = lipgloss.Color("238")

	// 纯亮色留给标题高光与粘贴占位块，正文重点统一使用主强调色。
	colBright = lipgloss.Color("231")

	colOk   = lipgloss.Color("#82DFB7")
	colWarn = lipgloss.Color("214")
	colErr  = lipgloss.Color("203")
)

var styleText = lipgloss.NewStyle().Foreground(colText)
var (
	styleMDCode      = lipgloss.NewStyle().Foreground(colMagenta)                   // 行内代码
	styleMDCodeBlock = lipgloss.NewStyle().Foreground(colText).Background(colGhost) // 代码块正文
	styleMDGutter    = lipgloss.NewStyle().Foreground(colCyanDeep)                  // 代码块边槽
	styleMDCont      = lipgloss.NewStyle().Foreground(colGhost)                     // 代码续行边槽
	styleMDLang      = lipgloss.NewStyle().Foreground(colFaint)                     // 代码语言标签
	styleMDQuote     = lipgloss.NewStyle().Foreground(colDim)                       // 引用正文
	styleMDQuoteBar  = lipgloss.NewStyle().Foreground(colViolet)                    // 引用边槽
	styleMDHeading   = lipgloss.NewStyle().Foreground(colNeon).Bold(true)           // 标题
	styleMDBold      = lipgloss.NewStyle().Foreground(colNeon).Bold(true)           // **强调**
	styleMDMarker    = lipgloss.NewStyle().Foreground(colFaint)                     // 列表标记
	styleMDAction    = lipgloss.NewStyle().Foreground(colDim).Italic(true)          // *动作*
	styleMDLink      = lipgloss.NewStyle().Foreground(colCyan)                      // 链接文字
	styleMDURL       = lipgloss.NewStyle().Foreground(colFaint)                     // URL 本体
	styleMDStrike    = lipgloss.NewStyle().Foreground(colDim).Strikethrough(true)   // 删除线
	styleMDMath      = lipgloss.NewStyle().Foreground(colCyan)                      // 数学
	styleMDRule      = lipgloss.NewStyle().Foreground(colGhost)                     // 分隔线
	styleMDTableBar  = lipgloss.NewStyle().Foreground(colGhost)                     // 表格竖线
)

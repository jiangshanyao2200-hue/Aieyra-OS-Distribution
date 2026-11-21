// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/CLI/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: pulseMsg; draft; model; newModel; pulse; nextPulse; Init; Update; key; layout; growInput; savedDraft; restoreDraft; requestID; menuItem; menuItems; submit
// Impact: python -B scripts/code-atlas.py show Client/CLI/terminal/model.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Package terminal is the native, presentation-only Aieyra CLI. It consumes
// capabilities injected by the host and never creates an executor or archive.
package terminal

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"strings"
	"time"

	"github.com/aieyra/aieyra-os/contracts/protocol"
	"github.com/charmbracelet/bubbles/cursor"
	"github.com/charmbracelet/bubbles/textarea"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

type pulseMsg struct{}
type draft struct {
	value  string
	offset int
	pastes []pasteBlock
	seq    int
}
type model struct {
	flow                                      terminalFlow
	flows                                     map[string]terminalFlow
	flowTasks                                 []string
	ctx                                       context.Context
	opts                                      protocol.TerminalOptions
	session                                   protocol.TerminalSession
	screen                                    *screen
	input                                     textarea.Model
	width, height                             int
	ready                                     bool
	notice                                    string
	pastes                                    []pasteBlock
	pasteSeq, foldStart, pasteGen, pasteEpoch int
	pasteBuffer                               []rune
	pasteDelay                                time.Duration
	pasteTimer                                bool
	pasteBulk                                 bool
	pasteUntil                                time.Time
	menuClosed                                bool
	menuIndex                                 int
	menuQuery                                 string
	drafts                                    map[string]draft
	failedByTask                              map[string]*pendingSend
	epoch                                     int
	actionVersion                             int
	inputEpoch                                int
	retryID, retryText                        string
	display                                   displayBoundary
	userText                                  string
	userVisible                               bool
	userVisibleFor                            time.Duration
	workRounds                                map[string]bool
	queuedSends                               []pendingSend
	sending                                   *pendingSend
	failedSend                                *pendingSend
	opPending                                 bool
	opening                                   bool
	awaitingTaskSnapshot                      bool
	openingKeys                               []tea.KeyMsg
	snapshot                                  snapshot
	messages                                  []message
	documents                                 map[string]string
	questionKey                               string
	api                                       *apiForm
	apiEpoch                                  int
	frame                                     int
	liveText, liveThought                     string
	shownText, shownThought                   string
	liveID                                    string
	taskGeneration                            int
	lastPulse                                 time.Time
	taskStarted                               bool
	bodyWrap, thoughtWrap                     wrapCache
	thoughtLine                               thoughtRibbon
	pendingBodies                             []presentationBody
	bodyVisible                               bool
	bodyVisibleFor                            time.Duration
	activities                                []activityView
	inputPreviews                             map[string]toolInputPreview
	pinned                                    *activity
	detailCache                               detailCache
	detailOffset                              int
	planExpanded                              bool
	pinnedPlan                                *livePlan
	pinnedPlanGeneration                      int
	receipt                                   *toolReceipt
	receiptPending                            bool
	receiptRefresh                            bool
	receiptError                              string
	receiptEpoch, receiptPage                 int
	receiptCursors                            []receiptCursor
	receiptCancel                             context.CancelFunc
}

func newModel(ctx context.Context, opts protocol.TerminalOptions) *model {
	ta := textarea.New()
	ta.Placeholder, ta.Prompt = "", ""
	ta.CharLimit = 0
	ta.ShowLineNumbers = false
	ta.FocusedStyle.CursorLine = lipgloss.NewStyle()
	ta.BlurredStyle.CursorLine = lipgloss.NewStyle()
	ta.KeyMap.InsertNewline.SetKeys("ctrl+j", "alt+enter")
	ta.KeyMap.Paste.SetEnabled(false)
	// Original terminal workaround for the pinned Bubbles focus/blink panic.
	ta.Cursor.SetMode(cursor.CursorStatic)
	_ = ta.Focus()
	ta.SetWidth(78)
	ta.SetHeight(2)
	return &model{ctx: ctx, opts: opts, session: opts.Session, input: ta,
		width: 80, height: 24, ready: true, drafts: map[string]draft{}, documents: map[string]string{}}
}

func pulse() tea.Cmd {
	return tea.Tick(40*time.Millisecond, func(time.Time) tea.Msg { return pulseMsg{} })
}
func (c *model) nextPulse() tea.Cmd {
	delay := 250 * time.Millisecond
	if c.snapshot.Busy || c.opPending || c.api != nil && c.api.pending || c.activityAnimating() || c.presentationPending() {
		delay = 32 * time.Millisecond
	}
	return tea.Tick(delay, func(time.Time) tea.Msg { return pulseMsg{} })
}
func (c *model) Init() tea.Cmd {
	if c.opts.SettingsOnly {
		return tea.Batch(c.openAPI(), pulse())
	}
	if c.session.Call == nil {
		return tea.Batch(c.open(""), pulse())
	}
	return tea.Batch(c.poll(0), pulse())
}
func (c *model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch v := msg.(type) {
	case tea.WindowSizeMsg:
		c.width, c.height = max(1, min(2000, v.Width)), max(1, min(1000, v.Height))
		c.layout()
	case pulseMsg:
		c.frame++
		c.animate()
		return c, c.nextPulse()
	case apiMsg:
		return c, c.completeAPI(v)
	case receiptMsg:
		c.completeReceipt(v)
		return c, c.refreshCompletedReceipt()
	case apiPasteMsg:
		if c.api != nil && v.epoch == c.apiEpoch && v.schema == c.api.schema && !c.api.pending && v.index >= 0 && v.index < len(c.api.fields) {
			if v.err != nil {
				c.api.notice = oneLine(v.err.Error())
				return c, nil
			}
			before := c.api.fields[v.index].Value()
			value := oneLine(v.text)
			if c.api.definitions[v.index].Type == "strings" {
				value = encodeAPIStrings(v.text)
			}
			c.api.fields[v.index].SetValue(value)
			c.api.fields[v.index].CursorEnd()
			c.api.fieldChanged(v.index, before)
		}
		return c, nil
	case pollMsg:
		if v.epoch != c.epoch {
			return c, nil
		}
		if v.version != c.actionVersion {
			return c, c.poll(0)
		}
		commands := []tea.Cmd{}
		if v.err != nil {
			c.notice = "读取状态失败：" + safeText(v.err.Error())
		} else {
			c.applySnapshot(v)
			if c.opening && c.awaitingTaskSnapshot {
				c.opening, c.awaitingTaskSnapshot = false, false
				keys := c.openingKeys
				c.openingKeys = nil
				for _, k := range keys {
					commands = append(commands, c.key(k))
				}
			}
		}
		delay := 800 * time.Millisecond
		if c.snapshot.Busy || c.opPending {
			delay = 100 * time.Millisecond
		}
		return c, tea.Batch(append(commands, c.poll(delay), c.refreshCompletedReceipt())...)
	case actionMsg:
		return c, c.completeAction(v)
	case clipboardResult:
		if v.session != c.epoch || v.input != c.inputEpoch {
			return c, nil
		}
		if v.err != nil {
			c.notice = safeText(v.err.Error())
			return c, nil
		}
		return c, c.handlePaste(v.text)
	case pasteSettleMsg:
		if v.epoch != c.pasteEpoch {
			return c, nil
		}
		c.pasteTimer = false
		if len(c.pasteBuffer) > 0 && time.Now().Before(c.pasteUntil) {
			return c, c.armPasteTimer()
		}
		return c, c.settlePaste()
	case tea.KeyMsg:
		return c, c.key(v)
	}
	return c, nil
}

func (c *model) key(k tea.KeyMsg) tea.Cmd {
	if k.Type == tea.KeyCtrlQ {
		return tea.Quit
	}
	if c.opening {
		// Selection already expresses the user's destination. Hold subsequent
		// input until that task is bound, so a slow open cannot split a command
		// between the outgoing and incoming drafts.
		c.openingKeys = append(c.openingKeys, k)
		return nil
	}
	if c.api != nil {
		return c.apiKey(k)
	}
	if handled, cmd := c.flowKey(k); handled {
		return cmd
	}
	if c.pinned != nil && k.Alt {
		switch k.String() {
		case "alt+r":
			return c.loadReceipt()
		case "alt+left":
			if !c.receiptPending && c.receiptPage > 0 {
				c.receiptPage--
				c.receipt = nil
				c.detailOffset = 0
				return c.loadReceipt()
			}
			return nil
		case "alt+right":
			if !c.receiptPending && c.receipt != nil && (c.receipt.NextInput > 0 || c.receipt.NextOutput > 0) {
				cursor := receiptCursor{max(c.receipt.NextInput, c.receipt.InputSize), max(c.receipt.NextOutput, c.receipt.OutputSize)}
				if c.receipt.NextInput > 0 {
					cursor.input = c.receipt.NextInput
				}
				if c.receipt.NextOutput > 0 {
					cursor.output = c.receipt.NextOutput
				}
				c.receiptCursors = append(c.receiptCursors[:c.receiptPage+1], cursor)
				c.receiptPage++
				c.receipt = nil
				c.detailOffset = 0
				return c.loadReceipt()
			}
			return nil
		}
	}
	if k.Alt && len(k.Runes) == 1 {
		if k.Runes[0] >= '1' && k.Runes[0] <= '3' {
			index := int(k.Runes[0] - '1')
			items := c.activeActivities()
			if index < len(items) {
				c.resetReceipt()
				if c.pinned != nil && c.pinned.ID == items[index].ID && c.pinned.AgentID == items[index].AgentID {
					c.pinned = nil
				} else {
					v := items[index]
					c.pinned = &v
					c.planExpanded = false
					c.pinnedPlan = nil
				}
				c.detailOffset = 0
				if c.pinned != nil {
					return c.loadReceipt()
				}
			}
			return nil
		}
		if k.Runes[0] == 'p' {
			c.resetReceipt()
			c.planExpanded = !c.planExpanded && c.visiblePlan()
			if c.planExpanded {
				c.pinnedPlan = c.snapshot.Plan
				c.pinnedPlanGeneration = c.snapshot.PlanScope.Generation
			} else {
				c.pinnedPlan = nil
			}
			c.pinned = nil
			c.detailOffset = 0
			return nil
		}
	}
	if c.pinned != nil || c.planExpanded {
		switch k.String() {
		case "esc":
			c.resetReceipt()
			c.pinned = nil
			c.planExpanded = false
			c.pinnedPlan = nil
			c.detailOffset = 0
			return nil
		case "pgup":
			c.detailOffset = max(0, c.detailOffset-max(1, c.height/2))
			return nil
		case "pgdown":
			c.detailOffset += max(1, c.height/2)
			return nil
		}
	}
	if k.Type == tea.KeyCtrlC {
		return nil
	} // terminal selection owns copying
	if k.Type == tea.KeyCtrlU {
		c.inputEpoch++
		c.input.Reset()
		c.pastes = nil
		c.clearPasteState()
		c.growInput()
		c.menuClosed = false
		c.notice = "已清空输入"
		return nil
	}
	if k.Paste {
		return c.handlePaste(string(k.Runes))
	}
	if k.Type == tea.KeyRunes && !k.Alt {
		c.editPasteBlock(k)
		return c.bufferInput(string(k.Runes))
	}
	if (k.Type == tea.KeyEnter || k.Type == tea.KeyCtrlJ || k.Type == tea.KeyTab) && c.pasteBulk && c.pasteGuardActive() {
		value := "\n"
		if k.Type == tea.KeyTab {
			value = "\t"
		}
		return c.bufferInput(value)
	}
	c.settlePaste()
	if k.Type == tea.KeyEsc {
		if len(c.menuItems()) > 0 {
			c.menuClosed = true
			return nil
		}
		return c.cancelTask()
	}
	if items := c.menuItems(); len(items) > 0 {
		switch k.String() {
		case "up":
			c.menuIndex = (c.menuIndex + len(items) - 1) % len(items)
			return nil
		case "down":
			c.menuIndex = (c.menuIndex + 1) % len(items)
			return nil
		case "tab", "enter":
			item := items[c.menuIndex]
			if c.opPending || c.sending != nil || len(c.queuedSends) > 0 {
				c.notice = "等待发送确认后即可切换任务"
				return nil
			}
			c.input.Reset()
			c.growInput()
			c.menuClosed = true
			return c.open(item.name)
		}
	}
	switch k.String() {
	case "ctrl+v", "shift+insert":
		session, input, read := c.epoch, c.inputEpoch, readClipboardCmd()
		return func() tea.Msg { return clipboardResult{read().(clipboardTextMsg), session, input} }
	case "enter":
		return c.submit()
	case "ctrl+l":
		c.rebuild()
		return nil
	}
	if c.editPasteBlock(k) {
		return nil
	}
	var cmd tea.Cmd
	before := c.input.Value()
	c.input, cmd = c.input.Update(k)
	if c.input.Value() != before {
		c.inputEpoch++
	}
	c.growInput()
	c.menuClosed = false
	return cmd
}

func (c *model) layout() {
	c.input.SetWidth(max(1, c.width-4))
	c.growInput()
}
func (c *model) growInput() {
	rows := 0
	for _, line := range strings.Split(c.input.Value(), "\n") {
		rows += len(wrapInputLine([]rune(line), max(1, c.input.Width())))
	}
	c.input.SetHeight(min(max(1, c.height-5), max(2, min(5, rows))))
}
func (c *model) savedDraft() draft {
	return draft{c.input.Value(), c.inputOffset(), append([]pasteBlock(nil), c.pastes...), c.pasteSeq}
}
func (c *model) restoreDraft(d draft) {
	c.inputEpoch++
	c.pastes, c.pasteSeq = d.pastes, d.seq
	c.setInputAt(d.value, d.offset)
	c.clearPasteState()
}
func requestID() string { var b [16]byte; _, _ = rand.Read(b[:]); return hex.EncodeToString(b[:]) }

type menuItem struct{ name, label string }

func (c *model) menuItems() []menuItem {
	if c.menuClosed || c.input.Value() != "/" {
		return nil
	}
	items := []menuItem{}
	for _, task := range c.snapshot.Tasks {
		title := safeText(task.Title)
		if title == "" {
			title = "分裂任务"
		}
		if task.ID == c.session.ID {
			title = "● " + title
		}
		items = append(items, menuItem{task.ID, title + " · " + task.State})
	}
	if c.menuIndex >= len(items) {
		c.menuIndex = 0
	}
	return items
}
func (c *model) submit() tea.Cmd {
	text := c.expandPastes(c.input.Value())
	if strings.TrimSpace(text) == "" {
		if c.failedSend != nil && c.sending == nil {
			return c.resumeSend()
		}
		return nil
	}
	fields := strings.Fields(text)
	if strings.HasPrefix(text, "/") && len(c.pastes) == 0 {
		if fields[0] == "/api" && len(fields) == 1 {
			c.inputEpoch++
			c.input.Reset()
			c.growInput()
			return c.openAPI()
		}
		c.notice = "输入 / 查看任务；完整输入 /api 打开 Eyra API"
		return nil
	}
	if c.opPending && c.sending == nil {
		c.notice = "正在处理，草稿已保留"
		return nil
	}
	if len(text) > 64<<10 {
		c.notice = "消息超过 64 KiB，草稿已保留"
		return nil
	}
	if h := c.pendingHuman(); h != nil {
		return c.reply(*h, text)
	}
	if c.snapshot.SessionID == "" {
		c.notice = "正在重新连接核心，草稿已保留；/api 打开 Eyra API"
		return c.open("")
	}
	if c.retryText != text || c.retryID == "" {
		c.retryID, c.retryText = requestID(), text
	}
	return c.sendMessage(pendingSend{id: c.retryID, text: text, draft: c.savedDraft()})
}

// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/CLI/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: receiptCursor; toolReceipt; receiptMsg; resetReceipt; loadReceipt; completeReceipt; refreshCompletedReceipt
// Impact: python -B scripts/code-atlas.py show Client/CLI/terminal/receipt.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package terminal

import (
	"context"
	"time"

	tea "github.com/charmbracelet/bubbletea"
)

type receiptCursor struct{ input, output int }

type toolReceipt struct {
	Input, Output, Tool, State string
	Pending                    bool
	NextInput                  int `json:"next_input"`
	NextOutput                 int `json:"next_output"`
	InputSize                  int `json:"input_size"`
	OutputSize                 int `json:"output_size"`
}

type receiptMsg struct {
	epoch, session, page int
	id, agent            string
	data                 toolReceipt
	err                  error
}

func (c *model) resetReceipt() {
	if c.receiptCancel != nil {
		c.receiptCancel()
	}
	c.receiptCancel = nil
	c.receiptEpoch++
	c.receipt, c.receiptPending, c.receiptError = nil, false, ""
	c.receiptRefresh = false
	c.detailCache = detailCache{}
	c.receiptPage = 0
	c.receiptCursors = []receiptCursor{{}}
}

// Explicit open, refresh and page changes read original tool data. An open
// running tool also gets one final read when its execution reaches a terminal state.
// Each page is bounded by the core; old pages are represented by offsets only.
func (c *model) loadReceipt() tea.Cmd {
	if c.pinned == nil || c.pinned.AgentID == "" || c.session.Call == nil || c.receiptPending {
		return nil
	}
	if len(c.receiptCursors) == 0 {
		c.receiptCursors = []receiptCursor{{}}
	}
	c.receiptPending, c.receiptError = true, ""
	c.receiptEpoch++
	a, page, cursor, epoch, session := *c.pinned, c.receiptPage, c.receiptCursors[c.receiptPage], c.receiptEpoch, c.epoch
	call := c.session.Call
	ctx, cancel := context.WithTimeout(c.ctx, 5*time.Second)
	c.receiptCancel = cancel
	return func() tea.Msg {
		defer cancel()
		v := receiptMsg{epoch: epoch, session: session, page: page, id: a.ID, agent: a.AgentID}
		v.err = call(ctx, "workspace.receipt", map[string]any{"agent_id": a.AgentID, "id": a.ID, "input_offset": cursor.input, "output_offset": cursor.output}, &v.data)
		return v
	}
}

func (c *model) completeReceipt(v receiptMsg) {
	if v.epoch != c.receiptEpoch || v.session != c.epoch || c.pinned == nil || v.id != c.pinned.ID || v.agent != c.pinned.AgentID || v.page != c.receiptPage {
		return
	}
	c.receiptPending, c.receiptCancel = false, nil
	if v.err != nil {
		c.receiptError = oneLine(v.err.Error())
		return
	}
	if v.data.Pending && v.data.Input == "" && v.data.Output == "" {
		c.receiptError = "收据尚未写入"
		return
	}
	c.receipt = &v.data
}

func (c *model) refreshCompletedReceipt() tea.Cmd {
	if !c.receiptRefresh || c.receiptPending {
		return nil
	}
	c.receiptRefresh = false
	return c.loadReceipt()
}

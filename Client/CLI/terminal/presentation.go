// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/CLI/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: presentationBody; thoughtReady; presentationPending; startPresentation; receivePresentation; animatePresentation
// Impact: python -B scripts/code-atlas.py show Client/CLI/terminal/presentation.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package terminal

import (
	"time"
)

// 只排队显示副本；执行、收据、取消和快照接收不等待阅读时间。
type presentationBody struct {
	id, text, thought string
}

func (c *model) thoughtReady() bool {
	text := normalizeThought(c.liveThought)
	return text == "" || c.thoughtLine.text == text && c.thoughtLine.ready()
}

func (c *model) presentationPending() bool {
	return c.userText != "" || len(c.pendingBodies) > 0 || c.shownText != c.liveText || !c.thoughtReady()
}

func (c *model) startPresentation(v presentationBody) {
	c.retainCurrentFlowBody()
	c.liveID, c.liveText, c.liveThought = v.id, v.text, v.thought
	c.shownText, c.shownThought = "", v.thought
	c.thoughtLine = thoughtRibbon{}
	c.bodyVisible, c.bodyVisibleFor = false, 0
	if v.thought == "" && !c.snapshot.Busy {
		c.shownText = v.text
	}
}

func (c *model) receivePresentation(v presentationBody) {
	v.thought = normalizeThought(v.thought)
	if v.id == "" && v.text == "" && v.thought == "" {
		return
	}
	if n := len(c.pendingBodies); n > 0 {
		if c.pendingBodies[n-1].id == v.id {
			previous := c.pendingBodies[n-1]
			if v.thought == "" {
				v.thought = previous.thought
			}
			c.pendingBodies[n-1] = v
		} else {
			c.pendingBodies = append(c.pendingBodies, v)
		}
		return
	}
	if c.liveID != v.id {
		if c.liveID != "" && (!c.thoughtReady() || c.liveText != "" && c.bodyVisibleFor < 160*time.Millisecond) {
			c.pendingBodies = append(c.pendingBodies, v)
			return
		}
		c.startPresentation(v)
		return
	}
	c.liveText = v.text
	// 核心可能在完成或下一请求准备时隐藏过期思考；已收到的尾部仍需显示。
	if v.thought != "" {
		c.liveThought, c.shownThought = v.thought, v.thought
	}
	if c.liveThought == "" && !c.snapshot.Busy {
		c.shownText = c.liveText
	}
}

func (c *model) animatePresentation(dt time.Duration) {
	if c.userVisible && c.userText != "" {
		c.userVisibleFor += dt
		if c.userVisibleFor >= 2500*time.Millisecond {
			c.userText = ""
		}
	}
	if c.bodyVisible && c.shownText == c.liveText {
		c.bodyVisibleFor += dt
	}
	c.thoughtLine.advance(dt, c.liveText != "" || len(c.pendingBodies) > 0,
		c.snapshot.Busy && c.liveText == "" && len(c.pendingBodies) == 0)
	if c.thoughtReady() {
		if !c.snapshot.Busy {
			c.shownText = c.liveText
		} else {
			c.shownText = advanceText(c.shownText, c.liveText, dt)
		}
		if len(c.pendingBodies) > 0 && (c.liveText == "" || c.shownText == c.liveText && c.bodyVisibleFor >= 160*time.Millisecond) {
			next := c.pendingBodies[0]
			c.pendingBodies = c.pendingBodies[1:]
			c.startPresentation(next)
		}
	}
}

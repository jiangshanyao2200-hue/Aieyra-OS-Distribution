// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: workspaceStreamTextLimit; startWorkspaceReasoning; finishWorkspaceReasoning; stream; taskStream; streamLocked; requestStart; taskRequestStart; compactionStart; finishBoundary; appendWorkspacePart; correctWorkspacePart; workspacePartsText; workspaceThoughtTail
// Impact: python -B scripts/code-atlas.py show Core/workspace_stream.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"fmt"
	"github.com/aieyra/aieyra-os/contracts/protocol"
	"sort"
	"strings"
	"time"
	"unicode/utf8"
)

const workspaceStreamTextLimit = 128 << 10

func startWorkspaceReasoning(v *WorkspaceLive, now int64) {
	if v.ReasoningStartedAt == 0 {
		v.ReasoningStartedAt = now
	}
}

func finishWorkspaceReasoning(v *WorkspaceLive, now int64) {
	if v.ReasoningStartedAt == 0 {
		return
	}
	entry := protocol.WorkspaceReasoning{ID: fmt.Sprintf("%s:%d", v.BodyID, v.ReasoningStartedAt), StartedAt: v.ReasoningStartedAt, FinishedAt: max(v.ReasoningStartedAt, now)}
	// Copy on write: a snapshot already being encoded must stay immutable.
	rows := append([]protocol.WorkspaceReasoning{}, v.ReasoningHistory...)
	v.ReasoningHistory = append(rows, entry)
	if len(v.ReasoningHistory) > 200 {
		v.ReasoningHistory = v.ReasoningHistory[len(v.ReasoningHistory)-200:]
	}
	v.ReasoningStartedAt = 0
}

func (w *Workspace) stream(role string, event Event) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.streamLocked(role, event)
}

func (w *Workspace) taskStream(id string, generation int, event Event, agents ...string) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.live[id].Generation == generation && (len(agents) == 0 || w.live[id].AgentID == agents[0]) {
		w.streamLocked(id, event)
	}
}

func (w *Workspace) streamLocked(role string, event Event) {
	v := w.live[role]
	if event.Kind == EventTextCorrection {
		// Corrections update retained contributions without advancing activity or
		// output order. An old body part can still belong to the current body;
		// reasoning/body invalidated by a newer output must never reappear.
		if event.OutputIndex == nil || event.ContentIndex == nil || v.Phase == "settled" || v.Phase == "error" {
			return
		}
		var changed bool
		switch event.CorrectionKind {
		case EventDelta:
			v.StreamBodyParts, changed = correctWorkspacePart(v.StreamBodyParts, event)
			if changed {
				text := utf8Prefix(workspacePartsText(v.StreamBodyParts), workspaceStreamTextLimit)
				if text != v.Text {
					v.BodyUpdatedAt = time.Now().UnixMilli()
				}
				v.Text = text
			}
		case EventReasoning:
			v.StreamThoughtParts, changed = correctWorkspacePart(v.StreamThoughtParts, event)
			if changed && !v.HideThought {
				v.Thought = workspaceThoughtTail(workspacePartsText(v.StreamThoughtParts))
				v.ThoughtKind = event.ReasoningKind
			}
		}
		if changed {
			v.Revision++
			w.live[role] = v
		}
		return
	}
	newOutput := false
	if event.OutputIndex != nil {
		if v.StreamOutputSeen && *event.OutputIndex < v.StreamOutputIndex {
			return
		}
		newOutput = v.StreamOutputSeen && *event.OutputIndex > v.StreamOutputIndex
	}
	v.Revision++
	now := time.Now().UnixMilli()
	// 更后的真实思考使旧正文失效；旧输出仍进入完整历史，但不倒退实时状态。
	if newOutput && (event.Kind == EventReasoningStart || event.Kind == EventReasoning && event.Text != "") && v.Phase != "settled" && v.Phase != "error" {
		finishWorkspaceReasoning(&v, now)
		v.Text, v.Thought, v.ThoughtKind = "", "", ""
		v.StreamBodyParts, v.StreamThoughtParts = nil, nil
		v.BodyAt, v.BodyUpdatedAt = 0, 0
		v.NewBody = true
	}
	switch event.Kind {
	case EventRetry:
		finishWorkspaceReasoning(&v, now)
		v = WorkspaceLive{AgentID: v.AgentID, TurnID: v.TurnID, Generation: v.Generation, Phase: "retry", BodyID: v.BodyID, Revision: v.Revision, HideThought: v.HideThought, ReasoningHistory: v.ReasoningHistory}
	case EventReasoningStart:
		if (v.Phase == "body" || v.Phase == "tool") && !newOutput || v.Phase == "settled" || v.Phase == "error" {
			return
		}
		v.ReasoningSeen = true
		startWorkspaceReasoning(&v, now)
		if v.Phase != "thinking" {
			v.Thought, v.ThoughtKind = "", ""
			v.StreamThoughtParts = nil
		}
		v.ThoughtAt = time.Now().UnixMilli()
		v.Phase = "thinking"
	case EventReasoning:
		if event.Text == "" || v.Phase == "settled" || v.Phase == "error" {
			return
		}
		v.ReasoningSeen = true
		if (v.Phase == "body" || v.Phase == "tool") && !newOutput {
			break
		}
		startWorkspaceReasoning(&v, now)
		if v.Phase != "thinking" {
			v.Thought = ""
			v.StreamThoughtParts = nil
		}
		v.ThoughtAt = time.Now().UnixMilli()
		v.ThoughtKind = event.ReasoningKind
		if v.ThoughtKind == "" {
			v.ThoughtKind = "text"
		}
		v.Phase = "thinking"
		if !v.HideThought {
			// Keep a bounded reading window, including chunks that arrived before
			// the UI's first snapshot. Animation never blocks the stream or tools.
			text := v.Thought + event.Text
			if event.ContentIndex != nil && event.OutputIndex != nil {
				v.StreamThoughtParts = appendWorkspacePart(v.StreamThoughtParts, event)
				text = workspacePartsText(v.StreamThoughtParts)
			}
			v.Thought = workspaceThoughtTail(text)
		}
	case EventDelta:
		finishWorkspaceReasoning(&v, now)
		if event.Text == "" {
			break
		}
		if v.BodyAt == 0 && event.Text != "" {
			v.BodyAt = time.Now().UnixMicro()
		}
		if v.NewBody {
			v.Text = ""
			v.StreamBodyParts = nil
			v.NewBody = false
		}
		v.Phase = "body"
		text := utf8Prefix(v.Text+event.Text, workspaceStreamTextLimit)
		if event.ContentIndex != nil && event.OutputIndex != nil {
			v.StreamBodyParts = appendWorkspacePart(v.StreamBodyParts, event)
			text = utf8Prefix(workspacePartsText(v.StreamBodyParts), workspaceStreamTextLimit)
		}
		if text != v.Text {
			v.BodyUpdatedAt = now
		}
		v.Text = text
	case EventBodyPreparing:
		finishWorkspaceReasoning(&v, now)
		v.Phase = "body"
	case EventToolPreparing:
		finishWorkspaceReasoning(&v, now)
		v.Phase = "tool"
	case EventReasoningDone:
		finishWorkspaceReasoning(&v, now)
		if v.Phase == "thinking" {
			v.Phase = "waiting"
		}
	case EventDone:
		finishWorkspaceReasoning(&v, now)
		v.Phase = "settled"
		v.StreamBodyParts, v.StreamThoughtParts = nil, nil
	case EventError:
		finishWorkspaceReasoning(&v, now)
		v.Phase = "error"
		v.StreamBodyParts, v.StreamThoughtParts = nil, nil
	default:
		return
	}
	if event.OutputIndex != nil {
		v.StreamOutputIndex, v.StreamOutputSeen = *event.OutputIndex, true
	}
	w.live[role] = v
}

func (w *Workspace) requestStart(role string, showReasoning bool) {
	w.taskRequestStart(role, 0, showReasoning)
}

func (w *Workspace) taskRequestStart(role string, generation int, showReasoning bool, agents ...string) {
	w.mu.Lock()
	defer w.mu.Unlock()
	agentID := w.state.Roles[role]
	if len(agents) > 0 {
		if agentID != "" && agentID != agents[0] {
			return
		}
		agentID = agents[0]
	}
	turnID := ""
	for _, message := range w.state.Messages {
		if message.From == "user" && message.To == role && message.Generation == generation && (message.AgentID == "" || message.AgentID == agentID) && message.State != "queued" && message.State != "context" && message.State != "withdrawn" {
			turnID = message.ID
		}
	}
	v := w.live[role]
	if v.Generation != generation || v.AgentID != agentID || v.TurnID != turnID {
		v = WorkspaceLive{Revision: v.Revision}
	}
	finishWorkspaceReasoning(&v, time.Now().UnixMilli())
	w.live[role] = WorkspaceLive{AgentID: agentID, TurnID: turnID, Generation: generation, Phase: "waiting", BodyID: workspaceID(), Text: v.Text, NewBody: true, Revision: v.Revision + 1, HideThought: !showReasoning, ReasoningHistory: v.ReasoningHistory}
	if showReasoning && time.Now().UnixMilli()-v.ThoughtAt < 4000 {
		next := w.live[role]
		next.Thought, next.ThoughtAt, next.ThoughtKind = v.Thought, v.ThoughtAt, v.ThoughtKind
		w.live[role] = next
	}
}

// Maintenance responses never own a chat body. Preserve the last real progress
// while exposing only a truthful phase; accounting and checkpoint storage stay
// in the request/runtime path.
func (w *Workspace) compactionStart(role string) {
	w.mu.Lock()
	defer w.mu.Unlock()
	v := w.live[role]
	finishWorkspaceReasoning(&v, time.Now().UnixMilli())
	v.Phase, v.Thought = "compacting", ""
	v.Revision++
	w.live[role] = v
}

// Retired team records never block Matrix delivery.
func (w *Workspace) finishBoundary(role string) string { return "" }

func appendWorkspacePart(parts []protocol.WorkspaceStreamPart, event Event) []protocol.WorkspaceStreamPart {
	rows := append([]protocol.WorkspaceStreamPart(nil), parts...)
	for i := range rows {
		if rows[i].OutputIndex == *event.OutputIndex && rows[i].ContentIndex == *event.ContentIndex {
			rows[i].Text += event.Text
			return rows
		}
	}
	rows = append(rows, protocol.WorkspaceStreamPart{OutputIndex: *event.OutputIndex, ContentIndex: *event.ContentIndex, Text: event.Text})
	sort.Slice(rows, func(i, j int) bool {
		return rows[i].OutputIndex < rows[j].OutputIndex || rows[i].OutputIndex == rows[j].OutputIndex && rows[i].ContentIndex < rows[j].ContentIndex
	})
	return rows
}

func correctWorkspacePart(parts []protocol.WorkspaceStreamPart, event Event) ([]protocol.WorkspaceStreamPart, bool) {
	for i, part := range parts {
		if part.OutputIndex == *event.OutputIndex && part.ContentIndex == *event.ContentIndex {
			if part.Text == event.Text {
				return parts, false
			}
			rows := append([]protocol.WorkspaceStreamPart(nil), parts...)
			rows[i].Text = event.Text
			return rows, true
		}
	}
	return parts, false
}

func workspacePartsText(parts []protocol.WorkspaceStreamPart) string {
	var text strings.Builder
	for _, part := range parts {
		text.WriteString(part.Text)
	}
	return text.String()
}

func workspaceThoughtTail(text string) string {
	start := max(0, len(text)-workspaceStreamTextLimit)
	for start < len(text) && !utf8.RuneStart(text[start]) {
		start++
	}
	return text[start:]
}

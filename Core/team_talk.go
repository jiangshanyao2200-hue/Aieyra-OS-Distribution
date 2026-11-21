// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: internalTeamNotification; teamTalkLimit; talkBriefLimit; briefText; defaultBrief; resultBrief; talk; talkResult; talkResultLocked; awaitTeamResult; settleTeamAwait; deliverTeamResultsLocked; appendTalkLocked; teamTalkLocked
// Impact: python -B scripts/code-atlas.py show Core/team_talk.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"fmt"
	"strings"
	"time"
	"unicode/utf8"
)

// The model's completion notification is task input. User-facing communication
// remains in TeamTalk and the eventual reply. Legacy notifications already have
// a stable typed route and ID; never classify a user's quoted text by content.
func internalTeamNotification(m workspaceMessage) bool {
	if m.To == WorkspaceMatrix && (m.Origin == "workbox_result" || m.Origin == "agent_result" || m.Origin == "mother_repair") {
		return true
	}
	return m.To == WorkspaceMatrix && (m.From == WorkspaceProject || m.From == WorkspaceExecution) &&
		(m.Origin == "team_result" || strings.HasPrefix(m.ID, "team-result-"))
}

// 团队对话：Eyra、Vaya、Cota 之间每次交接留一句给人看的 brief。
// 聊天里只显示这一句和发起人、接收人；原文留在各自上下文和执行记录里。
const teamTalkLimit = 400

// 聊天里要能读完这句话，只防极端长度。
const talkBriefLimit = 400

func briefText(s string, max int) string {
	s = strings.Join(strings.Fields(s), " ")
	if utf8.RuneCountInString(s) <= max {
		return s
	}
	r := []rune(s)
	return strings.TrimSpace(string(r[:max-1])) + "…"
}

// 没写 brief 时的默认说法：只说做了什么，不带原文。
func defaultBrief(from, to, kind string) string {
	switch kind {
	case "dispatch":
		if to == WorkspaceExecution {
			return "交给你一项子任务"
		}
		return "帮我看看工程地图"
	case "message":
		if from == WorkspaceMatrix {
			return "补充一点信息"
		}
		return "同步一下进展"
	}
	return ""
}

// 角色交回结果时，最终答复第一行写“简报：……”就用它；否则按状态给一句。
func resultBrief(r AgentRecord) string {
	switch r.State {
	case "completed":
		for _, line := range strings.Split(r.Result, "\n") {
			line = strings.TrimSpace(strings.TrimLeft(strings.TrimSpace(line), "#*> "))
			if line == "" {
				continue
			}
			for _, prefix := range []string{"简报：", "简报:", "Brief:", "brief:"} {
				if strings.HasPrefix(line, prefix) {
					if text := briefText(strings.TrimPrefix(line, prefix), talkBriefLimit); text != "" {
						return text
					}
				}
			}
			break
		}
		return "做完了，交回给你"
	case "failed":
		return "这次没做完，处理记录已保留。"
	case "timed_out":
		return "这次等待超时，处理记录已保留。"
	case "persistence_failed":
		return "保存结果时遇到问题，已有回执可查。"
	case "cancelled", "interrupted":
		return "停下了"
	}
	return ""
}

func (w *Workspace) talk(from, to, brief, kind string, generation int) {
	if w == nil || !w.teamHost() || from == to {
		return
	}
	text := briefText(brief, talkBriefLimit)
	if text == "" {
		text = defaultBrief(from, to, kind)
	}
	if text == "" {
		return
	}
	text = w.manager.redact(text)
	w.mu.Lock()
	defer w.mu.Unlock()
	w.appendTalkLocked(workspaceTalk{From: from, To: to, Brief: text, Kind: kind, Generation: generation})
}

// 同一角色同一代的结果只记一次（status、wait、dispatch 都可能看到同一个完成态）。
func (w *Workspace) talkResult(role string, r AgentRecord) {
	if w == nil || !w.teamHost() || role == WorkspaceMatrix || activeAgent(r.State) {
		return
	}
	text := resultBrief(r)
	if text == "" {
		return
	}
	text = w.manager.redact(text)
	w.mu.Lock()
	defer w.mu.Unlock()
	w.talkResultLocked(role, text, r.Generation)
}

func (w *Workspace) talkResultLocked(role, text string, generation int) {
	for _, t := range w.state.TeamTalk {
		if t.From == role && t.Kind == "result" && t.Generation == generation {
			return
		}
	}
	w.appendTalkLocked(workspaceTalk{From: role, To: WorkspaceMatrix, Brief: text, Kind: "result", Generation: generation})
}

func (w *Workspace) awaitTeamResult(role string, generation int) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.state.TeamAwait == nil {
		w.state.TeamAwait = map[string]int{}
	}
	w.state.TeamAwait[role] = generation
	_ = w.saveLocked()
}

// Eyra 已经自己看到结果了，就不用再告知一遍。
func (w *Workspace) settleTeamAwait(role string, r AgentRecord) {
	if activeAgent(r.State) {
		return
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	if generation, ok := w.state.TeamAwait[role]; ok && generation == r.Generation {
		delete(w.state.TeamAwait, role)
		_ = w.saveLocked()
	}
}

// 成员做完了：聊天里留一句，结果进 Eyra 的消息队列。Eyra 在忙就在下个安全边界读到；
// 已经停下就唤醒它。用户取消的不打扰。
func (w *Workspace) deliverTeamResultsLocked() {
	for role, generation := range w.state.TeamAwait {
		id := w.state.Roles[role]
		if id == "" {
			delete(w.state.TeamAwait, role)
			continue
		}
		r, err := w.manager.Status(w.state.ID, id)
		if err != nil || r.Generation == generation && activeAgent(r.State) {
			continue
		}
		delete(w.state.TeamAwait, role)
		if r.Generation != generation {
			_ = w.saveLocked()
			continue
		}
		if text := resultBrief(r); text != "" {
			w.talkResultLocked(role, w.manager.redact(text), generation)
		}
		if r.State == "cancelled" || r.State == "interrupted" {
			_ = w.saveLocked()
			continue
		}
		result := r.Result
		if r.Error != "" {
			result = r.Error
		}
		text := formatPromptText(runtimePrompt("Matrix/辅助指令/成员完成通知.txt"), teamRoleNames()[role], r.State, w.manager.redact(utf8Prefix(result, 48<<10)))
		if repairFailure(r) {
			cause := "failure"
			if r.Failure != nil {
				cause = r.Failure.Code
			}
			if _, err := w.enqueueRepairLocked(w.manager, r, cause, r.Error, "team-result", text, nil); err != nil {
				w.state.TeamAwait[role] = generation
			}
			continue
		}
		m := workspaceMessage{ID: fmt.Sprintf("team-result-%s-%s-%d", role, id[:min(8, len(id))], generation), Origin: "team_result", From: role, To: WorkspaceMatrix, Text: text, State: "queued", At: time.Now().UTC().Format(time.RFC3339Nano)}
		w.state.Messages = append(w.state.Messages, m)
		if err := w.saveLocked(); err != nil {
			w.state.Messages = w.state.Messages[:len(w.state.Messages)-1]
			w.state.TeamAwait[role] = generation
			continue
		}
		w.feed.publish(WorkspaceMatrix, "message", m)
		select {
		case w.notified <- struct{}{}:
		default:
		}
	}
}

func (w *Workspace) appendTalkLocked(t workspaceTalk) {
	t.ID = workspaceID()[:16]
	t.At = time.Now().UTC().Format(time.RFC3339Nano)
	w.state.TeamTalk = append(w.state.TeamTalk, t)
	if extra := len(w.state.TeamTalk) - teamTalkLimit; extra > 0 {
		w.state.TeamTalk = append([]workspaceTalk(nil), w.state.TeamTalk[extra:]...)
	}
	_ = w.saveLocked()
	w.feed.publish(t.From, "talk", t)
}

func (w *Workspace) teamTalkLocked(n int) []workspaceTalk {
	talk := w.state.TeamTalk
	if len(talk) > n {
		talk = talk[len(talk)-n:]
	}
	return append([]workspaceTalk{}, talk...)
}

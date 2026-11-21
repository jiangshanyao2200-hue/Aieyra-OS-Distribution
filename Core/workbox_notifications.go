// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: workboxNotice; deliverWorkboxResultsLocked; deliverServiceResultsLocked; prepareAgentNoticeLocked
// Impact: python -B scripts/code-atlas.py show Core/workbox_notifications.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"fmt"
	"time"
)

type workboxNotice struct {
	Generation int              `json:"generation"`
	Message    workspaceMessage `json:"message"`
}

// Agent records supply a durable outbox, including every completed generation
// of a retained specialist. Pending notices survive an ephemeral UI exit.
func (w *Workspace) deliverWorkboxResultsLocked() {
	m := w.manager
	if service := m.workboxHost.Load(); service != nil {
		m = service
	}
	w.deliverServiceResultsLocked(m, false)
	if service := w.manager.packageHost.Load(); service != nil {
		w.deliverServiceResultsLocked(service, true)
	}
}

func (w *Workspace) deliverServiceResultsLocked(m *AgentManager, packages bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	// Snapshot IDs: the lock is released for the workspace's own commit below.
	ids := make([]string, 0, len(m.jobs))
	for id := range m.jobs {
		ids = append(ids, id)
	}
	for _, id := range ids {
		j := m.jobs[id]
		if j == nil {
			continue
		}
		r := &j.record
		if !m.ownsLocked(m.owner, r.ID) || (!packages && r.Spec.WorkflowID == "") || (packages && (r.Instance == nil || r.Instance.Disabled || r.Instance.Supervisor != "primary" && !(r.Instance.Supervisor == "" && repairFailure(*r)))) {
			continue
		}
		origin := "workbox_result"
		if packages {
			origin = "agent_result"
		}
		if err := m.prepareAgentNoticeLocked(j, origin); err != nil || r.WorkflowNotice == nil {
			continue
		}

		notice := r.WorkflowNotice
		found := false
		for index, message := range w.state.Messages {
			if message.ID != notice.Message.ID {
				continue
			}
			found = true
			if message.State == "queued" && (notice.Message.State == "cancelled" || notice.Message.State == "interrupted") {
				w.state.Messages[index].State = notice.Message.State
				m.mu.Unlock()
				err := w.saveLocked()
				m.mu.Lock()
				if err != nil {
					w.state.Messages[index].State = message.State
					break
				}
				message = w.state.Messages[index]
			}
			if message.State != "queued" {
				previous := r.WorkflowNotified
				r.WorkflowNotified, r.WorkflowNotice = notice.Generation, nil
				if err := m.saveLocked(j); err != nil {
					r.WorkflowNotified, r.WorkflowNotice = previous, notice
				}
			}
			break
		}
		if found {
			continue
		}
		outcome := copyRecord(*r)
		if outcome.Generation != notice.Generation {
			for _, old := range r.History {
				if old.Generation == notice.Generation {
					outcome.Generation, outcome.State, outcome.Result, outcome.Error = old.Generation, old.State, old.Result, old.Error
					outcome.Failure = nil
					break
				}
			}
		}
		if repairFailure(outcome) {
			cause := "failure"
			if outcome.Failure != nil {
				cause = outcome.Failure.Code
			}
			// Commit in the existing mother's inbox first, then acknowledge its
			// identity in the source outbox. A crash between these saves retries
			// the same source/generation/cause without another model run.
			m.mu.Unlock()
			message, err := w.enqueueRepairLocked(m, outcome, cause, outcome.Error, notice.Message.ID, notice.Message.Text, nil)
			m.mu.Lock()
			if err == nil && j.record.WorkflowNotice == notice {
				next := &workboxNotice{Generation: notice.Generation, Message: message}
				j.record.WorkflowNotice = next
				if err = m.saveLocked(j); err != nil {
					j.record.WorkflowNotice = notice
				}
			}
			continue
		}
		w.state.Messages = append(w.state.Messages, notice.Message)
		// Context commits may consult the primary manager; never invert that lock.
		m.mu.Unlock()
		err := w.saveLocked()
		m.mu.Lock()
		if err != nil {
			w.state.Messages = w.state.Messages[:len(w.state.Messages)-1]
			continue
		}
		w.feed.publish(WorkspaceMatrix, "message", notice.Message)
		select {
		case w.notified <- struct{}{}:
		default:
		}
	}
}

// Shared persistent outbox for workflow specialists and package team members.
func (m *AgentManager) prepareAgentNoticeLocked(j *agentJob, origin string) error {
	r := &j.record
	outcomes := append([]AgentOutcome(nil), r.History...)
	if !activeAgent(r.State) {
		outcomes = append(outcomes, AgentOutcome{Generation: r.Generation, State: r.State, Result: r.Result, Error: r.Error})
	}
	if previous := r.WorkflowNotice; previous != nil {
		// Retire pending notices written by an older version which treated a
		// cancellation as another task input. Preserve their original IDs.
		for _, outcome := range outcomes {
			if outcome.Generation == previous.Generation && previous.Message.State == "queued" && (outcome.State == "cancelled" || outcome.State == "interrupted") {
				next := *previous
				next.Message.State = outcome.State
				r.WorkflowNotice = &next
				if err := m.saveLocked(j); err != nil {
					r.WorkflowNotice = previous
					return err
				}
			}
		}
		return nil
	}
	var next *AgentOutcome
	for n := range outcomes {
		o := &outcomes[n]
		if o.Generation > r.WorkflowNotified && !activeAgent(o.State) && (next == nil || o.Generation < next.Generation) {
			next = o
		}
	}
	if next == nil {
		return nil
	}
	result := next.Result
	if next.Error != "" {
		result = next.Error
	}
	state := "queued"
	if next.State == "cancelled" || next.State == "interrupted" {
		state = next.State // Preserve the receipt without waking a stopped task.
	}
	r.WorkflowNotice = &workboxNotice{Generation: next.Generation, Message: workspaceMessage{ID: fmt.Sprintf("workbox-result-%s-%d", r.ID, next.Generation), Origin: origin, From: r.ID, To: WorkspaceMatrix, Text: formatPromptText(runtimePrompt("Matrix/辅助指令/成员完成通知.txt"), r.Spec.Title, next.State, m.redact(utf8Prefix(result, 48<<10))), State: state, At: time.Now().UTC().Format(time.RFC3339Nano)}}
	if err := m.saveLocked(j); err != nil {
		r.WorkflowNotice = nil
		return err
	}
	return nil
}

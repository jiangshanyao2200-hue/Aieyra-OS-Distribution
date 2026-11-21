// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: queuePackageMessageLocked; queueAgentMessageLocked; hasPackageMessages; hasPackageMessagesLocked; sealPackageTurn; packageNoticeTargetLocked; drainPackageMessages; drainPackageMessagesBefore
// Impact: python -B scripts/code-atlas.py show Core/agent_package_messages.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"fmt"
	"time"
)

func (m *AgentManager) queuePackageMessageLocked(j *agentJob, request, message, hash string, attachments []ComposerAttachment) (AgentRecord, error) {
	return m.queueAgentMessageLocked(j, request, message, hash, attachments, conversationLinkOrigin{}, false)
}

func (m *AgentManager) queueAgentMessageLocked(j *agentJob, request, message, hash string, attachments []ComposerAttachment, origin conversationLinkOrigin, internal bool) (AgentRecord, error) {
	if len(attachments) > 0 {
		return AgentRecord{}, fmt.Errorf("wait for this turn before sending another attachment")
	}
	if len(j.record.PendingMessages) >= 64 {
		return AgentRecord{}, fmt.Errorf("Agent message queue is full; wait for delivery")
	}
	previous := copyRecord(j.record)
	j.record.PendingMessages = append(j.record.PendingMessages, workspaceMessage{ID: request, From: "user", Text: message, State: "queued", Generation: j.record.Generation, At: time.Now().UTC().Format(time.RFC3339Nano)})
	if internal {
		rememberLinkOrigin(&j.record, request, origin)
		v := &j.record.PendingMessages[len(j.record.PendingMessages)-1]
		v.From = origin.From
		v.Origin = "core_link"
	}
	j.record.Turns[request] = message
	j.record.TurnGenerations[request] = j.record.Generation
	if j.record.TurnHashes == nil {
		j.record.TurnHashes = map[string]string{}
	}
	j.record.TurnHashes[request] = hash
	if err := m.saveLocked(j); err != nil {
		j.record = previous
		return AgentRecord{}, err
	}
	return copyRecord(j.record), nil
}

func (m *AgentManager) hasPackageMessages(id string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.hasPackageMessagesLocked(id)
}

func (m *AgentManager) hasPackageMessagesLocked(id string) bool {
	if j := m.jobs[id]; j != nil && len(j.record.PendingMessages) > 0 {
		return true
	}
	for _, j := range m.jobs {
		if m.packageNoticeTargetLocked(j) == id && j.record.Generation > j.record.WorkflowNotified && !activeAgent(j.record.State) {
			return true
		}
	}
	return false
}

// The same lock protects message admission and the final boundary. A caller
// rejected after this point can retry its unconsumed request ID next turn.
func (m *AgentManager) sealPackageTurn(id string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.hasPackageMessagesLocked(id) {
		return false
	}
	if j := m.jobs[id]; j != nil {
		for _, v := range j.record.Compactions {
			if conversationCompactionPending(v) && v.Generation == j.record.Generation {
				return false
			}
		}
		j.finishing = true
		return true
	}
	return false
}

func (m *AgentManager) packageNoticeTargetLocked(j *agentJob) string {
	if i := j.record.Instance; i != nil {
		if i.Disabled || i.Supervisor == "primary" {
			return ""
		}
		return i.Supervisor
	}
	if parent := m.jobs[j.record.Parent]; parent != nil {
		return parent.record.ID
	}
	return ""
}

// An active supervisor receives completions at a model boundary. Idle/disabled
// instances keep the outbox for explicit continuation, never auto-reopen.
// Message names make an archive commit before a state-save failure replay-safe.
func (m *AgentManager) drainPackageMessages(id string, archive *SessionArchive, history []Message) ([]Message, error) {
	return m.drainPackageMessagesBefore(id, archive, history, 0)
}

// A positive generation drains only older turns. Newly admitted messages must
// follow the explicit message that started the current turn.
func (m *AgentManager) drainPackageMessagesBefore(id string, archive *SessionArchive, history []Message, generation int) ([]Message, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	j := m.jobs[id]
	if j == nil {
		return nil, fmt.Errorf("Agent no longer exists")
	}
	seen := map[string]bool{}
	for _, v := range history {
		seen[v.Name] = true
	}
	added := []Message{}
	appendMessage := func(name, text string) error {
		if seen[name] {
			return nil
		}
		v := Message{Role: RoleUser, Name: name, Content: text}
		if err := archive.Append("message", v); err != nil {
			return err
		}
		seen[name] = true
		added = append(added, v)
		return nil
	}
	var remaining []workspaceMessage
	for _, v := range j.record.PendingMessages {
		if generation > 0 && v.Generation >= generation {
			remaining = append(remaining, v)
			continue
		}
		name := "agent-message-" + workflowHash(v.ID)
		if v.Origin == "core_link" {
			name = "core-link-" + workflowHash(v.ID)
		}
		if err := appendMessage(name, v.Text); err != nil {
			return nil, err
		}
	}
	if len(j.record.PendingMessages) > len(remaining) {
		prior := j.record.PendingMessages
		j.record.PendingMessages = remaining
		if err := m.saveLocked(j); err != nil {
			j.record.PendingMessages = prior
			return nil, err
		}
	}
	for _, child := range m.jobs {
		if m.packageNoticeTargetLocked(child) != id {
			continue
		}
		for {
			if err := m.prepareAgentNoticeLocked(child, "agent_result"); err != nil {
				return nil, err
			}
			notice := child.record.WorkflowNotice
			if notice == nil {
				break
			}
			if err := appendMessage(notice.Message.ID, notice.Message.Text); err != nil {
				return nil, err
			}
			previous := child.record.WorkflowNotified
			child.record.WorkflowNotified, child.record.WorkflowNotice = notice.Generation, nil
			if err := m.saveLocked(child); err != nil {
				child.record.WorkflowNotified, child.record.WorkflowNotice = previous, notice
				return nil, err
			}
		}
	}
	return added, nil
}

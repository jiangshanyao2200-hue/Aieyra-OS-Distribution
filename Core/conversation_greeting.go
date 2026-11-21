// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: conversationGreeting; greetConversation
// Impact: python -B scripts/code-atlas.py show Core/conversation_greeting.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type conversationGreeting struct {
	State string `json:"state"`
	Text  string `json:"text"`
	At    string `json:"at"`
}

// Opening a fresh conversation may greet once. A durable local greeting is
// committed first, so reload, rapid creation and uncertain requests never replay.
func (m *AgentManager) greetConversation(ctx context.Context, id string) (any, error) {
	m.mu.Lock()
	j := m.jobs[id]
	if j == nil || j.record.DeletionPending || m.ctx.Err() != nil || m.updateFrozen {
		m.mu.Unlock()
		return nil, fmt.Errorf("会话不可用")
	}
	if j.record.Greeting != nil || j.record.Generation != 0 || j.record.Link != nil || j.record.Spec.GroupID != "" {
		greeting := j.record.Greeting
		m.mu.Unlock()
		return greeting, nil
	}
	r := copyRecord(j.record)
	spec, err := m.resolveConversationSpec(r)
	if err != nil {
		m.mu.Unlock()
		return nil, err
	}
	greeting := conversationGreeting{State: "local", Text: fmt.Sprintf("你好，我是%s。想从哪里开始？", spec.Title), At: time.Now().UTC().Format(time.RFC3339Nano)}
	j.record.Greeting = &greeting
	if err = m.saveLocked(j); err != nil {
		j.record.Greeting = nil
		m.mu.Unlock()
		return nil, err
	}
	var last time.Time
	gate := filepath.Join(m.dir, ".greeting-rate.json")
	data, readErr := os.ReadFile(gate)
	invalid := readErr != nil && !os.IsNotExist(readErr)
	if readErr == nil {
		invalid = json.Unmarshal(data, &last) != nil
	}
	if invalid || !last.IsZero() && time.Since(last) < 30*time.Second {
		m.mu.Unlock()
		return greeting, nil
	}
	stamp, _ := json.Marshal(time.Now().UTC())
	if err = atomicWorkspaceFile(m.dir, filepath.Base(gate), stamp); err != nil {
		m.mu.Unlock()
		return greeting, nil
	}
	request, cancel := context.WithTimeout(m.ctx, 20*time.Second)
	stop := context.AfterFunc(ctx, cancel)
	j.greetingCancel = cancel
	m.wg.Add(1)
	m.mu.Unlock()
	defer m.wg.Done()
	defer cancel()
	defer stop()
	settings, err := m.specSettings(spec)
	if err != nil {
		return greeting, nil
	}
	settings = startupGreetingSettings(settings)
	request = withoutRequestRetry(WithProviderSession(request, id))
	messages := []Message{{Role: RoleSystem, Content: spec.Prompt}, {Role: RoleUser, Content: runtimePrompt("Matrix/问候/启动招呼.txt") + spec.Title}}
	// Greetings share the execution transport budget and cannot call tools.
	select {
	case m.slots <- struct{}{}:
		defer func() { <-m.slots }()
	case <-request.Done():
		return greeting, nil
	}
	if err = m.checkConversationAuthority(AgentRecord{ID: r.ID, Spec: spec}); err != nil {
		return greeting, nil
	}
	started := time.Now()
	answer, usage, requestErr := completeAgentObserved(request, New(settings), settings, messages, nil, nil)
	m.mu.Lock()
	defer m.mu.Unlock()
	j.greetingCancel = nil
	u := estimateUsage(agentUsage(j.record.Requests+1, "greeting", time.Since(started), usage), messages, answer)
	u.Model, u.Host = settings.Model, usageHost(settings.BaseURL)
	m.appendUsageLedger(j, u)
	if m.jobs[id] != j || j.record.DeletionPending {
		return greeting, nil
	}
	j.record.Requests++
	j.record.Usage = append(j.record.Usage, u)
	j.record.AccountedTokens += u.Input + u.Output
	if requestErr == nil && request.Err() == nil && j.record.Generation == 0 && strings.TrimSpace(answer.Content) != "" {
		next := greeting
		next.State = "online"
		next.Text = utf8Prefix(strings.TrimSpace(answer.Content), 2048)
		j.record.Greeting = &next
	}
	if err = m.saveLocked(j); err != nil {
		return nil, err
	}
	return j.record.Greeting, nil
}

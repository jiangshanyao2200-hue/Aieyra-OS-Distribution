// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestConversationHumanReplyRetainsPrivateBinding
// Impact: python -B scripts/code-atlas.py show Core/conversation_human_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"testing"
)

func TestConversationHumanReplyRetainsPrivateBinding(t *testing.T) {
	m, r, requests := waitingHuman(t)
	m.mu.Lock()
	m.jobs[r.ID].record.Spec.Kind = "conversation"
	m.mu.Unlock()
	h := &WorkspaceHost{config: m.config, conversations: m}
	for _, change := range []func(*HumanReply){
		func(p *HumanReply) { p.SessionID = "other" },
		func(p *HumanReply) { p.AgentID = "other" },
		func(p *HumanReply) { p.Generation++ },
		func(p *HumanReply) { p.ExpectedRequestVersion++ },
		func(p *HumanReply) { p.RequestTokenSHA256 = "wrong" },
	} {
		p := humanTestReply(r)
		change(&p)
		var payload map[string]any
		_ = json.Unmarshal(rawJSON(p), &payload)
		payload["action"] = "human_reply"
		payload["id"] = r.ID
		if _, err := h.conversationCall(context.Background(), rawJSON(payload)); err == nil {
			t.Fatal("foreign or stale decision accepted")
		}
	}
	if requests.Load() != 2 {
		t.Fatal("rejected decision resumed model")
	}
	p := humanTestReply(r)
	var payload map[string]any
	_ = json.Unmarshal(rawJSON(p), &payload)
	payload["action"] = "human_reply"
	payload["id"] = r.ID
	if _, err := h.conversationCall(context.Background(), rawJSON(payload)); err != nil {
		t.Fatal(err)
	}
	if _, err := m.Wait(context.Background(), m.owner, r.ID, 10000); err != nil {
		t.Fatal(err)
	}
	if requests.Load() != 3 {
		t.Fatal("decision did not resume the same agent once", requests.Load())
	}
	if _, err := h.conversationCall(context.Background(), rawJSON(payload)); err != nil {
		t.Fatal("duplicate decision failed", err)
	}
	if requests.Load() != 3 {
		t.Fatal("duplicate decision repeated inference")
	}
}

// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestChatRequestMergesLeadingSystemMessages
// Impact: python -B scripts/code-atlas.py show Core/chat_system_merge_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import "testing"

func TestChatRequestMergesLeadingSystemMessages(t *testing.T) {
	s := &Settings{Model: "qwen3.8-flash"}
	req := BuildRequest(s, []Message{
		{Role: RoleSystem, Content: "persona"},
		{Role: RoleSystem, Content: "runtime"},
		{Role: RoleSystem, Content: "contract"},
		{Role: RoleUser, Content: "做一个网页"},
		{Role: RoleSystem, Content: "tail notice"},
	}, true)
	if len(req.Messages) != 3 || req.Messages[0].Role != RoleSystem || req.Messages[0].Content != "persona\n\nruntime\n\ncontract" || req.Messages[1].Content != "做一个网页" || req.Messages[2].Content != "tail notice" {
		t.Fatalf("messages = %+v", req.Messages)
	}
	single := BuildRequest(s, []Message{{Role: RoleSystem, Content: "only"}, {Role: RoleUser, Content: "hi"}}, true)
	if len(single.Messages) != 2 || single.Messages[0].Content != "only" {
		t.Fatalf("single = %+v", single.Messages)
	}
}

// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestTranscriptPayloadRedactsNestedEscapedCredentials
// Impact: python -B scripts/code-atlas.py show Core/redaction_json_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestTranscriptPayloadRedactsNestedEscapedCredentials(t *testing.T) {
	key := "sensitive-\"quote\\slash\n<token>"
	args := string(rawJSON(map[string]string{"token": key}))
	m := Message{Role: RoleAssistant, Content: "prefix " + key, ToolCalls: []ToolCall{executionCall("terminal", map[string]string{"cmd": args})}}
	rows := transcriptRows("test/key", 0, []Message{m}, func(s string) string { return redactSecretEncodings(s, []string{key}) })
	var got Message
	if json.Unmarshal([]byte(rows[0].Payload), &got) != nil {
		t.Fatal("redaction broke message JSON")
	}
	if strings.Contains(got.Content, "sensitive-") || strings.Contains(got.ToolCalls[0].Function.Arguments, "sensitive-") {
		t.Fatal("escaped credential survived")
	}
	if !strings.Contains(got.ToolCalls[0].Function.Arguments, "[redacted]") {
		t.Fatal("tool argument lost")
	}
	if m.Content != "prefix "+key {
		t.Fatal("in-memory original changed")
	}
}

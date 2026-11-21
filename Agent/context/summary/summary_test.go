// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Agent/context/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestSummaryKeepsSourceAndRejectsUnverifiedCandidates
// Impact: python -B scripts/code-atlas.py show Agent/context/summary/summary_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package summary

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/aieyra/aieyra-os/contracts/protocol"
)

func TestSummaryKeepsSourceAndRejectsUnverifiedCandidates(t *testing.T) {
	messages := []protocol.Message{{Role: protocol.RoleAssistant, Content: "verified progress", ResponseItems: []json.RawMessage{json.RawMessage(`{"encrypted_content":"OPAQUE"}`)}, NativeContent: json.RawMessage(`{"signature":"OPAQUE"}`), ReasoningContent: "PRIVATE_REASONING"}, {Role: protocol.RoleUser, Content: "保留我的原文"}}
	original, _ := json.Marshal(messages)
	for _, mode := range []string{"ok", "wrong-source", "missing-fields", "trailing", "cut-off", "cancelled"} {
		t.Run(mode, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			result, err := Compact(ctx, json.RawMessage(`{"summary":"previous","plan":{"id":"original-plan"}}`), messages, "public instructions", func(_ context.Context, input []protocol.Message) (protocol.Message, string, error) {
				if len(input) != 2 || input[0].Content != "public instructions" || strings.Contains(input[1].Content, "OPAQUE") || strings.Contains(input[1].Content, "PRIVATE_REASONING") {
					t.Fatal("summary request included opaque continuation or lost instructions")
				}
				var request struct {
					Digest string          `json:"source_digest"`
					Source json.RawMessage `json:"source"`
				}
				if json.Unmarshal([]byte(input[1].Content), &request) != nil || request.Digest != fmt.Sprintf("%x", sha256.Sum256(request.Source)) || !strings.Contains(string(request.Source), "original-plan") || !strings.Contains(string(request.Source), "保留我的原文") {
					t.Fatal("source projection lost provenance")
				}
				summary := Summary{SourceDigest: request.Digest, Goals: []string{"finish"}, Constraints: []string{}, Decisions: []string{}, Progress: []string{"verified"}, CriticalFacts: []string{}, OpenTasks: []string{}, NextSteps: []string{}, Uncertainties: []string{}}
				finish := "stop"
				switch mode {
				case "wrong-source":
					summary.SourceDigest = "foreign"
				case "missing-fields":
					summary.Constraints = nil
				case "cut-off":
					finish = "length"
				case "cancelled":
					cancel()
				}
				raw, _ := json.Marshal(summary)
				if mode == "trailing" {
					raw = append(raw, []byte(` {}`)...)
				}
				return protocol.Message{Content: string(raw)}, finish, nil
			})
			if mode == "ok" {
				if err != nil || result == nil {
					t.Fatal(err)
				}
			} else if err == nil || result != nil {
				t.Fatal("unverified candidate accepted", mode)
			}
			after, _ := json.Marshal(messages)
			if string(original) != string(after) {
				t.Fatal("summary modified original archive view")
			}
		})
	}
}

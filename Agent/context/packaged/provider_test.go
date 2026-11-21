// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Agent/context/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: fixture; TestPackagePolicyUsesFullSourceAndValidatedSummary; TestPackagePolicyRetainsNamespacedStateAndRequestBytes
// Impact: python -B scripts/code-atlas.py show Agent/context/packaged/provider_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package packaged

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/aieyra/aieyra-os/agent/context/contract"
	port "github.com/aieyra/aieyra-os/contracts/context"
	"github.com/aieyra/aieyra-os/contracts/protocol"
)

func fixture(t *testing.T) Provider {
	t.Helper()
	p, err := New(Definition{Schema: "aieyra.context/1", ID: "example.context", Version: "1.0.0", Name: "Project continuity", StateSchema: 1, Engine: "structured", KeepTurns: 3, SummaryGuidance: "Keep corrections and their source; distinguish completed and open work."}, strings.Repeat("a", 64))
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func TestPackagePolicyUsesFullSourceAndValidatedSummary(t *testing.T) {
	p := fixture(t)
	original := strings.Repeat("long original correction ", 1500)
	in := contract.Input{Messages: []protocol.Message{{Role: protocol.RoleUser, Content: original}}, Instruction: "Return the required complete structured JSON."}
	for _, wrong := range []bool{false, true} {
		candidate, err := p.Compact(context.Background(), in, func(_ context.Context, messages []protocol.Message) (protocol.Message, string, error) {
			if !strings.Contains(messages[0].Content, p.definition.SummaryGuidance) || !strings.Contains(messages[1].Content, original) {
				t.Fatal("policy or full source missing")
			}
			var source struct {
				Digest string `json:"source_digest"`
			}
			if e := json.Unmarshal([]byte(messages[1].Content), &source); e != nil {
				t.Fatal(e)
			}
			if wrong {
				source.Digest = "wrong-source"
			}
			body, _ := json.Marshal(map[string]any{"source_digest": source.Digest, "goals": []string{"Keep continuity"}, "constraints": []string{}, "decisions": []string{}, "progress": []string{}, "critical_facts": []string{original}, "open_tasks": []string{}, "next_steps": []string{}, "uncertainties": []string{}})
			return protocol.Message{Content: string(body)}, "stop", nil
		})
		if wrong && err == nil {
			t.Fatal("wrong source accepted")
		}
		if !wrong && (err != nil || candidate.Summary.CriticalFacts[0] != original) {
			t.Fatal(candidate, err)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := p.Compact(ctx, in, func(context.Context, []protocol.Message) (protocol.Message, string, error) {
		t.Fatal("cancelled completion called")
		return protocol.Message{}, "", nil
	}); err == nil {
		t.Fatal("cancelled policy accepted")
	}
	if in.Messages[0].Content != original {
		t.Fatal("source mutated")
	}
}

func TestPackagePolicyRetainsNamespacedStateAndRequestBytes(t *testing.T) {
	p := fixture(t)
	old := port.State{Schema: 1, Session: "session", Provider: port.Reference{ID: "example.other", Version: "1.0.0", StateSchema: 1}, Namespaces: map[string]port.Namespace{"example.other": {Schema: 7, Data: json.RawMessage(`{"original":"preserve"}`)}}}
	next, err := p.Migrate(old, "session")
	if err != nil || next.Provider.Digest != strings.Repeat("a", 64) || string(next.Namespaces["example.other"].Data) != string(old.Namespaces["example.other"].Data) {
		t.Fatal(next, err)
	}
	if _, err = p.Migrate(old, "another"); err == nil {
		t.Fatal("foreign session imported")
	}
	messages := []protocol.Message{{Role: protocol.RoleUser, Content: "original", ResponseItems: []json.RawMessage{json.RawMessage(`{"signature":"native"}`)}}}
	out := p.Assemble(nil, messages)
	out[0].Content = "changed"
	if messages[0].Content != "original" || string(out[0].ResponseItems[0]) != string(messages[0].ResponseItems[0]) {
		t.Fatal("assembly lost original wire data or shared mutable state")
	}
}

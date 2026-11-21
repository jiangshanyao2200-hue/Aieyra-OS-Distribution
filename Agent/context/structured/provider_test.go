// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Agent/context/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestPortableStatePreservesInactiveNamespacesAndRejectsAnotherSession; TestStructuredProviderCompactsWithoutPACOrMutableInputAliases
// Impact: python -B scripts/code-atlas.py show Agent/context/structured/provider_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package structured_test

import (
	"context"
	"encoding/json"
	"github.com/aieyra/aieyra-os/agent/context/contract"
	"github.com/aieyra/aieyra-os/agent/context/structured"
	"github.com/aieyra/aieyra-os/agent/context/summary"
	port "github.com/aieyra/aieyra-os/contracts/context"
	"github.com/aieyra/aieyra-os/contracts/protocol"
	"strings"
	"testing"
)

func TestPortableStatePreservesInactiveNamespacesAndRejectsAnotherSession(t *testing.T) {
	p := structured.New()
	old := port.State{Schema: 1, Session: "session-a", Provider: port.Reference{ID: "example.pac", Version: "1.0.0", StateSchema: 1}, Namespaces: map[string]port.Namespace{"example.pac": {Schema: 7, Data: json.RawMessage(`{"cursor":123,"opaque":"preserve"}`)}}}
	next, err := p.Migrate(old, "session-a")
	if err != nil || next.Provider != structured.Reference || string(next.Namespaces["example.pac"].Data) != string(old.Namespaces["example.pac"].Data) {
		t.Fatal(next, err)
	}
	ns := next.Namespaces["example.pac"]
	ns.Data[0] = '['
	if old.Namespaces["example.pac"].Data[0] != '{' {
		t.Fatal("state aliases caller memory")
	}
	data, _ := p.Export(old)
	if _, err = p.Import(data, "session-b"); err == nil {
		t.Fatal("cross-session import accepted")
	}
	old.Namespaces[structured.Reference.ID] = port.Namespace{Schema: 2, Data: json.RawMessage(`{}`)}
	if _, err = p.Migrate(old, "session-a"); err == nil {
		t.Fatal("unsupported own schema discarded")
	}
}

func TestStructuredProviderCompactsWithoutPACOrMutableInputAliases(t *testing.T) {
	p := structured.New()
	original := []protocol.Message{{Role: protocol.RoleUser, Content: "A long exact instruction"}}
	assembled := p.Assemble(nil, original)
	assembled[0].Content = "mutated"
	if original[0].Content != "A long exact instruction" {
		t.Fatal("request mutated archive")
	}
	called := 0
	complete := func(ctx context.Context, m []protocol.Message) (protocol.Message, string, error) {
		called++
		if strings.Contains(string(m[1].Content), "memory_compaction") {
			t.Fatal("PAC protocol leaked")
		}
		var envelope struct {
			Digest string `json:"source_digest"`
		}
		if err := json.Unmarshal([]byte(m[1].Content), &envelope); err != nil {
			t.Fatal(err)
		}
		s := summary.Summary{SourceDigest: envelope.Digest, Goals: []string{"finish"}, Constraints: []string{}, Decisions: []string{}, Progress: []string{}, CriticalFacts: []string{}, OpenTasks: []string{}, NextSteps: []string{}, Uncertainties: []string{}}
		b, _ := json.Marshal(s)
		return protocol.Message{Role: protocol.RoleAssistant, Content: string(b)}, "stop", nil
	}
	candidate, err := p.Compact(context.Background(), contract.Input{Messages: original, Instruction: "fixture summary"}, complete)
	if err != nil || candidate.Summary == nil || candidate.PacketText != "" || called != 1 {
		t.Fatal(candidate, err, called)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err = p.Compact(ctx, contract.Input{Messages: original}, complete); err == nil {
		t.Fatal("cancelled candidate accepted")
	}
	if called != 1 {
		t.Fatal("cancelled request reached model")
	}
}

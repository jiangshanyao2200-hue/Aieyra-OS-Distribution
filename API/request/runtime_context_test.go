// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: API/request/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestRuntimeSectionsAndRemovalSurviveEveryWireProtocol
// Impact: python -B scripts/code-atlas.py show API/request/runtime_context_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package request_test

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"

	"github.com/aieyra/aieyra-os/api/request"
	"github.com/aieyra/aieyra-os/contracts/protocol"
)

func TestRuntimeSectionsAndRemovalSurviveEveryWireProtocol(t *testing.T) {
	for _, codec := range []string{"chat", "responses", "responses-direct", "anthropic", "google"} {
		t.Run(codec, func(t *testing.T) {
			messages := []protocol.Message{
				{Role: "system", Content: "stable identity"},
				{Role: "user", Content: "real user text"},
				{Role: "system", Name: "aieyra_runtime_result", Content: "pending process", ContextObservation: true},
				{Role: "user", Name: "aieyra_situation", Content: "current program", ContextObservation: true},
				{Role: "assistant", Content: "observed"},
				{Role: "system", Name: "aieyra_runtime_result", Content: `{"available":false,"state":"removed"}`, ContextObservation: true},
			}
			before, _ := json.Marshal(messages)
			p := request.Profile{Provider: "fixture", Generic: codec != "responses-direct"}
			var body any
			switch codec {
			case "chat":
				body = request.BuildChat(p, messages, false, nil)
			case "responses", "responses-direct":
				body = request.BuildResponses(p, messages, false, nil, nil)
			default:
				p.Protocol = request.ProtocolMessages
				if codec == "google" {
					p.Protocol = request.ProtocolGoogle
				}
				body = request.BuildNative(p, messages, false, nil)
			}
			encoded, _ := json.Marshal(body)
			text := string(encoded)
			if strings.Count(text, "section: aieyra_runtime_result") != 2 || strings.Count(text, "section: aieyra_situation") != 1 || strings.Count(text, "[Aieyra runtime context]") != 3 {
				t.Fatal("observation identity lost or duplicated", text)
			}
			if strings.Index(text, "pending process") > strings.Index(text, "removed") {
				t.Fatal("removal preceded the original observation", text)
			}
			after, _ := json.Marshal(messages)
			if !bytes.Equal(before, after) {
				t.Fatal("transport rewrote archived history")
			}
		})
	}
}

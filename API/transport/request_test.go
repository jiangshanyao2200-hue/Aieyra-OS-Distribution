// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: API/transport/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestProtocolRoutesHeadersAndBody; TestRequestRejectsUnknownProtocolAndInvalidBodyBeforeIO
// Impact: python -B scripts/code-atlas.py show API/transport/request_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package transport_test

import (
	"context"
	"io"
	"strings"
	"testing"

	"github.com/aieyra/aieyra-os/api/transport"
	"github.com/aieyra/aieyra-os/contracts/protocol"
)

func TestProtocolRoutesHeadersAndBody(t *testing.T) {
	for _, kind := range []string{protocol.ProtocolChat, protocol.ProtocolResponses, protocol.ProtocolMessages, protocol.ProtocolGoogle} {
		for _, stream := range []bool{false, true} {
			c := transport.Connection{BaseURL: "https://provider.invalid/v1", Protocol: kind, Model: "model/fixture", APIKey: "fixture-key"}
			r, err := transport.NewRequest(context.Background(), c, map[string]any{"input": "fixture"}, stream)
			if err != nil {
				t.Fatal(err)
			}
			data, err := io.ReadAll(r.Body)
			r.Body.Close()
			if err != nil || string(data) != `{"input":"fixture"}` || r.Method != "POST" || r.Header.Get("Content-Type") != "application/json" || r.Header.Get("Authorization") != "Bearer fixture-key" {
				t.Fatal("request lost payload or standard headers")
			}
			if (r.Header.Get("Accept") == "text/event-stream") != stream {
				t.Fatal("stream accept header")
			}
			switch kind {
			case protocol.ProtocolChat:
				if r.URL.Path != "/v1/chat/completions" {
					t.Fatal(r.URL)
				}
			case protocol.ProtocolResponses:
				if r.URL.Path != "/v1/responses" {
					t.Fatal(r.URL)
				}
			case protocol.ProtocolMessages:
				if r.URL.Path != "/v1/messages" || r.Header.Get("x-api-key") != "fixture-key" || r.Header.Get("anthropic-version") != "2023-06-01" {
					t.Fatal("native message route/headers")
				}
			case protocol.ProtocolGoogle:
				if !strings.Contains(r.URL.EscapedPath(), "model%2Ffixture") || r.Header.Get("x-goog-api-key") != "fixture-key" || (r.URL.Query().Get("alt") == "sse") != stream {
					t.Fatal("Google route/headers", r.URL)
				}
			}
		}
	}
}

func TestRequestRejectsUnknownProtocolAndInvalidBodyBeforeIO(t *testing.T) {
	c := transport.Connection{BaseURL: "https://fixture.invalid", Protocol: "unknown"}
	if _, err := transport.NewRequest(context.Background(), c, nil, false); err == nil {
		t.Fatal("unknown protocol accepted")
	}
	c.Protocol = protocol.ProtocolResponses
	if _, err := transport.NewRequest(context.Background(), c, func() {}, false); err == nil {
		t.Fatal("unserializable body accepted")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	r, err := transport.NewRequest(ctx, c, map[string]any{}, false)
	if err != nil || r.Context().Err() != context.Canceled {
		t.Fatal("caller context lost")
	}
}

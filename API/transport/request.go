// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: API/transport/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: Connection; Endpoint; NewRequest
// Impact: python -B scripts/code-atlas.py show API/transport/request.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package transport

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"

	"github.com/aieyra/aieyra-os/api/adapter"
	"github.com/aieyra/aieyra-os/contracts/protocol"
)

// Connection is supplied by the host for one validated model profile.
// No configuration or credential files are read by transport.
type Connection struct {
	BaseURL, Protocol, Model, APIKey string
	Adapter                          *adapter.Definition
}

func Endpoint(base, kind, model string, stream bool) string {
	switch kind {
	case protocol.ProtocolChat:
		return base + "/chat/completions"
	case protocol.ProtocolResponses:
		return base + "/responses"
	case protocol.ProtocolMessages:
		return base + "/messages"
	case protocol.ProtocolGoogle:
		endpoint := base + "/models/" + url.PathEscape(model)
		if stream {
			return endpoint + ":streamGenerateContent?alt=sse"
		}
		return endpoint + ":generateContent"
	default:
		return ""
	}
}

// NewRequest serializes an already prepared body, adds protocol headers and
// keeps the caller's context. It performs no I/O and never retries a task.
func NewRequest(ctx context.Context, c Connection, body any, stream bool) (*http.Request, error) {
	endpoint := Endpoint(c.BaseURL, c.Protocol, c.Model, stream)
	if endpoint == "" {
		return nil, fmt.Errorf("unsupported model protocol: %s", c.Protocol)
	}
	data, err := json.Marshal(body)
	var headers http.Header
	if c.Adapter != nil {
		endpoint, data, headers, err = c.Adapter.Prepare(c.BaseURL, c.Protocol, c.Model, stream, body)
	}
	if err != nil {
		return nil, fmt.Errorf("encode model request: %w", err)
	}
	r, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	r.Header.Set("Content-Type", "application/json")
	ProviderHeaders(r, c.APIKey)
	switch c.Protocol {
	case protocol.ProtocolMessages:
		r.Header.Set("x-api-key", c.APIKey)
		r.Header.Set("anthropic-version", "2023-06-01")
	case protocol.ProtocolGoogle:
		r.Header.Set("x-goog-api-key", c.APIKey)
	}
	for key, values := range headers {
		r.Header[key] = append([]string(nil), values...)
	}
	if stream {
		r.Header.Set("Accept", "text/event-stream")
	}
	return r, nil
}

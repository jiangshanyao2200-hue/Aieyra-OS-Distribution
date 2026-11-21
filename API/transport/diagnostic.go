// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: API/transport/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: DiagnosticJSON
// Impact: python -B scripts/code-atlas.py show API/transport/diagnostic.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package transport

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

// DiagnosticJSON sends one nonstreaming protocol sample through the same
// connection and adapter as normal requests. It never retries or executes tools.
func DiagnosticJSON(ctx context.Context, client *http.Client, connection Connection, body json.RawMessage) (json.RawMessage, error) {
	request, err := NewRequest(ctx, connection, body, false)
	if err != nil {
		return nil, err
	}
	response, err := client.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, ParseAPIError(response)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, (4<<20)+1))
	if err != nil {
		return nil, err
	}
	if len(data) > 4<<20 || !json.Valid(data) {
		return nil, fmt.Errorf("诊断响应必须是最多4MiB的JSON")
	}
	return json.RawMessage(data), nil
}

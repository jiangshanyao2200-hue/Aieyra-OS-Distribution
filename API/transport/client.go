// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: API/transport/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: NewClient; streamActivityKey; WithStreamActivity; activityTransport; RoundTrip; CloseIdleConnections; activityBody; Read; sessionKey; WithSession; SessionID; ProviderHeaders; PromptCacheKey
// Impact: python -B scripts/code-atlas.py show API/transport/client.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Package transport owns provider connections and transport diagnostics.
// It does not load settings, execute tools, or decide whether to replay a task.
package transport

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"strings"
	"time"
)

// NewClient preserves streaming timeouts and refuses redirects so provider
// credentials and request bodies never follow a server-selected destination.
func NewClient(timeout time.Duration) *http.Client {
	if timeout <= 0 {
		timeout = 300 * time.Second
	}
	return &http.Client{
		Timeout:       timeout,
		CheckRedirect: func(req *http.Request, via []*http.Request) error { return http.ErrUseLastResponse },
		Transport: activityTransport{Trace(&http.Transport{
			Proxy:               http.ProxyFromEnvironment,
			MaxIdleConns:        16,
			IdleConnTimeout:     90 * time.Second,
			TLSHandshakeTimeout: 15 * time.Second,
			ForceAttemptHTTP2:   true,
		})},
	}
}

type streamActivityKey struct{}

// WithStreamActivity reports bytes read from a successful streaming response.
// The caller decides when those bytes are allowed to extend an idle timeout.
func WithStreamActivity(ctx context.Context, onRead func()) context.Context {
	return context.WithValue(ctx, streamActivityKey{}, onRead)
}

type activityTransport struct{ http.RoundTripper }

func (t activityTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	resp, err := t.RoundTripper.RoundTrip(req)
	if read, ok := req.Context().Value(streamActivityKey{}).(func()); ok && err == nil && resp.StatusCode == http.StatusOK {
		resp.Body = activityBody{resp.Body, read}
	}
	return resp, err
}

func (t activityTransport) CloseIdleConnections() {
	if closer, ok := t.RoundTripper.(interface{ CloseIdleConnections() }); ok {
		closer.CloseIdleConnections()
	}
}

type activityBody struct {
	io.ReadCloser
	read func()
}

func (b activityBody) Read(p []byte) (int, error) {
	n, err := b.ReadCloser.Read(p)
	if n > 0 {
		b.read()
	}
	return n, err
}

type sessionKey struct{}

// WithSession carries the stable role/session identity through model workers.
func WithSession(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, sessionKey{}, id)
}

func SessionID(ctx context.Context) string {
	id, _ := ctx.Value(sessionKey{}).(string)
	return id
}

func ProviderHeaders(req *http.Request, apiKey string) {
	req.Header.Set("User-Agent", "AieyraOS/0.1.24")
	req.Header.Set("Authorization", "Bearer "+apiKey)
	if req.URL.Hostname() == "opencode.ai" {
		if id := SessionID(req.Context()); id != "" && !strings.ContainsAny(id, "\r\n") {
			req.Header.Set("x-opencode-session", id)
		}
	}
}

// PromptCacheKey provides a stable opaque partition key; protocol capabilities
// decide whether to send it. A key is not evidence of a supplier cache hit.
func PromptCacheKey(ctx context.Context) string {
	id := SessionID(ctx)
	if id == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(id))
	return "aieyra-" + hex.EncodeToString(sum[:16])
}

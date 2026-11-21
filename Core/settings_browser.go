// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: SetBrowserBridge; browserSession; browserToolSession; callBrowser
// Impact: python -B scripts/code-atlas.py show Core/settings_browser.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Only the authenticated desktop bridge registers this private local capability.
// It does not require a cloud login and is never returned to the model.
func (s *SettingsService) SetBrowserBridge(raw string) error {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "http" || u.Hostname() != "127.0.0.1" || u.Port() == "" || len(u.Path) != 65 || u.RawQuery != "" || u.Fragment != "" || u.User != nil || strings.Trim(u.Path[1:], "0123456789abcdef") != "" {
		return fmt.Errorf("invalid local browser connection")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return fmt.Errorf("browser host closed")
	}
	s.browserURL = raw
	return nil
}

// Main Eyra shares the workspace browser even before its first model turn.
// Other agents keep their existing identity and cannot inherit these tabs.
func browserSession(ctx context.Context, fallback string) string {
	if c, ok := ctx.Value(workspaceContextKey{}).(workspaceContext); ok && c.workspace != nil && c.role == WorkspaceMatrix {
		c.workspace.mu.Lock()
		defer c.workspace.mu.Unlock()
		if c.workspace.state.ID != "" {
			return c.workspace.state.ID
		}
	}
	return fallback
}

// The native program and its Agent share the program scope. An OS chat with
// the same specialist owns separate tabs, even while the native program works.
func browserToolSession(ctx context.Context, fallback string) (string, error) {
	if bound, ok := ctx.Value(programAgentContextKey{}).(programAgentContext); ok && bound.program == "browser" {
		if err := bound.valid(ctx); err != nil {
			return "", err
		}
		if bound.record.Spec.RequestID == "program/browser" {
			return "program/browser", nil
		}
		return bound.record.ID, nil
	}
	return browserSession(ctx, fallback), nil
}

func (s *SettingsService) callBrowser(ctx context.Context, owner string, args json.RawMessage) (json.RawMessage, error) {
	s.mu.Lock()
	raw, closed := s.browserURL, s.closed
	s.mu.Unlock()
	if closed || raw == "" {
		return nil, fmt.Errorf("browser host unavailable")
	}
	data, err := json.Marshal(map[string]any{"owner": owner, "arguments": args})
	if err != nil || len(data) > 1<<20 {
		return nil, fmt.Errorf("invalid browser request")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, raw, bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("invalid browser connection")
	}
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 50 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("browser connection interrupted; outcome unknown, inspect before retrying")
	}
	defer resp.Body.Close()
	result, err := io.ReadAll(io.LimitReader(resp.Body, (1<<20)+1))
	if err != nil || resp.StatusCode != http.StatusOK || len(result) > 1<<20 || !json.Valid(result) {
		return nil, fmt.Errorf("invalid browser response; outcome unknown, inspect before retrying")
	}
	return result, nil
}

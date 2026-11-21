// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestCatalogIsolatedGeminiLive
// Impact: python -B scripts/code-atlas.py show Core/model_catalog_live_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// Opt-in only: the coordinator supplies one isolated, narrowly authorized copy.
// Normal test runs never read a real user configuration or call an upstream.
func TestCatalogIsolatedGeminiLive(t *testing.T) {
	file := os.Getenv("AIEYRA_C1_ISOLATED_CONFIG")
	if file == "" {
		t.Skip("isolated gateway validation only")
	}
	s, err := Load(file)
	if err != nil {
		t.Fatal("isolated config load failed")
	}
	if s.Model != "gemini-3.8-flash-high" || s.BaseURL != "https://fast.aieyra.cn/v1" || s.Protocol() != ProtocolResponses || s.ContextBudget().InputLimit() <= 0 {
		t.Fatal("isolated Gemini identity/budget invalid")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	start := time.Now()
	m, usage, err := New(s).Complete(ctx, s, []Message{{Role: RoleUser, Content: "Reply with exactly C1_OK and nothing else."}})
	result := map[string]any{"model": s.Model, "protocol": s.Protocol(), "context_window": s.ModelContextWindow, "output_limit": s.activePoolProfile().OutputLimit, "request_output": s.MaxTokens, "input_budget": s.ContextBudget().InputLimit(), "elapsed_ms": time.Since(start).Milliseconds(), "success": err == nil, "response": m.Content, "usage": usage}
	if err != nil {
		result["error"] = "gateway request failed; inspect isolated trace"
	}
	raw, _ := json.MarshalIndent(result, "", "  ")
	if writeErr := os.WriteFile(filepath.Join(filepath.Dir(file), "gemini-live-result.json"), raw, 0600); writeErr != nil {
		t.Fatal(writeErr)
	}
	if err != nil || m.Content == "" {
		t.Fatal("isolated gateway Gemini did not return a successful nonempty answer")
	}
}

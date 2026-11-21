// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestCatalogSubconsciousDetachedConnectionAndBudget; TestCatalogSubconsciousInvalidSelectionIsCleared
// Impact: python -B scripts/code-atlas.py show Core/model_catalog_subconscious_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"bytes"
	"testing"
)

func TestCatalogSubconsciousDetachedConnectionAndBudget(t *testing.T) {
	s := catalogWireFixture("qwen3.8-max", ProtocolChat, nil)
	s.applyPoolProfile()
	mainID, mainModel := s.ActiveProfile, s.Model
	s.MatrixProfile = mainID
	other := s.APIProfiles[0]
	other.ID, other.ConnectionID, other.BaseURL = "sub", "sub-connection", "https://fast.aieyra.cn/v1"
	other.Provider, other.Model, other.Protocol = "custom", "gemini-3.8-flash-high", ProtocolResponses
	other.ContextWindow, other.OutputLimit = 8192, 2048
	other.CompactAtTokens = catalogInt(0)
	other.ParameterSpecs = nil
	other.Parameters = rawJSON(map[string]any{"max_tokens": 0, "model_options": map[string]any{"reasoning_effort": "high"}})
	s.APIProfiles = append(s.APIProfiles, other)
	s.ProviderConnections = append(s.ProviderConnections, ProviderConnection{ID: other.ConnectionID, BaseURL: other.BaseURL, APIKey: "synthetic-sub-key", APIKeyHistory: []string{"synthetic-history"}, RequestTimeout: 60})
	s.SubconsciousProfile = "sub"
	before := rawJSON(s)
	got, ok := s.SubconsciousSettings()
	if !ok || got.ActiveProfile != "sub" || got.MatrixProfile != mainID || got.Model != other.Model || got.APIKey != "synthetic-sub-key" || got.RequestTimeout != 60 {
		t.Fatal("subconscious did not resolve its own connection", ok)
	}
	if got.ContextBudget().InputLimit() != 4096 || got.ContextBudget().Threshold() != 0 || got.MaxTokens != 0 || got.ContextBudget().Output != 2048 {
		t.Fatal("subconscious did not use its own safe budget", got.ContextBudget())
	}
	if err := got.ValidatePoolRequest(); err != nil {
		t.Fatal(err)
	}
	got.ModelOptions["reasoning_effort"] = "low"
	got.ProviderConnections[1].APIKeyHistory[0] = "changed"
	*got.APIProfiles[1].CompactAtTokens = 1000
	if !bytes.Equal(before, rawJSON(s)) || s.ActiveProfile != mainID || s.Model != mainModel {
		t.Fatal("subconscious snapshot changed main settings")
	}
}

func TestCatalogSubconsciousInvalidSelectionIsCleared(t *testing.T) {
	s := catalogGeminiFixture()
	for _, id := range []string{"", "missing"} {
		s.SubconsciousProfile = id
		if _, ok := s.SubconsciousSettings(); ok {
			t.Fatal("invalid subconscious returned settings")
		}
		s.applyPoolProfile()
		if s.SubconsciousProfile != "" {
			t.Fatal("stale subconscious survived migration")
		}
	}
	s.SubconsciousProfile = s.APIProfiles[0].ID
	disabled := false
	s.APIProfiles[0].Enabled = &disabled
	s.applyPoolProfile()
	if s.SubconsciousProfile != "" {
		t.Fatal("disabled subconscious survived migration")
	}
}

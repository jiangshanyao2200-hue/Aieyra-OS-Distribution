// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: catalogInt; TestUnknownModelWorkingTargetStartsCompactionAtEightyPercent; TestCatalogCompactRecommendation; TestCatalogCompactMigrationAndProfileSwitch; TestCatalogCompactExplicitZeroAndClone; TestCatalogContextTuningAndOutputReservation; TestCatalogPublicDataDetachedAndSummariesBounded; TestCatalogTemporaryOutputReservationDoesNotInvalidateSavedCompact
// Impact: python -B scripts/code-atlas.py show Core/model_catalog_context_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"encoding/json"
	"testing"
	"unicode/utf8"
)

func catalogInt(v int) *int { return &v }

func TestUnknownModelWorkingTargetStartsCompactionAtEightyPercent(t *testing.T) {
	s := nativeModelConfigFixture("unlisted-grok-build", ProtocolResponses, nil)
	s.APIProfiles[0].CompactAtTokens = nil
	s.CompactPercent = 90
	s.applyPoolProfile()
	if *s.activePoolProfile().CompactAtTokens != 200000 || s.ContextBudget().Threshold() != 160000 {
		t.Fatal("unknown default", s.ContextBudget())
	}
	for _, target := range []int{1000, 20000, 2000000} {
		s.activePoolProfile().CompactAtTokens = catalogInt(target)
		s.applyPoolProfile()
		if err := s.ValidatePoolRequest(); err != nil {
			t.Fatal(err)
		}
		if s.ContextBudget().Threshold() != target*80/100 {
			t.Fatal(target, s.ContextBudget())
		}
	}
	if profileContextLimit(s.activePoolProfile()) != 0 {
		t.Fatal("local budget was presented as known capacity")
	}
}

func TestCatalogCompactRecommendation(t *testing.T) {
	for _, tc := range []struct{ window, output, want int }{
		{1000000, 4096, 750000},
		{1048576, 4096, 786000},
		{1050000, 4096, 786000},
		{131072, 4096, 98000},
		{8192, 2048, 6000},
		{100000, 71000, 28000},
		{100000, 100000, 0},
	} {
		if got := RecommendedCompactAtTokens(tc.window, tc.output); got != tc.want {
			t.Fatalf("window=%d output=%d compact=%d want=%d", tc.window, tc.output, got, tc.want)
		}
	}
}

func TestCatalogCompactMigrationAndProfileSwitch(t *testing.T) {
	s := catalogWireFixture("qwen3.8-max", ProtocolChat, nil)
	s.ContextWorkingTokens, s.CompactPercent = 100000, 90
	s.APIProfiles[0].CompactAtTokens = nil
	s.applyPoolProfile()
	if got := s.ContextBudget().Threshold(); got != 72000 {
		t.Fatalf("legacy absolute trigger changed: %d", got)
	}
	other := s.APIProfiles[0]
	other.ID, other.CompactAtTokens = "other", catalogInt(40000)
	s.APIProfiles = append(s.APIProfiles, other)
	s.ActiveProfile = "other"
	s.applyPoolProfile()
	if s.ContextBudget().Threshold() != 32000 || *s.CompactAtTokens != 40000 {
		t.Fatal("selected profile did not provide its own compact threshold")
	}
	s.ActiveProfile = s.APIProfiles[0].ID
	s.applyPoolProfile()
	if s.ContextBudget().Threshold() != 72000 {
		t.Fatal("switching profiles overwrote another model's compact setting")
	}
	// Top-level snapshots must never migrate a different model's value.
	s.ContextWorkingTokens, s.CompactPercent = 0, 0
	s.APIProfiles[1].CompactAtTokens = nil
	s.ActiveProfile = "other"
	s.applyPoolProfile()
	if *s.APIProfiles[1].CompactAtTokens != 0 || s.ContextBudget().Threshold() != 0 {
		t.Fatal("disabled legacy compaction inherited a stale top-level snapshot")
	}
}

func TestCatalogCompactExplicitZeroAndClone(t *testing.T) {
	s := catalogGeminiFixture()
	s.APIProfiles[0].CompactAtTokens = catalogInt(0)
	s.applyPoolProfile()
	if s.ContextBudget().Threshold() != 0 || s.ContextBudget().InputLimit() != 4096 {
		t.Fatal("zero must disable automatic compaction without disabling input")
	}
	copy := s.Clone()
	*copy.APIProfiles[0].CompactAtTokens = 1000
	*copy.CompactAtTokens = 2000
	if *s.APIProfiles[0].CompactAtTokens != 0 || *s.CompactAtTokens != 0 {
		t.Fatal("cloned settings share a compact pointer")
	}
	raw := rawJSON(s.APIProfiles[0])
	var fields map[string]any
	_ = json.Unmarshal(raw, &fields)
	if v, ok := fields["compact_at_tokens"]; !ok || v != float64(0) {
		t.Fatal("explicit zero disappeared during JSON persistence")
	}
	// The existing protocol safety margin remains effective for small windows.
	s.APIProfiles[0].CompactAtTokens = catalogInt(6000)
	if got := s.ContextBudget().Threshold(); got != 4800 {
		t.Fatalf("effective compact trigger exceeded safe input budget: %d", got)
	}
}

func TestCatalogContextTuningAndOutputReservation(t *testing.T) {
	s := catalogWireFixture("kimi-k3", ProtocolChat, nil)
	p := s.activePoolProfile()
	if p.ContextWindow != 1048576 || p.OutputLimit != 1048576 {
		t.Fatal("documented Kimi limits were not migrated")
	}
	p.Parameters = rawJSON(map[string]any{"max_tokens": 0})
	s.applyPoolProfile()
	if s.MaxTokens != 0 || s.ContextBudget().Output != 4096 || s.ContextBudget().InputLimit() <= 0 {
		t.Fatal("the theoretical output ceiling consumed all input reservation")
	}
	p = s.activePoolProfile()
	p.ContextWindow, p.CompactAtTokens = 128000, catalogInt(96000)
	s.applyPoolProfile()
	if err := s.ValidatePoolRequest(); err != nil {
		t.Fatal("valid reduced window rejected", err)
	}
	p.ContextWindow = 1048577
	s.applyPoolProfile()
	if s.ValidatePoolRequest() == nil {
		t.Fatal("window above official ceiling accepted")
	}
	p.ContextWindow, p.CompactAtTokens = 128000, catalogInt(127000)
	s.applyPoolProfile()
	if s.ValidatePoolRequest() != nil {
		t.Fatal("valid working target rejected despite runtime capacity guard")
	}
	p.CompactAtTokens = catalogInt(-1)
	s.applyPoolProfile()
	if s.ValidatePoolRequest() == nil {
		t.Fatal("negative compact trigger accepted")
	}
}

func TestCatalogPublicDataDetachedAndSummariesBounded(t *testing.T) {
	rows := ModelCatalog("bailian", "")
	if len(rows) != 187 {
		t.Fatal("reviewed Bailian catalog incomplete")
	}
	for i, row := range rows {
		if utf8.RuneCountInString(row.Summary) > 21 || i > 0 && rows[i-1].Rank > row.Rank {
			t.Fatal("invalid public summary or sorting", row.ID)
		}
	}
	rows[0].Rules[0].Defaults["reasoning_enabled"] = "tampered"
	rows[0].Rules[0].ParameterSpecs[0].WirePath[0] = "model"
	if rows[0].ToolCalls != nil {
		*rows[0].ToolCalls = false
	}
	fresh := ModelCatalog("bailian", "")
	if fresh[0].Rules[0].Defaults["reasoning_enabled"] == "tampered" || fresh[0].Rules[0].ParameterSpecs[0].WirePath[0] == "model" {
		t.Fatal("public caller changed the embedded catalog")
	}
}

func TestCatalogTemporaryOutputReservationDoesNotInvalidateSavedCompact(t *testing.T) {
	s := catalogWireFixture("qwen3.8-max", ProtocolChat, nil)
	p := s.activePoolProfile()
	p.ContextWindow = 32768
	p.Parameters = rawJSON(map[string]any{"max_tokens": 4096})
	p.CompactAtTokens = catalogInt(28672)
	s.applyPoolProfile()
	s.MaxTokens = 8192 // A bounded maintenance request; profile remains 4096.
	if err := s.Validate(); err != nil {
		t.Fatal("temporary output reservation invalidated saved configuration", err)
	}
	if got := s.ContextBudget().Threshold(); got != 18022 {
		t.Fatalf("temporary request did not retain its protocol/output reserve: %d", got)
	}
	if profileConfiguredOutput(p) != 4096 || *p.CompactAtTokens != 28672 {
		t.Fatal("maintenance reservation changed persistent model parameters")
	}
}

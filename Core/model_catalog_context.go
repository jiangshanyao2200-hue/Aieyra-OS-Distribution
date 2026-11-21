// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: fmtCatalogParameter; RecommendedCompactAtTokens; profileOutputReservation; profileConfiguredOutput; migrateProfileCompact; validateCatalogContext
// Impact: python -B scripts/code-atlas.py show Core/model_catalog_context.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"encoding/json"
	"fmt"
)

func fmtCatalogParameter(key string) error {
	return fmt.Errorf("当前供应商和协议不支持思考参数：%s", key)
}

// Snap down in thousands to the nearest even number OR a multiple of five.
func RecommendedCompactAtTokens(window, output int) int {
	n := max(0, min(window*3/4, window-output)) / 1000
	for n > 0 && n%2 != 0 && n%5 != 0 {
		n--
	}
	return n * 1000
}

func profileOutputReservation(p *APIProfile, explicit int) int {
	if explicit > 0 {
		return explicit
	}
	output := 4096
	if p.Protocol == ProtocolMessages {
		output = 8192
	}
	if p.OutputLimit > 0 {
		output = min(output, p.OutputLimit)
	}
	return min(output, max(1, p.ContextWindow/4))
}

func profileConfiguredOutput(p *APIProfile) int {
	var values struct {
		MaxTokens int `json:"max_tokens"`
	}
	_ = json.Unmarshal(p.Parameters, &values)
	return profileOutputReservation(p, values.MaxTokens)
}

func migrateProfileCompact(s *Settings, p *APIProfile) {
	if p.CompactAtTokens != nil {
		return
	}
	compact := 200000
	// Preserve explicit legacy choices, but the former default working budget
	// is now a 200K target for every model. Provider limits remain in ContextBudget.
	if s.CompactPercent == 0 {
		compact = 0
	} else if s.ContextWorkingTokens > 0 && s.ContextWorkingTokens != 200000 && s.CompactPercent > 0 && s.CompactPercent <= 100 {
		output := profileConfiguredOutput(p)
		legacy := ContextBudget{Window: p.ContextWindow, Output: output, Working: s.ContextWorkingTokens, Percent: s.CompactPercent}
		compact = legacy.Threshold()
	}
	p.CompactAtTokens = &compact
}

func validateCatalogContext(s *Settings, p *APIProfile) error {
	minimum := 8192
	if limit := profileContextLimit(p); limit > 0 {
		minimum = min(minimum, limit)
	}
	if p.ContextWindow != 0 && p.ContextWindow < minimum {
		return fmt.Errorf("context_window 至少 %d", minimum)
	}
	if limit := profileContextLimit(p); limit > 0 && p.ContextWindow > limit {
		return fmt.Errorf("上下文窗口超过此型号的已知上限 %d", limit)
	}
	// Validate persisted model configuration against its persisted output
	// selection. A maintenance request may temporarily reserve more output;
	// ContextBudget still clamps that request to its actual safe input limit.
	if p.CompactAtTokens != nil && (*p.CompactAtTokens < 0 || *p.CompactAtTokens > 2000000) {
		return fmt.Errorf("compact_at_tokens 需在 0～2000000 之间")
	}
	return nil
}

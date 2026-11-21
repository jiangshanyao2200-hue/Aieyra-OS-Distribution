// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestCatalogRuntimeRulesRequireReviewedEndpoint
// Impact: python -B scripts/code-atlas.py show Core/model_catalog_endpoint_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import "testing"

func TestCatalogRuntimeRulesRequireReviewedEndpoint(t *testing.T) {
	for _, provider := range []string{"custom", "aieyra-gateway"} {
		for _, base := range []string{
			"", "https://another.example/v1", "https://fast.aieyra.cn.evil.example/v1",
			"http://fast.aieyra.cn/v1", "https://fast.aieyra.cn:8443/v1",
			"https://user:pass@localhost/v1", "https://fast.aieyra.cn/other/v1",
			"https://fast.aieyra.cn/v1?route=other", "https://fast.aieyra.cn/v1#other",
		} {
			p := catalogGeminiFixture().APIProfiles[0]
			p.Provider, p.BaseURL = provider, base
			if _, ok := catalogRule(&p); ok {
				t.Fatalf("gateway rule accepted an unreviewed endpoint: %s %s", provider, base)
			}
		}
	}
	for _, base := range []string{"https://fast.aieyra.cn/v1", "https://FAST.AIEYRA.CN:443/v1/"} {
		p := catalogGeminiFixture().APIProfiles[0]
		p.BaseURL = base
		if _, ok := catalogRule(&p); !ok {
			t.Fatal("reviewed gateway endpoint rejected", base)
		}
	}
	s := catalogWireFixture("qwen3.8-flash", ProtocolChat, nil)
	p := *s.activePoolProfile()
	for _, base := range []string{"", "https://another.example/compatible-mode/v1", "https://dashscope.aliyuncs.com/v1"} {
		p.BaseURL = base
		if _, ok := catalogRule(&p); ok || validProfileParameterPath(&p, s.activePoolProfile().ParameterSpecs[0]) {
			t.Fatal("Bailian provider label authorized another endpoint", base)
		}
	}
	if len(ModelCatalog("aieyra-gateway", "")) != 21 || len(ModelCatalog("bailian", "")) != 187 {
		t.Fatal("public reference listing should not require a runtime endpoint")
	}
}

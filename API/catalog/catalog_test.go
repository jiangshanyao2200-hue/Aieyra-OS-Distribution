// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: API/catalog/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: fixture; TestCatalogScopesProviderAndDetachesQueryResults; TestNativeModelNamesPreservePublisherAndVariantBoundaries; TestEndpointRulesRejectLookalikesAndUnexpectedRoutes
// Impact: python -B scripts/code-atlas.py show API/catalog/catalog_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package catalog_test

import (
	"net/url"
	"testing"

	"github.com/aieyra/aieyra-os/api/catalog"
	"github.com/aieyra/aieyra-os/contracts/protocol"
)

const fixture = `{
 "models":[{"provider":"aieyra-gateway","id":"gpt-fixture","protocols":["responses"],"context_window":2000,"rules":[{"protocol":"responses","defaults":{"reasoning_effort":"low"},"parameter_specs":[{"key":"reasoning_effort","type":"enum","values":["low","high"],"wire_path":["reasoning","effort"]}]}]}],
 "native_models":[{"provider":"openai","id":"gpt-fixture","context_window":1000,"max_output":300},{"provider":"xai","id":"grok-4.7","context_window":4000}]
}`

func TestCatalogScopesProviderAndDetachesQueryResults(t *testing.T) {
	c, err := catalog.Parse([]byte(fixture))
	if err != nil {
		t.Fatal(err)
	}
	p := catalog.Profile{Provider: "aieyra-gateway", BaseURL: "https://fast.aieyra.cn/v1", Model: "gpt-fixture", Protocol: protocol.ProtocolResponses}
	entry, ok := c.LookupProfile(p)
	if !ok || c.Count() != 1 {
		t.Fatal(entry, ok)
	}
	entry.Rules[0].Defaults["reasoning_effort"] = "changed"
	entry.Protocols[0] = "changed"
	rule, ok := c.Rule(p)
	if !ok || rule.Defaults["reasoning_effort"] != "low" {
		t.Fatal("shared catalog changed", rule)
	}
	rule.ParameterSpecs[0].WirePath[0] = "messages"
	again, _ := c.Rule(p)
	if again.ParameterSpecs[0].WirePath[0] != "reasoning" {
		t.Fatal("returned rule aliases catalog")
	}
	capacity, ok := c.Capacity(p)
	if !ok || capacity.ContextWindow != 2000 || capacity.MaxOutput != 300 {
		t.Fatal(capacity)
	}
	p.BaseURL = "https://fast.aieyra.cn.attacker.invalid/v1"
	if _, ok = c.LookupProfile(p); ok {
		t.Fatal("spoofed relay acquired reviewed channel rules")
	}
	p.Provider = "bailian"
	if _, ok = c.Rule(p); ok {
		t.Fatal("Bailian fell back to unrelated native rules")
	}
	if rows := c.Entries("aieyra-gateway", ""); len(rows) != 1 {
		t.Fatal("public catalog listing changed")
	}
}

func TestNativeModelNamesPreservePublisherAndVariantBoundaries(t *testing.T) {
	c, err := catalog.Parse([]byte(fixture))
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"gpt-fixture", "openai/gpt-fixture:free", "grok-4.7-build-fast", "x-ai/grok-4.7"} {
		if _, ok := c.NativeModel(id); !ok {
			t.Fatal("valid native reference missing", id)
		}
	}
	for _, id := range []string{"anthropic/gpt-fixture", "random/gpt-fixture", "grok-4.7-build-unreviewed"} {
		if _, ok := c.NativeModel(id); ok {
			t.Fatal("unreviewed native alias", id)
		}
	}
	if _, err = catalog.Parse([]byte(`{broken`)); err == nil {
		t.Fatal("invalid data accepted")
	}
}

func TestEndpointRulesRejectLookalikesAndUnexpectedRoutes(t *testing.T) {
	for _, base := range []string{"http://fast.aieyra.cn/v1", "https://fast.aieyra.cn:8443/v1", "https://fast.aieyra.cn/v1?route=other", "https://@fast.aieyra.cn/v1", "https://fast.aieyra.cn/v1%2f"} {
		if catalog.VerifiedGateway(base) {
			t.Fatal(base)
		}
	}
	withUser, err := url.Parse("https://fast.aieyra.cn/v1")
	if err != nil {
		t.Fatal(err)
	}
	withUser.User = url.User("fixture")
	if catalog.VerifiedGateway(withUser.String()) {
		t.Fatal("userinfo accepted as reviewed endpoint")
	}
	for _, base := range []string{"https://dashscope.aliyuncs.com/compatible-mode/v1", "https://fixture.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/"} {
		if !catalog.VerifiedBailianEndpoint(base) {
			t.Fatal(base)
		}
	}
	for _, base := range []string{"https://dashscope.aliyuncs.com.attacker.invalid/compatible-mode/v1", "https://bad_region.maas.aliyuncs.com/compatible-mode/v1", "https://dashscope.aliyuncs.com/compatible-mode%2fv1"} {
		if catalog.VerifiedBailianEndpoint(base) {
			t.Fatal(base)
		}
	}
}

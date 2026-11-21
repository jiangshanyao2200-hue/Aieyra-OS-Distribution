// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: API/catalog/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestMuseCapabilitiesStayWithExactEndpointAndModel
// Impact: python -B scripts/code-atlas.py show API/catalog/muse_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package catalog

import (
	"net/url"
	"testing"
)

func TestMuseCapabilitiesStayWithExactEndpointAndModel(t *testing.T) {
	for _, base := range []string{"https://fast.aieyra.cn/v1"} {
		for model, kind := range map[string]string{"muse-spark": "chat", "muse-image": "image", "muse-video": "video"} {
			if MuseKind(base, model) != kind {
				t.Fatal(base, model)
			}
		}
		if MuseKind(base, "muse-spark-1.3-contributor") != "" {
			t.Fatal("OpenCode capability borrowed")
		}
	}
	withUser := url.URL{Scheme: "https", Host: "fast.aieyra.cn", Path: "/v1", User: url.User("fixture")}
	for _, base := range []string{"http://fast.aieyra.cn/v1", "https://fast.aieyra.cn.evil.invalid/v1", "https://fast.aieyra.cn/v1?channel=1", "https://relay.invalid/meta-muse/v1", "https://fast.aieyra.cn/v1/other", withUser.String(), "https://opencode.ai/zen/go/v1"} {
		if MuseKind(base, "muse-spark") != "" {
			t.Fatal("unreviewed endpoint borrowed capability", base)
		}
	}
}

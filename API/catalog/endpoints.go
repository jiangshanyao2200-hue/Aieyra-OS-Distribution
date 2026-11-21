// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: API/catalog/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: Provider; gatewayHost; VerifiedGateway; bailianWorkspaceHost; VerifiedBailianEndpoint
// Impact: python -B scripts/code-atlas.py show API/catalog/endpoints.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package catalog

import (
	"net/url"
	"regexp"
	"strings"

	"github.com/aieyra/aieyra-os/contracts"
)

func Provider(p Profile) string {
	if p.Provider == "bailian" && VerifiedBailianEndpoint(p.BaseURL) {
		return "bailian"
	}
	if VerifiedGateway(p.BaseURL) {
		return "aieyra-gateway"
	}
	if p.Provider == "bailian" || p.Provider == "aieyra-gateway" || p.Provider == "meta-muse" {
		return ""
	}
	return p.Provider
}

// The official gateway is written once in Contracts/official-services.json.
var gatewayHost, gatewayPath = contracts.OfficialGatewayHostPath()

func VerifiedGateway(raw string) bool {
	u, err := url.Parse(strings.TrimSpace(raw))
	return err == nil && u.Scheme == "https" && u.User == nil && u.Opaque == "" &&
		(u.Port() == "" || u.Port() == "443") && u.RawQuery == "" && u.Fragment == "" &&
		strings.EqualFold(u.Hostname(), gatewayHost) && strings.TrimRight(u.EscapedPath(), "/") == strings.TrimRight(gatewayPath, "/")
}

var bailianWorkspaceHost = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.(cn-beijing|cn-hongkong|ap-southeast-1|ap-northeast-1)\.maas\.aliyuncs\.com$`)

// Keep the endpoint boundary aligned with Client/Desktop/src/bailian.cjs. Only the
// exact model/protocol combination above has passed actual image recognition.
func VerifiedBailianEndpoint(raw string) bool {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Scheme != "https" || u.User != nil || u.Opaque != "" || (u.Port() != "" && u.Port() != "443") || u.RawQuery != "" || u.Fragment != "" || strings.TrimRight(u.EscapedPath(), "/") != "/compatible-mode/v1" {
		return false
	}
	host := strings.ToLower(u.Hostname())
	return host == "dashscope.aliyuncs.com" || host == "dashscope-intl.aliyuncs.com" || host == "dashscope-us.aliyuncs.com" || bailianWorkspaceHost.MatchString(host)
}

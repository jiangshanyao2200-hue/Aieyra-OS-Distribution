// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Contracts/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: officialServicesJSON; OfficialServices; official; init; Official; OfficialGatewayHostPath
// Impact: python -B scripts/code-atlas.py show Contracts/official_services.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package contracts

import (
	_ "embed"
	"encoding/json"
	"net/url"
)

//go:embed official-services.json
var officialServicesJSON []byte

// OfficialServices are the public client endpoints, written once in official-services.json.
type OfficialServices struct {
	Schema   string `json:"schema"`
	Site     string `json:"site"`
	Account  string `json:"account"`
	Gateway  string `json:"gateway"`
	OS       string `json:"os"`
	Download string `json:"download"`
	Updates  string `json:"updates"`
	Control  string `json:"control"`
}

var official OfficialServices

func init() {
	if err := json.Unmarshal(officialServicesJSON, &official); err != nil || official.Schema != "aieyra.official-services/1" {
		panic("invalid built-in official services")
	}
}

// Official returns a copy of the built-in official endpoints.
func Official() OfficialServices { return official }

// OfficialGatewayHostPath is the exact model gateway host and path.
func OfficialGatewayHostPath() (string, string) {
	u, err := url.Parse(official.Gateway)
	if err != nil {
		panic("invalid official gateway")
	}
	return u.Hostname(), u.EscapedPath()
}

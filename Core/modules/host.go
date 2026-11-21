// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/modules/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: toolScope; validScope
// Impact: python -B scripts/code-atlas.py show Core/modules/host.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package modules

import (
	"net/url"
	"regexp"
	"strings"
)

var toolScope = regexp.MustCompile(`^[a-z][a-z0-9_]{0,63}$`)

func validScope(p Permission) bool {
	if p.Capability == "package.invoke" {
		return idPattern.MatchString(p.Scope)
	}
	if p.Capability == "tool.invoke" {
		return toolScope.MatchString(p.Scope)
	}
	if p.Capability != "network.https" {
		return false
	}
	u, err := url.Parse(p.Scope)
	return err == nil && u.Scheme == "https" && u.Hostname() != "" && !strings.Contains(u.Host, "*") && u.User == nil && u.Path == "" && u.RawQuery == "" && !u.ForceQuery && u.Fragment == "" && u.String() == p.Scope
}

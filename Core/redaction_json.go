// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: redactSecretEncodings
// Impact: python -B scripts/code-atlas.py show Core/redaction_json.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import "github.com/aieyra/aieyra-os/contracts/privacy"

func redactSecretEncodings(text string, keys []string) string {
	return privacy.RedactSecretEncodings(text, keys)
}

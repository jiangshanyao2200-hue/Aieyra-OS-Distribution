// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: sessionInUse; lockSession
// Impact: python -B scripts/code-atlas.py show Core/session_lock.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import "github.com/aieyra/aieyra-os/CORE/sessionservice"

func sessionInUse(err error) bool             { return sessionservice.InUse(err) }
func lockSession(path string) (func(), error) { return sessionservice.Lock(path) }

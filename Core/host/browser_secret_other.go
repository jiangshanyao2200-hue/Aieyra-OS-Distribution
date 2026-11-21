// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/host/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: runBrowserSecretWorker
// Impact: python -B scripts/code-atlas.py show Core/host/browser_secret_other.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

//go:build !windows

package host

import (
	"errors"
	"io"
)

func runBrowserSecretWorker(bool, io.Reader, io.Writer) error {
	return errors.New("Windows browser secret storage is unavailable")
}

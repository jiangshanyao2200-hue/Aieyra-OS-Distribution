// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/cmd/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: fail
// Impact: python -B scripts/code-atlas.py show Core/cmd/aieyra-module/main_other.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

//go:build !windows

package main

import (
	"fmt"
	"os"
)

func fail(err error) {
	fmt.Fprintln(os.Stderr, err)
	os.Exit(1)
}

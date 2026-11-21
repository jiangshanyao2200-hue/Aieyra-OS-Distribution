// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Contracts/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: layoutJSON; developmentJSON; development; layout; init; ModuleSource; DevelopmentDocument
// Impact: python -B scripts/code-atlas.py show Contracts/layout.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Package contracts contains versioned declarations shared across clients.
package contracts

import (
	_ "embed"
	"encoding/json"
	"strings"
)

//go:embed product-layout.json
var layoutJSON []byte

//go:embed development-documents.json
var developmentJSON []byte

var development struct {
	Schema    string            `json:"schema"`
	Documents []string          `json:"documents"`
	Templates map[string]string `json:"templates"`
}

var layout struct {
	Schema int      `json:"schema"`
	Trees  []string `json:"source_trees"`
	Files  []string `json:"source_files"`
}

func init() {
	if err := json.Unmarshal(developmentJSON, &development); err != nil || development.Schema != "aieyra.development-documents/1" {
		panic("invalid built-in development document layout")
	}
	if err := json.Unmarshal(layoutJSON, &layout); err != nil || layout.Schema != 1 {
		panic("invalid built-in product layout")
	}
}

// ModuleSource identifies reviewed software roots, never imported user modules.
// Callers must still apply traversal, private-data, integrity and signature rules.
func ModuleSource(name string) bool {
	for _, file := range layout.Files {
		if name == file {
			return true
		}
	}
	for _, tree := range layout.Trees {
		if strings.HasPrefix(name, tree+"/") {
			return true
		}
	}
	return false
}

// DevelopmentDocument identifies exact public destinations, not template sources
// or entire documentation trees. Private-path and integrity checks still apply.
func DevelopmentDocument(name string) bool {
	if _, ok := development.Templates[name]; ok {
		return true
	}
	for _, file := range development.Documents {
		if name == file {
			return true
		}
	}
	return false
}

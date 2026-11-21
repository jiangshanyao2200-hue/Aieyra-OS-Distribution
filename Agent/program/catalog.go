// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Agent/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: Definition; catalog; Catalog; Find
// Impact: python -B scripts/code-atlas.py show Agent/program/catalog.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Package program declares the default identities carried by OS programs.
// It contains no model choices or private state; Core owns each installed binding.
package program

import (
	_ "embed"
	"encoding/json"
	"slices"
)

type Definition struct {
	ID                  string   `json:"id"`
	Name                string   `json:"name"`
	Description         string   `json:"description"`
	PreviousName        string   `json:"previous_name,omitempty"`
	PreviousDescription string   `json:"previous_description,omitempty"`
	Tools               []string `json:"tools"`
	Prompt              string   `json:"prompt"`
	Standalone          bool     `json:"standalone,omitempty"`
}

//go:embed catalog.json
var catalog []byte

func Catalog() []Definition {
	var rows []Definition
	if err := json.Unmarshal(catalog, &rows); err != nil {
		panic(err)
	}
	return rows
}

func Find(id string) (Definition, bool) {
	for _, row := range Catalog() {
		if row.ID == id {
			row.Tools = slices.Clone(row.Tools)
			return row, true
		}
	}
	return Definition{}, false
}

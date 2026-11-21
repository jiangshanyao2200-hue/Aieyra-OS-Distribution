// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Program/contract/AGENTS.md | ring 1
// Chains: program
// Regions: Operation; Desktop; Navigation; Definition; Decode
// Impact: python -B scripts/code-atlas.py show Program/contract/definition.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Package contract describes programs independently of a client or installer.
package contract

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"regexp"
	"strings"
)

type Operation struct {
	ID          string `json:"id"`
	Description string `json:"description"`
}
type Desktop struct {
	Entry      string      `json:"entry"`
	Native     string      `json:"native,omitempty"`
	Navigation *Navigation `json:"navigation,omitempty"`
}
type Navigation struct {
	Order      int    `json:"order"`
	Tab        string `json:"tab"`
	Host       string `json:"host"`
	Background string `json:"background,omitempty"`
}
type Definition struct {
	Schema     string      `json:"schema"`
	Mode       string      `json:"mode"`
	Desktop    Desktop     `json:"desktop"`
	Operations []Operation `json:"operations"`
}

func Decode(raw []byte, files map[string]bool) (Definition, error) {
	var p Definition
	if len(raw) > 65536 {
		return p, fmt.Errorf("program definition exceeds 64 KiB")
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if err := d.Decode(&p); err != nil {
		return p, err
	}
	if d.Decode(new(any)) != io.EOF {
		return p, fmt.Errorf("program definition has trailing content")
	}
	if p.Schema != "aieyra.program/1" || p.Mode != "observed" && p.Mode != "collaborative" && p.Mode != "human" {
		return p, fmt.Errorf("program schema or use mode is unsupported")
	}
	process := p.Desktop.Native != "" && p.Desktop.Navigation != nil && p.Desktop.Navigation.Host == "process"
	suffix := ".html"
	if process {
		suffix = ".mjs"
	}
	if !strings.HasSuffix(p.Desktop.Entry, suffix) || !files[p.Desktop.Entry] {
		return p, fmt.Errorf("program desktop entry is missing or unsupported")
	}
	if p.Desktop.Native != "" {
		if !regexp.MustCompile(`^[a-z][a-z0-9_-]{0,47}$`).MatchString(p.Desktop.Native) || p.Desktop.Navigation == nil {
			return p, fmt.Errorf("native program requires a host adapter and navigation")
		}
		n := p.Desktop.Navigation
		if n.Order < 0 || n.Order > 64 || !regexp.MustCompile(`^[a-z][a-z0-9_-]{0,63}$`).MatchString(n.Tab) || n.Host != "surface" && n.Host != "browser" && n.Host != "process" || n.Background != "" && n.Background != "sleep" {
			return p, fmt.Errorf("invalid native program navigation")
		}
	} else if p.Desktop.Navigation != nil {
		return p, fmt.Errorf("native navigation requires a host adapter")
	}
	if len(p.Operations) > 64 || p.Mode == "human" && len(p.Operations) > 0 || p.Mode != "human" && len(p.Operations) == 0 {
		return p, fmt.Errorf("program operation list does not match its use mode")
	}
	seen := map[string]bool{}
	pattern := regexp.MustCompile(`^[a-z][a-z0-9_.-]{0,63}$`)
	for _, op := range p.Operations {
		if !pattern.MatchString(op.ID) || op.ID == "snapshot" || seen[op.ID] || op.Description == "" || len(op.Description) > 2048 {
			return p, fmt.Errorf("program operation is invalid or duplicated")
		}
		seen[op.ID] = true
	}
	return p, nil
}

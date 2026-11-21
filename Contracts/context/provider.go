// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Contracts/context/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: Version; Reference; idPattern; versionPattern; Validate; Namespace; State; Validate; Digest
// Impact: python -B scripts/code-atlas.py show Contracts/context/provider.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Package context defines portable provider identity and private state envelopes.
// It grants no access to a session, filesystem, model or memory service.
package context

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"regexp"
)

const Version = 1

type Reference struct {
	ID          string `json:"id"`
	Version     string `json:"version"`
	StateSchema int    `json:"state_schema"`
	Digest      string `json:"digest,omitempty"`
}

var idPattern = regexp.MustCompile(`^[a-z][a-z0-9_.-]{0,95}$`)
var versionPattern = regexp.MustCompile(`^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$`)

func (r Reference) Validate() error {
	if !idPattern.MatchString(r.ID) || !versionPattern.MatchString(r.Version) || r.StateSchema < 1 {
		return fmt.Errorf("invalid context provider reference")
	}
	if r.Digest != "" && !regexp.MustCompile(`^[a-f0-9]{64}$`).MatchString(r.Digest) {
		return fmt.Errorf("invalid context package digest")
	}
	return nil
}

type Namespace struct {
	Schema int             `json:"schema"`
	Data   json.RawMessage `json:"data"`
}

// Inactive namespaces remain available for rollback. Providers may read only
// their own namespace; they never discard another provider's private state.
type State struct {
	Schema     int                  `json:"schema"`
	Provider   Reference            `json:"provider"`
	Session    string               `json:"session"`
	Namespaces map[string]Namespace `json:"namespaces,omitempty"`
}

func (s State) Validate() error {
	if s.Schema != Version || s.Session == "" || len(s.Session) > 256 || len(s.Namespaces) > 32 {
		return fmt.Errorf("invalid context state scope or schema")
	}
	if err := s.Provider.Validate(); err != nil {
		return err
	}
	for key, ns := range s.Namespaces {
		if !idPattern.MatchString(key) || ns.Schema < 1 || len(ns.Data) > 1<<20 || !json.Valid(ns.Data) {
			return fmt.Errorf("invalid context namespace %s", key)
		}
	}
	return nil
}

func Digest(value any) string {
	b, err := json.Marshal(value)
	if err != nil {
		return ""
	}
	return fmt.Sprintf("%x", sha256.Sum256(b))
}

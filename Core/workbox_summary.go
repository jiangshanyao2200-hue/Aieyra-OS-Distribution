// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: workboxSummary; summary
// Impact: python -B scripts/code-atlas.py show Core/workbox_summary.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import "github.com/aieyra/aieyra-os/CORE/sessionservice"

// Lists never send plans, inputs or step output. Full receipts are read only
// for the selected instance; no second index can get ahead of a durable commit.
type workboxSummary struct {
	Schema   string `json:"schema"`
	ID       string `json:"id"`
	Owner    string `json:"owner"`
	Package  string `json:"package"`
	Title    string `json:"title"`
	State    string `json:"state"`
	Revision uint64 `json:"revision"`
	Created  string `json:"created"`
	Updated  string `json:"updated"`
	AgentID  string `json:"agent_id,omitempty"`
}

func (s workboxStore) summary() (workboxSummary, error) {
	type summaryDocument struct {
		Instance workboxSummary `json:"instance"`
	}
	doc, err := sessionservice.ReadRecord(s.recordFile(), func(d summaryDocument) error {
		return s.validateIdentity(d.Instance.Schema, d.Instance.ID, d.Instance.Owner)
	})
	return doc.Instance, err
}

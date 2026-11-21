// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Agent/contract/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: AgentContract; AgentArtifact; AgentDelivery; AgentReceiptRef; AgentCriterionCheck; AgentReview; AgentOutcome; CloneContract
// Impact: python -B scripts/code-atlas.py show Agent/contract/delivery.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package contract

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
)

// Contracts name obligations, not a promise that the framework proves semantics.
type AgentContract struct {
	Acceptance   []string `json:"acceptance"`
	Deliverables []string `json:"deliverables,omitempty"`
	Constraints  []string `json:"constraints,omitempty"`
}
type AgentArtifact struct {
	Path   string `json:"path"`
	SHA256 string `json:"sha256,omitempty"`
	Bytes  int64  `json:"bytes"`
	Error  string `json:"error,omitempty"`
}
type AgentDelivery struct {
	Generation int             `json:"generation"`
	CapturedAt string          `json:"captured_at"`
	Artifacts  []AgentArtifact `json:"artifacts"`
}
type AgentReceiptRef struct {
	AgentID      string `json:"agent_id,omitempty"`
	SessionID    int    `json:"session_id"`
	ExpectedExit int    `json:"expected_exit"`
}
type AgentCriterionCheck struct {
	Criterion int               `json:"criterion"`
	Verdict   string            `json:"verdict"`
	Evidence  string            `json:"evidence"`
	Receipts  []AgentReceiptRef `json:"receipts"`
}
type AgentReview struct {
	RequestID  string                `json:"request_id"`
	Generation int                   `json:"generation"`
	Verdict    string                `json:"verdict"`
	Evidence   string                `json:"evidence"`
	Checks     []AgentCriterionCheck `json:"checks,omitempty"`
	Created    string                `json:"created_at"`
}
type AgentOutcome struct {
	SubmittedAt string         `json:"submitted_at,omitempty"`
	CompletedAt string         `json:"completed_at,omitempty"`
	RunTime     *AgentRunTime  `json:"run_time,omitempty"`
	Generation  int            `json:"generation"`
	State       string         `json:"state"`
	Result      string         `json:"result,omitempty"`
	Error       string         `json:"error,omitempty"`
	Acceptance  string         `json:"acceptance"`
	Evidence    string         `json:"evidence,omitempty"`
	Delivery    *AgentDelivery `json:"delivery,omitempty"`
}

// CloneContract validates and returns an independent normalized contract.
func CloneContract(contract *AgentContract) (*AgentContract, error) {
	if contract == nil {
		return nil, nil
	}
	data, _ := json.Marshal(contract)
	if len(data) > 32<<10 || len(contract.Acceptance) < 1 || len(contract.Acceptance) > 24 || len(contract.Deliverables) > 32 || len(contract.Constraints) > 24 {
		return nil, fmt.Errorf("contract requires 1..24 acceptance criteria, at most32 deliverables,24 constraints and32 KiB total")
	}
	var c AgentContract
	_ = json.Unmarshal(data, &c)
	for _, list := range [][]string{c.Acceptance, c.Constraints} {
		for i, text := range list {
			if strings.TrimSpace(text) == "" || len(text) > 2048 {
				return nil, fmt.Errorf("empty or oversized contract criterion")
			}
			list[i] = strings.TrimSpace(text)
		}
	}
	seen := map[string]bool{}
	for i, p := range c.Deliverables {
		// Disallow platform aliases and NTFS alternate streams as well as traversal.
		if p == "" || len(p) > 500 || strings.ContainsAny(p, ":\x00") || filepath.IsAbs(p) || strings.HasPrefix(p, "\\") || strings.HasPrefix(p, "/") {
			return nil, fmt.Errorf("deliverables must be relative files inside workdir")
		}
		p = filepath.Clean(strings.ReplaceAll(p, "\\", "/"))
		if p == "." || p == ".." || strings.HasPrefix(p, ".."+string(filepath.Separator)) {
			return nil, fmt.Errorf("deliverable escapes workdir")
		}
		key := strings.ToLower(p)
		if seen[key] {
			return nil, fmt.Errorf("duplicate deliverable")
		}
		seen[key] = true
		c.Deliverables[i] = filepath.ToSlash(p)
	}
	return &c, nil
}

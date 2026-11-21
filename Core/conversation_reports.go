// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: conversationReportScope; conversationReports; conversationDocument
// Impact: python -B scripts/code-atlas.py show Core/conversation_reports.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

// Reuse report storage, revisions and rendering handles, with the persistent
// conversation as owner. A project artifact is never promoted to a report.
func (m *AgentManager) conversationReportScope(id string) (*Workspace, error) {
	r, _, err := m.receiptRecord(id)
	if err != nil || r.Spec.Kind != "conversation" {
		return nil, fmt.Errorf("报告会话不可用")
	}
	return &Workspace{privateAgentScope: true, config: m.config, dir: filepath.Join(m.dir, "reports", id), manager: m,
		state: workspaceState{ID: id, Roles: map[string]string{WorkspaceMatrix: id}}}, nil
}

func (m *AgentManager) conversationReports(id string) ([]WorkspaceDocument, error) {
	w, err := m.conversationReportScope(id)
	if err != nil {
		return nil, err
	}
	if _, err = os.Stat(w.reportDirectory()); os.IsNotExist(err) {
		return []WorkspaceDocument{}, nil
	} else if err != nil {
		return nil, err
	}
	if err = w.refreshReportsLocked(); err != nil {
		return nil, err
	}
	return w.state.Documents, nil
}

func (m *AgentManager) conversationDocument(id string, raw json.RawMessage) (any, error) {
	var p struct {
		Action           string  `json:"action"`
		DocumentID       string  `json:"document_id"`
		Operation        string  `json:"operation"`
		ExpectedRevision *uint64 `json:"expected_revision"`
	}
	if err := json.Unmarshal(raw, &p); err != nil {
		return nil, err
	}
	w, err := m.conversationReportScope(id)
	if err != nil {
		return nil, err
	}
	if !sessionIDPattern.MatchString(p.DocumentID) {
		return nil, fmt.Errorf("报告编号无效")
	}
	if p.Action == "document_read" {
		return w.readDocument(p.DocumentID)
	}
	if p.Operation != "read" && p.Operation != "close" {
		return nil, fmt.Errorf("报告状态操作无效")
	}
	return w.documentState(rawJSON(map[string]any{"id": p.DocumentID, "action": p.Operation, "expected_revision": p.ExpectedRevision}))
}

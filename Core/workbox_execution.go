// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: executionByKey; stopExecutionKey
// Impact: python -B scripts/code-atlas.py show Core/workbox_execution.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

// Workflows inspect the complete saved execution output without consuming the
// interactive wait cursor. The private shell provides the ownership boundary.
func (m *ShellManager) executionByKey(key string) (ExecResult, bool) {
	r := m.execution
	if r == nil {
		return ExecResult{}, false
	}
	r.mu.Lock()
	var cell *executionCell
	for _, c := range r.cells {
		if c.key == key {
			cell = c
			break
		}
	}
	r.mu.Unlock()
	if cell == nil {
		return ExecResult{}, false
	}
	cell.mu.Lock()
	defer cell.mu.Unlock()
	return ExecResult{OK: cell.error == nil, State: cell.state, CellID: cell.id, Description: cell.description, Error: cell.error, Records: append([]NestedToolRecord(nil), cell.records...), Output: append([]ExecOutput(nil), cell.outputs...)}, true
}
func (m *ShellManager) stopExecutionKey(key string) {
	r := m.execution
	if r == nil {
		return
	}
	r.mu.Lock()
	var cell *executionCell
	for _, c := range r.cells {
		if c.key == key {
			cell = c
			break
		}
	}
	r.mu.Unlock()
	if cell != nil {
		cell.stop()
	}
}

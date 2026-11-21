// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: newPrivateShellManager; shellForRun
// Impact: python -B scripts/code-atlas.py show Core/matrix_shell.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"path/filepath"

	"github.com/aieyra/aieyra-os/contracts/storage"
)

func newPrivateShellManager(config, root, dir string) (*ShellManager, error) {
	shell, err := NewShellManager(storage.Relocate(config, root), dir)
	if shell != nil {
		shell.config = config
	}
	if err == nil {
		shell.relocate = func(value string) string { return storage.Relocate(config, value) }
	}
	return shell, err
}

// One runtime owns each agent's processes for the life of the manager. A new
// model turn changes only the generation stamped on newly started processes;
// existing sessions never migrate their identity or replay after a restart.
func (m *AgentManager) shellForRun(job *agentJob, record AgentRecord) (*ShellManager, error) {
	m.mu.Lock()
	shell := job.shell
	m.mu.Unlock()
	if shell == nil {
		var err error
		shell, err = newPrivateShellManager(m.config, record.Spec.Workdir, filepath.Join(m.dir, record.ID+".shell"))
		if err != nil {
			return nil, err
		}
		m.mu.Lock()
		if err = m.ctx.Err(); err != nil {
			m.mu.Unlock()
			shell.Close()
			return nil, err
		}
		job.shell = shell
		m.mu.Unlock()
	}
	shell.mu.Lock()
	shell.generation = record.Generation
	shell.mu.Unlock()
	return shell, nil
}

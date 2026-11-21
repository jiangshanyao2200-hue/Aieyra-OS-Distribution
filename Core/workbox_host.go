// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: openWorkboxHost; ensureWorkboxHost; primaryWorkflowActor; workflowSupervisorKey; workflowTarget; taskManager
// Impact: python -B scripts/code-atlas.py show Core/workbox_host.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
)

// Primary windows are ephemeral. Workflow instances and specialists use a
// durable service identity with the existing AgentManager and kernel lease.
// Acquisition is lazy: opening an unrelated OS/CLI window must not reserve it.
func (w *Workspace) openWorkboxHost() error {
	_, err := w.manager.ensureWorkboxHost(true)
	return err
}
func (m *AgentManager) ensureWorkboxHost(required bool) (*AgentManager, error) {
	if service := m.workboxHost.Load(); service != nil {
		return service, nil
	}
	if m.workboxService || m.workspace == nil || !m.workspace.Mode().unified() || m.workspace.split != nil {
		return nil, nil
	}
	m.workboxInitMu.Lock()
	defer m.workboxInitMu.Unlock()
	if service := m.workboxHost.Load(); service != nil {
		return service, nil
	}
	if m.ctx.Err() != nil {
		return nil, fmt.Errorf("workflow host is closed")
	}
	if m.admissionFrozen() {
		return nil, fmt.Errorf("更新交接中，工作流服务暂不新建")
	}
	dir := filepath.Join(PrivatePaths(m.config).Workflows, "agents")
	if !required {
		if _, err := os.Stat(dir); os.IsNotExist(err) {
			return nil, nil
		} else if err != nil {
			return nil, err
		}
	}
	owner := workflowHash("aieyra.primary-workflows/1")[:32]
	service, err := newAgentManager(m.config, owner, m.service, dir)
	if err != nil {
		return nil, fmt.Errorf("workflow service is unavailable; its existing owner and records are retained: %w", err)
	}
	service.workspace = m.workspace
	service.workboxService = true
	service.workboxAgents = func() (*AgentManager, error) { return m.ensurePackageAgentHost(true) }
	service.taskWindow = func(string, string) error { return nil }
	service.taskWindowHide = func(string) error { return nil }
	m.workboxHost.Store(service)
	return service, nil
}

// Sibling/helpers cannot acquire the primary user's workflow authority just
// by knowing an ID. Specialists continue to use their exact bound instance.
func (m *AgentManager) primaryWorkflowActor(actor string) bool {
	if m.workboxService || m.workspace == nil || !m.workspace.Mode().unified() || m.workspace.split != nil {
		return false
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	j := m.jobs[actor]
	return actor == m.owner || j != nil && j.record.Spec.WorkspaceRole == WorkspaceMatrix
}

type workflowSupervisorKey struct{}

func (m *AgentManager) workflowTarget(ctx context.Context, actor string) (*AgentManager, string, context.Context, error) {
	if !m.primaryWorkflowActor(actor) {
		return m, actor, ctx, nil
	}
	allowed := m.workflowAgentAuthority(ctx, actor)
	next, err := m.ensureWorkboxHost(true)
	if err != nil {
		return nil, "", ctx, err
	}
	// Preserve the first authoritative route through native capability checks
	// and the service call. A later call must not refresh a stopped admission.
	if prior, ok := ctx.Value(workflowRouteAdmissionKey{}).(workflowRouteAdmission); !ok || prior.manager != next {
		next.mu.Lock()
		admission := workflowRouteAdmission{manager: next, generation: next.workflowStop}
		next.mu.Unlock()
		ctx = context.WithValue(ctx, workflowRouteAdmissionKey{}, admission)
	}
	ctx = context.WithValue(ctx, workflowSupervisorKey{}, allowed)
	return next, next.owner, WithAgentManager(ctx, next, next.owner, nil), nil
}

// Existing task APIs and desktop views observe the same specialist executor.
func (m *AgentManager) taskManager(owner, id string) (*AgentManager, string) {
	if !m.primaryWorkflowActor(owner) {
		return m, owner
	}
	for _, next := range []*AgentManager{m.workboxHost.Load(), m.packageHost.Load()} {
		if next == nil {
			continue
		}
		next.mu.Lock()
		actor := next.owner
		if next.packageService && owner != m.owner {
			actor = "primary"
		}
		owned := next.ownsLocked(actor, id)
		next.mu.Unlock()
		if owned {
			return next, actor
		}
	}
	return m, owner
}

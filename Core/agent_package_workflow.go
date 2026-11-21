// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: packageWorkflowBindingKey; packageWorkflowRunnerKey; packageWorkflowRunner; validateWorkflowBinding; admitBoundWorkflowTurn; createWorkflowPackageAgent; workflow; register; cancelWorkflowSpecialist
// Impact: python -B scripts/code-atlas.py show Core/agent_package_workflow.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"

	agent "github.com/aieyra/aieyra-os/agent/contract"
	tool "github.com/aieyra/aieyra-os/tool/contract"
	"github.com/aieyra/aieyra-os/tool/workbox"
)

type packageWorkflowBindingKey struct{}
type packageWorkflowRunnerKey struct{}
type packageWorkflowRunner struct {
	manager *AgentManager
	actor   string
}

func validateWorkflowBinding(i *agent.Instance) error {
	b := i.Workflow
	if b == nil {
		return nil
	}
	if !validWorkflowID(b.ID) || !sessionIDPattern.MatchString(b.Owner) || !tool.ValidPackageID(b.Package) || b.AgentPackage != i.Current.Package || i.Current.Definition.Runtime == nil || i.Current.Definition.Runtime.WorkflowPort != workbox.Schema || !slices.Contains([]string{"task", "retained"}, b.Retention) {
		return fmt.Errorf("invalid or changed private workflow binding")
	}
	return nil
}

// Called under the package manager's admission lock. Reading the durable
// workflow does not acquire another manager or create a second executor.
func (m *AgentManager) admitBoundWorkflowTurn(r AgentRecord) error {
	b := r.Instance.Workflow
	store, err := m.workflowStore(b.Owner, b.ID)
	if err != nil {
		return err
	}
	d, err := store.read()
	if err != nil {
		return err
	}
	name, digest, _ := tool.ParsePackageID(b.AgentPackage)
	template := d.Instance.Definition.AgentTemplate
	if d.Instance.AgentID != r.ID || d.Instance.Package != b.Package || d.Instance.Owner != b.Owner || template == nil || template.Package != name || template.Retention != b.Retention || d.Instance.Dependencies[name] != digest {
		return fmt.Errorf("workflow specialist link is missing; inspect the original creation receipt")
	}
	if b.Retention == "task" && (d.Instance.State == "completed" || d.Instance.State == "cancelled") {
		return fmt.Errorf("task specialist's workflow is finished; existing receipts remain readable")
	}
	return nil
}

// Linking an idle instance is replay-safe even if committing the workflow's
// link fails. A retry finds the same creation receipt before resolving mutable
// defaults, and no model can run until the durable reverse link exists.
func (m *AgentManager) createWorkflowPackageAgent(ctx context.Context, d *workboxDocument, model string) (AgentRecord, error) {
	i, template := d.Instance, d.Instance.Definition.AgentTemplate
	if m.workboxAgents == nil || !m.workboxService || i.Owner != m.owner {
		return AgentRecord{}, fmt.Errorf("standard workflow specialists require the persistent primary Agent service")
	}
	if !toolAllowed(ctx, "software_api") {
		return AgentRecord{}, fmt.Errorf("workflow specialist requires the supervisor's software_api capability")
	}
	manager, err := m.workboxAgents()
	if err != nil {
		return AgentRecord{}, err
	}
	if manager == nil {
		return AgentRecord{}, fmt.Errorf("standard Agent service unavailable")
	}
	identity := "mod:" + template.Package + "@" + i.Dependencies[template.Package]
	binding := &agent.WorkflowBinding{ID: i.ID, Owner: i.Owner, Package: i.Package, AgentPackage: identity, Retention: template.Retention}
	request := "workbox-agent-" + i.ID
	accepted := false
	manager.mu.Lock()
	for _, j := range manager.jobs {
		if j.record.Parent == manager.owner && j.record.Spec.RequestID == "managed-"+workflowHash("primary\x00"+request) && j.record.Instance != nil {
			accepted = true
			break
		}
	}
	manager.mu.Unlock()
	if !accepted {
		if err := m.workflowAdmit(ctx, i); err != nil {
			return AgentRecord{}, err
		}
	}
	ctx = context.WithValue(ctx, packageWorkflowBindingKey{}, binding)
	return manager.createSupervisedPackageAgent(ctx, identity, request, model, d.Workdir, "", "primary", "workbox-"+i.ID)
}

// The public port has no owner/package selector. Its private binding is
// checked against both persisted sides before narrowing authority to exactly
// one accepted workflow. A specialist cannot approve its own checkpoint.
func (r packageRuntimeContext) workflow(ctx context.Context, operation string, raw json.RawMessage) (json.RawMessage, error) {
	i := r.record.Instance
	if i == nil || i.Workflow == nil || r.manager.packageWorkbox == nil {
		return nil, fmt.Errorf("this Agent has no bound workflow port")
	}
	if err := validateWorkflowBinding(i); err != nil {
		return nil, err
	}
	if !slices.Contains([]string{"status", "run", "pause", "resume", "cancel", "recover"}, operation) {
		return nil, fmt.Errorf("specialist may inspect and operate its workflow but cannot create or approve work")
	}
	a, err := workbox.DecodeRequest(raw)
	if err != nil {
		return nil, err
	}
	b := i.Workflow
	if a.Action != "" && a.Action != operation || a.ID != "" && a.ID != b.ID || a.ModelID != "" || a.Workdir != "" || a.Input != nil || a.Step != "" {
		return nil, fmt.Errorf("workflow operation cannot change its accepted binding or input")
	}
	a.Action, a.ID = operation, b.ID
	if operation != "status" {
		if a.RequestID == "" || len(a.RequestID) > 128 {
			return nil, fmt.Errorf("workflow operation requires a bounded stable request_id")
		}
		a.RequestID = "agent-" + workflowHash(r.record.ID+"\x00"+a.RequestID)
	}
	service, err := r.manager.packageWorkbox()
	if err != nil {
		return nil, err
	}
	if service == nil || service.owner != b.Owner {
		return nil, fmt.Errorf("bound workflow service unavailable")
	}
	store, err := service.workflowStore(b.Owner, b.ID)
	if err != nil {
		return nil, err
	}
	d, err := store.read()
	if err != nil {
		return nil, err
	}
	name, digest, _ := tool.ParsePackageID(i.Current.Package)
	template := d.Instance.Definition.AgentTemplate
	if d.Instance.AgentID != r.record.ID || d.Instance.Package != b.Package || d.Instance.Owner != b.Owner || d.Instance.Dependencies[name] != digest || template == nil || template.Package != name || template.Retention != b.Retention {
		return nil, fmt.Errorf("workflow and Agent no longer share the accepted binding")
	}
	ctx = WithToolPermissions(ctx, workflowCapabilities(b.Package, d.Instance.Tools))
	ctx = context.WithValue(ctx, packageWorkflowRunnerKey{}, packageWorkflowRunner{r.manager, r.record.ID})
	result, err := service.workflowCall(ctx, b.Owner, b.Package, rawJSON(a))
	return rawJSON(map[string]any{"ok": err == nil, "instance": result}), err
}

func (r packageWorkflowRunner) register(ctx context.Context, key string, stop context.CancelFunc) error {
	r.manager.mu.Lock()
	defer r.manager.mu.Unlock()
	j := r.manager.jobs[r.actor]
	if ctx.Err() != nil || r.manager.ctx.Err() != nil || j == nil || !activeAgent(j.record.State) || j.record.State == "cancelling" || j.finishing {
		return fmt.Errorf("specialist stopped before workflow runner admission")
	}
	r.manager.workflowRuns.Store(key, workflowRunControl{actor: r.actor, cancel: stop})
	return nil
}

func (m *AgentManager) cancelWorkflowSpecialist(i workbox.Instance) error {
	if i.AgentID == "" || i.Definition.AgentTemplate == nil || i.Definition.AgentTemplate.Package == "" || m.workboxAgents == nil {
		return nil
	}
	manager, err := m.workboxAgents()
	if err != nil {
		return err
	}
	if manager == nil {
		return fmt.Errorf("bound Agent service unavailable")
	}
	manager.mu.Lock()
	defer manager.mu.Unlock()
	j := manager.jobs[i.AgentID]
	if j == nil || j.record.Instance == nil || j.record.Instance.Workflow == nil {
		return fmt.Errorf("bound specialist unavailable; original workflow retained")
	}
	b := j.record.Instance.Workflow
	if b.ID != i.ID || b.Owner != i.Owner || b.Package != i.Package {
		return fmt.Errorf("specialist binding changed")
	}
	if activeAgent(j.record.State) {
		return manager.cancelJobLocked(j)
	}
	manager.cancelWorkflowRunsLocked(j.record.ID)
	return nil
}

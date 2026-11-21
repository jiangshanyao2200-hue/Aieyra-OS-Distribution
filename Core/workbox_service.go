// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: workflowAgentKey; workflowRunControl; workflowRouteAdmissionKey; workflowRouteAdmission; cancelWorkflowRunsLocked; workflowAgentAuthority; workflowOwner; workflowCall; workflowRejectAdmission; workflowCommand; workflowCommit; workflowCreate; workflowCreateAgent
// Impact: python -B scripts/code-atlas.py show Core/workbox_service.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/aieyra/aieyra-os/contracts/storage"
	"github.com/aieyra/aieyra-os/tool/workbox"
)

type workflowAgentKey struct{}
type workflowRunControl struct {
	actor  string
	cancel context.CancelFunc
}
type workflowRouteAdmissionKey struct{}
type workflowRouteAdmission struct {
	manager    *AgentManager
	generation uint64
}

// Called while holding the AgentManager lock by its existing cancellation
// paths. Stopping a specialist or its parent also stops owned workflow work.
func (m *AgentManager) cancelWorkflowRunsLocked(actor string) {
	if generation, ok := m.workflowAdmissions[actor]; ok {
		m.workflowAdmissions[actor] = generation + 1
	}
	if next := m.packageHost.Load(); next != nil {
		if j := m.jobs[actor]; actor == m.owner || j != nil && j.record.Spec.WorkspaceRole == WorkspaceMatrix {
			next.mu.Lock()
			for _, child := range next.jobs {
				if i := child.record.Instance; i != nil && i.Workflow != nil && i.Supervisor == "primary" {
					if activeAgent(child.record.State) {
						_ = next.cancelJobLocked(child)
					} else {
						next.cancelWorkflowRunsLocked(child.record.ID)
					}
				}
			}
			next.mu.Unlock()
		}
	}
	if next := m.workboxHost.Load(); next != nil {
		// The primary supervisor owns this service. Cancellation reaches its
		// live specialists as well as work started directly from the workflow UI.
		if j := m.jobs[actor]; actor == m.owner || j != nil && j.record.Spec.WorkspaceRole == WorkspaceMatrix {
			next.mu.Lock()
			// Stop and admission use the same lock. Pending native RPCs do not
			// share the parent's context, so invalidate their captured generations.
			next.workflowStop++
			for _, child := range next.jobs {
				if activeAgent(child.record.State) {
					_ = next.cancelJobLocked(child)
				}
			}
			next.workflowRuns.Range(func(_, value any) bool { value.(workflowRunControl).cancel(); return true })
			next.mu.Unlock()
		}
	}
	m.workflowRuns.Range(func(_, value any) bool {
		c := value.(workflowRunControl)
		if c.actor == actor {
			c.cancel()
		}
		return true
	})
}

func (m *AgentManager) workflowAgentAuthority(ctx context.Context, actor string) bool {
	if allowed, _ := ctx.Value(workflowSupervisorKey{}).(bool); allowed {
		return true
	}
	if toolAllowed(ctx, "agents") {
		return true
	}
	c, ok := ctx.Value(workspaceContextKey{}).(workspaceContext)
	if !ok || c.workspace == nil || c.workspace.manager != m || c.role != WorkspaceMatrix || !CurrentReleaseStage().TeamCollaboration {
		return false
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	j := m.jobs[actor]
	return j != nil && j.record.Spec.WorkspaceRole == WorkspaceMatrix && activeAgent(j.record.State)
}

func (m *AgentManager) workflowOwner(actor, identity, id string) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if j := m.jobs[actor]; j != nil && j.record.Spec.WorkflowID != "" {
		if j.record.Spec.WorkflowID != id || j.record.Spec.WorkflowPackage != identity {
			return "", fmt.Errorf("specialist is bound to another workflow")
		}
		return j.record.Parent, nil
	}
	return actor, nil
}

func (m *AgentManager) workflowCall(ctx context.Context, actor, identity string, raw json.RawMessage) (workbox.Instance, error) {
	if next, owner, nextCtx, err := m.workflowTarget(ctx, actor); err != nil {
		return workbox.Instance{}, err
	} else if next != m {
		return next.workflowCall(nextCtx, owner, identity, raw)
	}
	var empty workbox.Instance
	a, err := workbox.DecodeRequest(raw)
	if err != nil {
		return empty, err
	}
	if !strings.Contains("|create|status|run|pause|resume|cancel|approve|recover|create_agent|", "|"+a.Action+"|") {
		return empty, fmt.Errorf("unknown workflow action")
	}
	if a.Action != "status" && (strings.TrimSpace(a.RequestID) == "" || len(a.RequestID) > 128) {
		return empty, fmt.Errorf("bounded request_id is required")
	}
	var admission, serviceStop uint64
	if a.Action == "run" || a.Action == "resume" {
		m.mu.Lock()
		if m.workflowAdmissions == nil {
			m.workflowAdmissions = map[string]uint64{}
		}
		admission = m.workflowAdmissions[actor]
		m.workflowAdmissions[actor] = admission
		serviceStop = m.workflowStop
		m.mu.Unlock()
		if route, ok := ctx.Value(workflowRouteAdmissionKey{}).(workflowRouteAdmission); ok && route.manager == m {
			serviceStop = route.generation
		}
	}
	if a.Action == "create" {
		if a.ID != "" {
			return empty, fmt.Errorf("create uses request_id, not an existing id")
		}
		a.ID = "w-" + workflowHash(actor + "\x00" + identity + "\x00" + a.RequestID)[:32]
	}
	owner, err := m.workflowOwner(actor, identity, a.ID)
	if err != nil {
		return empty, err
	}
	store, err := m.workflowStore(owner, a.ID)
	if err != nil {
		return empty, err
	}
	if a.Action == "create" {
		return m.workflowCreate(ctx, store, owner, identity, a)
	}
	d, err := store.read()
	if err != nil {
		return empty, err
	}
	if d.Instance.Owner != owner || d.Instance.Package != identity {
		return empty, fmt.Errorf("workflow owner or package mismatch")
	}
	if a.Action == "status" {
		return d.Instance, nil
	}
	if a.ExpectedRevision == nil {
		return d.Instance, fmt.Errorf("expected_revision is required")
	}
	signature := workflowHash(string(rawJSON(a)))
	// Retries return the latest snapshot without reacquiring a runner or replaying
	// approval/Agent creation, even after later revisions have been committed.
	if old, ok := d.Requests[a.RequestID]; ok {
		if old != signature {
			return d.Instance, fmt.Errorf("request_id conflict")
		}
		if a.Action == "cancel" {
			return d.Instance, m.cancelWorkflowSpecialist(d.Instance)
		}
		return d.Instance, nil
	}
	ctx = nativeWorkflowCapabilities(ctx, d.Instance)
	var lease *os.File
	if a.Action == "run" || a.Action == "resume" || a.Action == "recover" || a.Action == "create_agent" {
		lease, err = store.runnerLease(ctx)
		if err != nil {
			return d.Instance, err
		}
		defer func() {
			if lease != nil {
				lease.Close()
			}
		}()
	}
	if a.Action == "run" || a.Action == "resume" || a.Action == "approve" {
		if err = m.workflowAdmit(ctx, d.Instance); err != nil {
			return d.Instance, err
		}
	}
	if a.Action == "create_agent" {
		return m.workflowCreateAgent(ctx, store, actor, owner, a, signature)
	}
	if a.Action == "recover" {
		return m.workflowRecover(ctx, store, a, signature)
	}
	var cancelSnapshot *workbox.Instance
	var cancelRun context.CancelFunc
	result, err := store.update(ctx, func(d *workboxDocument) error {
		if err := workflowCommand(d, a, signature); err != nil {
			return err
		}
		i := &d.Instance
		switch a.Action {
		case "run", "resume":
			if i.State != "ready" && i.State != "paused" {
				return fmt.Errorf("workflow is %s; inspect or recover first", i.State)
			}
			i.State = "running"
			i.Error = ""
		case "pause":
			if i.State == "running" {
				i.State = "pause_requested"
			} else if i.State == "ready" {
				i.State = "paused"
			} else if i.State != "paused" && i.State != "pause_requested" {
				return fmt.Errorf("workflow cannot pause from %s", i.State)
			}
		case "cancel":
			if i.State == "completed" {
				return fmt.Errorf("completed workflow cannot be cancelled")
			}
			// Only a cancellation validated under the authoritative state lease
			// may stop work if saving fails. Retain the last committed snapshot.
			previous := *i
			cancelSnapshot = &previous
			if stop, ok := m.workflowRuns.Load(store.dir); ok {
				cancelRun = stop.(workflowRunControl).cancel
			}
			if i.State == "running" || i.State == "pause_requested" {
				i.State = "cancel_requested"
			} else {
				i.State = "cancelled"
			}
		case "approve":
			if actor != owner {
				return fmt.Errorf("review requires the workflow owner; a specialist cannot approve its own checkpoint")
			}
			if i.State != "awaiting_review" {
				return fmt.Errorf("workflow is not awaiting review")
			}
			found := false
			for n := range i.Steps {
				s := &i.Steps[n]
				if s.ID == a.Step && s.State == "awaiting_review" {
					s.State = "completed"
					s.Result = rawJSON(map[string]any{"approved": true, "by": actor})
					s.Completed = workflowNow()
					found = true
				}
			}
			if !found {
				return fmt.Errorf("review step identity does not match")
			}
			i.State = "paused"
		default:
			return fmt.Errorf("unsupported workflow mutation")
		}
		workflowCommit(d, a, signature)
		return nil
	})
	if cancelSnapshot != nil {
		// A later explicit recovery may register another runner after this
		// transaction releases its lease. Stop only the control admitted above.
		if cancelRun != nil {
			cancelRun()
		}
		stopErr := m.cancelWorkflowSpecialist(*cancelSnapshot)
		if err != nil {
			return *cancelSnapshot, fmt.Errorf("workflow stop requested but cancellation state was not saved; inspect original receipts before retrying: %w", errors.Join(err, stopErr))
		}
		if stopErr != nil {
			return result, stopErr
		}
	}
	if err != nil {
		return result, err
	}
	if a.Action == "run" || a.Action == "resume" {
		runCtx, stop := context.WithCancel(context.WithoutCancel(ctx))
		bound, hasBound := ctx.Value(packageWorkflowRunnerKey{}).(packageWorkflowRunner)
		if hasBound {
			if err := bound.register(ctx, store.dir, stop); err != nil {
				stop()
				return workflowRejectAdmission(store, result, a, signature, err)
			}
		}
		m.mu.Lock()
		admissionErr := ctx.Err()
		if admissionErr == nil && (admission != m.workflowAdmissions[actor] || serviceStop != m.workflowStop) {
			admissionErr = context.Canceled
		}
		if admissionErr != nil || m.ctx.Err() != nil {
			m.mu.Unlock()
			stop()
			if hasBound {
				bound.manager.workflowRuns.Delete(store.dir)
			}
			if admissionErr != nil {
				return workflowRejectAdmission(store, result, a, signature, fmt.Errorf("caller or workflow owner stopped before workflow runner admission: %w", admissionErr))
			}
			return workflowRejectAdmission(store, result, a, signature, fmt.Errorf("manager closed before workflow runner admission"))
		}
		stopManager := context.AfterFunc(m.ctx, stop)
		m.workflowRuns.Store(store.dir, workflowRunControl{actor: actor, cancel: stop})
		m.wg.Add(1)
		m.mu.Unlock()
		ownedLease := lease
		lease = nil
		go func() {
			defer m.wg.Done()
			defer ownedLease.Close()
			defer stop()
			defer stopManager()
			defer m.workflowRuns.Delete(store.dir)
			if hasBound {
				defer bound.manager.workflowRuns.Delete(store.dir)
			}
			m.workflowRun(runCtx, store)
		}()
	}
	return result, nil
}

// The caller still holds this run's kernel runner lease and has not started a
// runner. Settle only its exact committed admission; never overwrite a later
// pause/cancel revision or turn a failed write into a committed cancellation.
func workflowRejectAdmission(store workboxStore, accepted workbox.Instance, a workbox.Request, signature string, cause error) (workbox.Instance, error) {
	committed := accepted
	observed := false
	settled, err := store.update(context.Background(), func(d *workboxDocument) error {
		committed = d.Instance
		observed = true
		i := &d.Instance
		if i.ID != accepted.ID || i.Owner != accepted.Owner || i.Package != accepted.Package || i.Revision != accepted.Revision || i.State != "running" || d.Requests[a.RequestID] != signature {
			return fmt.Errorf("workflow changed after the rejected admission; inspect the current revision before recovery")
		}
		i.State = "cancelled"
		i.Error = "workflow runner admission stopped before execution"
		workflowTouch(i)
		return nil
	})
	if err != nil {
		if !observed {
			if latest, readErr := store.read(); readErr == nil {
				committed = latest.Instance
			} else {
				err = errors.Join(err, readErr)
			}
		}
		return committed, fmt.Errorf("workflow runner admission stopped but cancellation state was not saved; inspect original receipts before recovery: %w", errors.Join(cause, err))
	}
	return settled, cause
}

func workflowCommand(d *workboxDocument, a workbox.Request, signature string) error {
	if old, ok := d.Requests[a.RequestID]; ok {
		if old != signature {
			return fmt.Errorf("request_id conflict")
		}
		return fmt.Errorf("command already committed; read current status")
	}
	if a.ExpectedRevision == nil || *a.ExpectedRevision != d.Instance.Revision {
		return fmt.Errorf("workflow revision conflict; read current status")
	}
	if len(d.Requests) >= 2048 {
		return fmt.Errorf("workflow command journal is full; existing results retained")
	}
	return nil
}
func workflowCommit(d *workboxDocument, a workbox.Request, signature string) {
	d.Requests[a.RequestID] = signature
	d.Instance.Revision++
	d.Instance.Updated = workflowNow()
}

func (m *AgentManager) workflowCreate(ctx context.Context, store workboxStore, owner, identity string, a workbox.Request) (workbox.Instance, error) {
	var empty workbox.Instance
	lease, err := store.lock("state")
	if err != nil {
		return empty, err
	}
	defer lease.Close()
	creation := workflowHash(string(rawJSON(map[string]any{"input": a.Input, "workdir": a.Workdir, "package": identity})))
	if prior, e := store.read(); e == nil {
		if prior.Creation != creation {
			return prior.Instance, fmt.Errorf("request_id used with different workflow input")
		}
		return prior.Instance, nil
	} else if !errors.Is(e, os.ErrNotExist) {
		return empty, e
	}
	if !filepath.IsAbs(a.Workdir) {
		return empty, fmt.Errorf("workflow workdir must be absolute")
	}
	info, err := os.Stat(storage.Relocate(m.config, a.Workdir))
	if err != nil || !info.IsDir() {
		return empty, fmt.Errorf("workflow workdir must exist")
	}
	p, deps, tools, err := m.workflowPackage(ctx, identity)
	if err != nil {
		return empty, err
	}
	i, err := workbox.New(a.ID, owner, identity, p, a.Input, workflowNow())
	if err != nil {
		return empty, err
	}
	i.Dependencies, i.Tools = deps, tools
	ctx = nativeWorkflowCapabilities(ctx, i)
	if err = m.workflowAdmit(ctx, i); err != nil {
		return empty, err
	}
	doc := workboxDocument{Instance: i, Creation: creation, Workdir: filepath.Clean(a.Workdir), Requests: map[string]string{}}
	if err = store.write(doc); err != nil {
		return empty, err
	}
	return i, nil
}

func (m *AgentManager) workflowCreateAgent(ctx context.Context, store workboxStore, actor, owner string, a workbox.Request, signature string) (workbox.Instance, error) {
	return store.update(ctx, func(d *workboxDocument) error {
		if err := workflowCommand(d, a, signature); err != nil {
			return err
		}
		i := &d.Instance
		t := i.Definition.AgentTemplate
		if actor != owner || t == nil || !m.workflowAgentAuthority(ctx, actor) {
			return fmt.Errorf("specialist creation requires the owning Agent, template and agents permission")
		}
		if i.AgentID != "" {
			return fmt.Errorf("workflow already has a specialist")
		}
		if t.Package != "" {
			r, err := m.createWorkflowPackageAgent(ctx, d, a.ModelID)
			if err != nil {
				return err
			}
			i.AgentID = r.ID
			workflowCommit(d, a, signature)
			return nil
		}
		if err := m.workflowAdmit(ctx, *i); err != nil {
			return err
		}
		tools := workflowCapabilities(i.Package, i.Tools)
		// Only public template text, accepted input and the workflow identity are
		// handed over. Parent conversation, memory and private prompts are not copied.
		spec := AgentSpec{RequestID: "workbox-agent-" + i.ID, ModelID: a.ModelID, Title: t.Title, Task: "Manage workflow " + i.ID + " via toolbox " + i.Package + ". Read its saved input, inspect actual state and receipts, and wait at review checkpoints.", Prompt: t.Prompt + "\n" + workbox.CommandManual, Workdir: d.Workdir, Tools: tools, MaxTokens: t.MaxTokens, TimeoutSeconds: t.TimeoutSeconds, WorkflowID: i.ID, WorkflowPackage: i.Package, WorkflowRetention: t.Retention}
		r, err := m.Create(context.WithValue(ctx, workflowAgentKey{}, i.ID), owner, spec)
		if err != nil {
			return err
		}
		i.AgentID = r.ID
		workflowCommit(d, a, signature)
		return nil
	})
}

// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: workflowTouch; workflowRun; workflowExecute; workflowImageResult; workflowCellResult; workflowRecover
// Impact: python -B scripts/code-atlas.py show Core/workbox_runner.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	toolruntime "github.com/aieyra/aieyra-os/tool/runtime"
	"github.com/aieyra/aieyra-os/tool/workbox"
)

func workflowTouch(i *workbox.Instance) { i.Revision++; i.Updated = workflowNow() }

func (m *AgentManager) workflowRun(ctx context.Context, store workboxStore) {
	d, err := store.read()
	if err != nil {
		return
	}
	ctx = context.WithValue(ctx, imageGenTaskKey{}, d.Instance.ID)
	ctx = context.WithValue(ctx, imageUsageOwnerKey{}, "workflow:"+d.Instance.ID)
	// Accounting belongs to the workflow, which can outlive the caller's turn.
	ctx = context.WithValue(ctx, imageUsageWriterKey{}, func(u AgentUsage) error {
		if u.SourceID == "" {
			return fmt.Errorf("workflow usage requires an invocation identity")
		}
		_, err := store.update(context.Background(), func(d *workboxDocument) error {
			found := false
			for n := range d.Instance.Usage {
				if d.Instance.Usage[n].SourceID == u.SourceID {
					d.Instance.Usage[n] = u
					found = true
					break
				}
			}
			if !found {
				d.Instance.Usage = append(d.Instance.Usage, u)
			}
			workflowTouch(&d.Instance)
			return nil
		})
		return err
	})
	shell, err := newPrivateShellManager(m.config, d.Workdir, store.dir+"/execution")
	if err != nil {
		_, _ = store.update(context.Background(), func(d *workboxDocument) error {
			d.Instance.State = "blocked"
			d.Instance.Error = err.Error()
			workflowTouch(&d.Instance)
			return nil
		})
		return
	}
	defer shell.Close()
	for {
		index := -1
		var arguments json.RawMessage
		admitted, err := store.update(context.Background(), func(d *workboxDocument) error {
			i := &d.Instance
			if ctx.Err() != nil {
				i.State = "cancelled"
				workflowTouch(i)
				return nil
			}
			if i.State == "pause_requested" {
				i.State = "paused"
				workflowTouch(i)
				return nil
			}
			if i.State == "cancel_requested" {
				i.State = "cancelled"
				workflowTouch(i)
				return nil
			}
			if i.State != "running" {
				return nil
			}
			if err := m.workflowAdmit(ctx, *i); err != nil {
				i.State = "blocked"
				i.Error = err.Error()
				workflowTouch(i)
				return nil
			}
			n, err := i.Next()
			if err != nil {
				i.State = "blocked"
				i.Error = err.Error()
				workflowTouch(i)
				return nil
			}
			if n < 0 {
				if err = i.Finish(workflowNow()); err != nil {
					i.State = "failed"
					i.Error = err.Error()
					workflowTouch(i)
				}
				return nil
			}
			raw, skip, err := i.Prepare(n)
			if err != nil {
				i.State = "failed"
				i.Error = err.Error()
				workflowTouch(i)
				return nil
			}
			s := &i.Steps[n]
			if skip {
				s.State = "skipped"
				s.Completed = workflowNow()
				workflowTouch(i)
				return nil
			}
			if i.Definition.Steps[n].Kind == "checkpoint" {
				s.State = "awaiting_review"
				i.State = "awaiting_review"
				workflowTouch(i)
				return nil
			}
			s.State = "in_flight"
			s.Invocation = i.ID + "-" + s.ID
			s.Arguments = raw
			s.Attempts++
			s.Started = workflowNow()
			// The deterministic batch ID is committed before dispatch. Dynamic cells
			// are recovered by this invocation key in the workflow's private shell.
			if i.Tools[i.Definition.Steps[n].Tool].Identity == "image_gen" {
				s.Receipt = s.Invocation
			}
			index, arguments = n, raw
			workflowTouch(i)
			return nil
		})
		if err != nil {
			return
		}
		if index < 0 {
			if admitted.State == "running" {
				continue
			}
			return
		}
		s := admitted.Steps[index]
		result, state, receipt, detail := m.workflowExecute(ctx, shell, admitted, index, arguments)
		settled, saveErr := store.update(context.Background(), func(d *workboxDocument) error {
			i := &d.Instance
			current := &i.Steps[index]
			if current.Invocation != s.Invocation || current.State != "in_flight" {
				return fmt.Errorf("workflow dispatch identity changed")
			}
			current.Result, current.State, current.Receipt, current.Error = result, state, receipt, detail
			current.Completed = workflowNow()
			if state != "completed" {
				i.State = state
				i.Error = detail
			} else if i.State == "pause_requested" {
				i.State = "paused"
			} else if i.State == "cancel_requested" || ctx.Err() != nil {
				i.State = "cancelled"
			}
			workflowTouch(i)
			return nil
		})
		// Failure leaves the durable intent in place. Nothing is dispatched again;
		// recover inspects the existing batch/cell in its independent receipt store.
		if saveErr != nil || settled.State != "running" {
			return
		}
	}
}

func (m *AgentManager) workflowExecute(ctx context.Context, shell *ShellManager, i workbox.Instance, n int, args json.RawMessage) (json.RawMessage, string, string, string) {
	// Each step is a new invocation. A caller's previously accepted Toolbox
	// turn may outlive disable; it must not authorize later workflow steps.
	ctx = context.WithValue(ctx, officialToolAdmissionKey{}, struct{}{})
	ctx = withOfficialToolAdmission(WithAgentManager(ctx, m, m.owner, shell))
	step := i.Steps[n]
	ref := i.Tools[i.Definition.Steps[n].Tool]
	if ref.Identity == "image_gen" {
		var input map[string]any
		if json.Unmarshal(args, &input) != nil {
			return nil, "failed", step.Receipt, "image input must be an object"
		}
		if input["action"] != nil || input["request_id"] != nil || input["batch_id"] != nil {
			return nil, "failed", step.Receipt, "workflow owns image batch identity and lifecycle"
		}
		input["action"], input["request_id"] = "create", step.Invocation
		r, err := runImageGen(ctx, m.config, rawJSON(input))
		if err != nil {
			return rawJSON(r), "failed", step.Receipt, err.Error()
		}
		r, err = runImageGen(ctx, m.config, rawJSON(map[string]any{"action": "run", "batch_id": r.BatchID, "max_items": 20, "limit": 100}))
		// Large batches advance only prepared items in the same saved batch.
		for err == nil && r.Completed < r.Requested && r.State == "partial" {
			prior := r.Completed
			r, err = runImageGen(ctx, m.config, rawJSON(map[string]any{"action": "run", "batch_id": r.BatchID, "max_items": 20, "limit": 100}))
			if r.Completed == prior {
				break
			}
		}
		return workflowImageResult(r, err)
	}
	v, err := m.versionedTool(ctx, ref.Identity)
	if err != nil {
		return nil, "failed", "", err.Error()
	}
	source, err := toolruntime.JavaScript(v.CustomTool, args)
	if err != nil {
		return nil, "failed", "", err.Error()
	}
	yield := 1
	encoded := rawJSON(ExecRequest{Code: source, Description: i.Definition.Steps[n].Title, YieldTimeMS: &yield})
	r, _ := shell.execution.execute(WithToolPermissions(ctx, ref.Capabilities), ToolCall{ID: step.Invocation, Function: FunctionCall{Name: "exec", Arguments: string(encoded)}}, step.Invocation)
	if r.CellID == "" {
		detail := "tool dispatch failed"
		if r.Error != nil {
			detail = r.Error.Message
		}
		return rawJSON(r), "unknown", "", detail
	}
	for {
		snapshot, ok := shell.executionByKey(step.Invocation)
		if !ok {
			return nil, "unknown", r.CellID, "owned execution receipt unavailable"
		}
		if snapshot.State != "running" {
			return workflowCellResult(snapshot)
		}
		select {
		case <-ctx.Done():
			shell.stopExecutionKey(step.Invocation)
			return rawJSON(snapshot), "unknown", r.CellID, "execution cancelled; recover existing receipt before proceeding"
		case <-time.After(30 * time.Millisecond):
		}
	}
}

func workflowImageResult(r imageGenResult, err error) (json.RawMessage, string, string, string) {
	if r.State == "completed" && r.Completed == r.Requested && r.Requested > 0 {
		return rawJSON(r), "completed", r.BatchID, ""
	}
	detail := "image batch is " + r.State + "; inspect the original batch before proceeding"
	if err != nil {
		detail = err.Error()
	}
	state := "unknown"
	if r.State == "failed" || r.State == "rejected" {
		state = "failed"
	}
	return rawJSON(r), state, r.BatchID, detail
}
func workflowCellResult(r ExecResult) (json.RawMessage, string, string, string) {
	if r.OK && r.State == "completed" {
		// Bind to a single actual JSON output. Ambiguous multi-output tools expose
		// the complete receipt instead of guessing which text is their result.
		if len(r.Output) == 1 && r.Output[0].Type == "text" && json.Valid([]byte(r.Output[0].Text)) {
			return json.RawMessage(r.Output[0].Text), "completed", r.CellID, ""
		}
		return rawJSON(r), "completed", r.CellID, ""
	}
	state := "unknown"
	if r.State == "failed" {
		state = "failed"
	}
	detail := "execution is " + r.State
	if r.Error != nil {
		detail = r.Error.Message
	}
	return rawJSON(r), state, r.CellID, detail
}

func (m *AgentManager) workflowRecover(ctx context.Context, store workboxStore, a workbox.Request, signature string) (workbox.Instance, error) {
	return store.update(ctx, func(d *workboxDocument) error {
		if err := workflowCommand(d, a, signature); err != nil {
			return err
		}
		i := &d.Instance
		if i.State == "completed" {
			return fmt.Errorf("workflow is already completed")
		}
		shell, err := newPrivateShellManager(m.config, d.Workdir, store.dir+"/execution")
		if err != nil {
			return err
		}
		defer shell.Close()
		i.Interrupted(workflowNow())
		recoveryCtx := context.WithValue(ctx, imageGenTaskKey{}, i.ID)
		recoveryCtx = context.WithValue(recoveryCtx, imageUsageRecoveryKey{}, func(owner string, u AgentUsage) error {
			if owner != "" && owner != "workflow:"+i.ID || u.SourceID == "" {
				return fmt.Errorf("workflow image receipt belongs to a different accounting owner")
			}
			for n, row := range i.Usage {
				if row.Kind == "image_gen" && row.SourceID == u.SourceID {
					i.Usage[n] = u
					// The state lease is already held. Commit accounting before
					// image recovery is allowed to discard the paid response.
					if err := store.write(*d); err != nil {
						i.Usage[n] = row
						return err
					}
					return nil
				}
			}
			return fmt.Errorf("original workflow image usage sample is unavailable; paid receipt retained")
		})
		unresolved := false
		for n := range i.Steps {
			s := &i.Steps[n]
			if s.State != "unknown" && s.State != "persistence_failed" && s.State != "in_flight" && s.State != "waiting" && s.State != "failed" {
				continue
			}
			ref := i.Tools[i.Definition.Steps[n].Tool]
			if ref.Identity == "image_gen" {
				r, e := runImageGen(recoveryCtx, m.config, rawJSON(map[string]any{"action": "recover", "batch_id": s.Invocation, "limit": 100}))
				s.Result, s.State, s.Receipt, s.Error = workflowImageResult(r, e)
				for _, u := range r.Usage {
					found := false
					for n := range i.Usage {
						if i.Usage[n].SourceID == u.SourceID {
							i.Usage[n] = u
							found = true
							break
						}
					}
					if !found && u.SourceID != "" {
						i.Usage = append(i.Usage, u)
					}
				}
			} else if r, ok := shell.executionByKey(s.Invocation); ok {
				s.Result, s.State, s.Receipt, s.Error = workflowCellResult(r)
			} else {
				s.State = "unknown"
				s.Error = "original execution receipt unavailable; no dispatch was replayed"
			}
			unresolved = unresolved || s.State != "completed"
		}
		if unresolved {
			i.State = "unknown"
		} else {
			i.State = "paused"
			i.Error = ""
			for _, s := range i.Steps {
				if s.State == "awaiting_review" {
					i.State = "awaiting_review"
				}
			}
		}
		workflowCommit(d, a, signature)
		return nil
	})
}

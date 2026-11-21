// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Tool/workbox/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: StepState; LockedTool; Instance; New; CompletedResults; Next; Prepare; Interrupted; Finish
// Impact: python -B scripts/code-atlas.py show Tool/workbox/state.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package workbox

import (
	"encoding/json"
	"fmt"
	"github.com/aieyra/aieyra-os/contracts/protocol"
	"reflect"

	tool "github.com/aieyra/aieyra-os/tool/contract"
)

type StepState struct {
	ID         string          `json:"id"`
	State      string          `json:"state"`
	Invocation string          `json:"invocation,omitempty"`
	Arguments  json.RawMessage `json:"arguments,omitempty"`
	Result     json.RawMessage `json:"result,omitempty"`
	Receipt    string          `json:"receipt,omitempty"`
	Error      string          `json:"error,omitempty"`
	Attempts   int             `json:"attempts"`
	Started    string          `json:"started,omitempty"`
	Completed  string          `json:"completed,omitempty"`
}

type LockedTool struct {
	Identity     string   `json:"identity"`
	Capabilities []string `json:"capabilities"`
}

type Instance struct {
	Schema       string                `json:"schema"`
	ID           string                `json:"id"`
	Owner        string                `json:"owner"`
	Package      string                `json:"package"`
	Title        string                `json:"title"`
	Definition   Definition            `json:"definition"`
	Input        map[string]any        `json:"input"`
	Dependencies map[string]string     `json:"dependencies"`
	Tools        map[string]LockedTool `json:"tools"`
	State        string                `json:"state"`
	Revision     uint64                `json:"revision"`
	Steps        []StepState           `json:"steps"`
	Outputs      map[string]any        `json:"outputs,omitempty"`
	AgentID      string                `json:"agent_id,omitempty"`
	Created      string                `json:"created"`
	Updated      string                `json:"updated"`
	Error        string                `json:"error,omitempty"`
	Usage        []protocol.AgentUsage `json:"usage,omitempty"`
}

// New creates no process and reads no files. The host must persist this
// snapshot, with verified dependency locks, before any step is admitted.
func New(id, owner, identity string, p Package, input map[string]any, now string) (Instance, error) {
	i := Instance{}
	if !identifier.MatchString(id) || owner == "" || !tool.ValidPackageID(identity) || now == "" {
		return i, fmt.Errorf("invalid workflow instance identity")
	}
	if err := p.Definition.Validate(); err != nil {
		return i, err
	}
	if err := tool.ValidateArguments(p.Input, input); err != nil {
		return i, err
	}
	i = Instance{Schema: StateSchema, ID: id, Owner: owner, Package: identity, Title: p.Title, Definition: p.Definition, Input: input, State: "ready", Revision: 1, Dependencies: map[string]string{}, Tools: map[string]LockedTool{}, Created: now, Updated: now}
	for _, s := range p.Steps {
		i.Steps = append(i.Steps, StepState{ID: s.ID, State: "pending"})
	}
	// The admitted plan and input cannot change through an author's mutable map.
	raw, err := json.Marshal(i)
	if err != nil {
		return Instance{}, err
	}
	var snapshot Instance
	if err = json.Unmarshal(raw, &snapshot); err != nil {
		return Instance{}, err
	}
	return snapshot, nil
}

func (i Instance) CompletedResults() map[string]json.RawMessage {
	out := map[string]json.RawMessage{}
	for _, s := range i.Steps {
		if s.State == "completed" {
			out[s.ID] = append(json.RawMessage(nil), s.Result...)
		}
	}
	return out
}

// Next identifies a dependency-ready pending step. A finished, paused or
// uncertain instance is not implicitly resumed by asking for its next step.
// The host must explicitly persist State=running after authorizing a resume.
func (i Instance) Next() (int, error) {
	if i.Schema != StateSchema || len(i.Steps) != len(i.Definition.Steps) {
		return -1, fmt.Errorf("workflow snapshot does not match its definition")
	}
	if i.State != "running" {
		return -1, fmt.Errorf("workflow is %s; no step admitted", i.State)
	}
	states := map[string]string{}
	for n, s := range i.Steps {
		if s.ID != i.Definition.Steps[n].ID {
			return -1, fmt.Errorf("workflow step identity is corrupt")
		}
		states[s.ID] = s.State
		if s.State == "in_flight" || s.State == "waiting" || s.State == "unknown" || s.State == "persistence_failed" || s.State == "failed" || s.State == "cancelled" || s.State == "awaiting_review" {
			return -1, fmt.Errorf("step %s is %s; inspect or recover before continuing", s.ID, s.State)
		}
		if s.State != "pending" && s.State != "completed" && s.State != "skipped" {
			return -1, fmt.Errorf("unknown workflow step state: %s", s.State)
		}
	}
	for n, s := range i.Definition.Steps {
		if states[s.ID] != "pending" {
			continue
		}
		ready := true
		for _, dep := range s.Needs {
			ready = ready && (states[dep] == "completed" || states[dep] == "skipped")
		}
		if ready {
			return n, nil
		}
	}
	for _, s := range i.Steps {
		if s.State == "pending" {
			return -1, fmt.Errorf("workflow has unresolved dependencies")
		}
	}
	return -1, nil
}

// Prepare binds actual completed outputs and evaluates an optional condition.
// Checkpoints have no executable arguments. No state is mutated here; the host
// must commit an intent or review boundary before acting on the result.
func (i Instance) Prepare(index int) (arguments json.RawMessage, skipped bool, err error) {
	next, admission := i.Next()
	if admission != nil || next != index {
		return nil, false, fmt.Errorf("step is not admitted by current workflow state: %v", admission)
	}
	if index < 0 || index >= len(i.Definition.Steps) || index >= len(i.Steps) || i.Steps[index].State != "pending" {
		return nil, false, fmt.Errorf("workflow step is not pending")
	}
	step, completed := i.Definition.Steps[index], i.CompletedResults()
	if c := step.When; c != nil {
		var result any
		if json.Unmarshal(completed[c.Step], &result) != nil {
			return nil, false, fmt.Errorf("condition source is unavailable: %s", c.Step)
		}
		value, err := Select(result, c.Path)
		if err != nil {
			return nil, false, err
		}
		if !reflect.DeepEqual(value, c.Equals) {
			return nil, true, nil
		}
	}
	if step.Kind == "checkpoint" {
		return nil, false, nil
	}
	bound, err := Bind(step.Arguments, i.Input, completed)
	if err != nil {
		return nil, false, err
	}
	raw, err := json.Marshal(bound)
	return raw, false, err
}

// Interrupted is called only when the host has acquired the former runner's
// exclusive lease. It never returns a possibly dispatched step to pending.
func (i *Instance) Interrupted(now string) bool {
	changed := false
	for n := range i.Steps {
		s := &i.Steps[n]
		if s.State == "in_flight" || s.State == "waiting" {
			s.State = "unknown"
			s.Error = "The previous runner ended; inspect existing receipts before any further dispatch."
			changed = true
		}
	}
	if changed {
		i.State, i.Updated = "unknown", now
		i.Revision++
	} else if i.State == "running" {
		i.State, i.Updated = "paused", now
		i.Revision++
		changed = true
	}
	return changed
}

func (i *Instance) Finish(now string) error {
	if i.State != "running" {
		return fmt.Errorf("workflow is %s; completion is not admitted", i.State)
	}
	for _, s := range i.Steps {
		if s.State != "completed" && s.State != "skipped" {
			return fmt.Errorf("unfinished step: %s", s.ID)
		}
	}
	bound, err := Bind(i.Definition.Outputs, i.Input, i.CompletedResults())
	if err != nil {
		return err
	}
	i.Outputs, _ = bound.(map[string]any)
	i.State, i.Updated = "completed", now
	i.Revision++
	return nil
}

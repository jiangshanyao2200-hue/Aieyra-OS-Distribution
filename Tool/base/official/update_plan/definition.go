package updateplan

import (
	_ "embed"
	"github.com/aieyra/aieyra-os/contracts/protocol"
	"strings"
)

//go:embed manual.txt
var planManual string

var schemaObject = protocol.SchemaObject
var schemaString = protocol.SchemaString
var schemaStrings = protocol.SchemaStrings
var schemaEnum = protocol.SchemaEnum

func PlanToolDefinition() protocol.ToolDefinition {
	snapshotStep := schemaObject(map[string]any{"id": schemaString(), "description": schemaString(), "status": schemaEnum(PlanPending, PlanRunning, PlanCompleted, PlanBlocked, PlanCancelled), "result": schemaString()}, "description", "status")
	step := schemaObject(map[string]any{"id": schemaString(), "text": schemaString(), "status": schemaEnum(PlanPending, PlanRunning, "todo", "running"), "depends_on": schemaStrings()}, "text")
	steps := map[string]any{"type": "array", "items": step}
	acceptance := map[string]any{"type": "array", "items": schemaString(), "minItems": 1, "maxItems": 16, "description": "Required for action=create. List the observable conditions for the user's task to be complete. Omit for existing plan updates and the legacy snapshot form."}
	phase := schemaObject(map[string]any{"id": schemaString(), "title": schemaString(), "steps": steps}, "id", "title", "steps")
	resume := schemaObject(map[string]any{"step_id": schemaString(), "status": schemaEnum(PlanCompleted), "detail": schemaString()})
	change := schemaObject(map[string]any{
		"op": schemaEnum("revise", "insert", "replace", "set_status", "move", "phase_add", "phase_revise", "set_lifecycle", "set_dependencies"), "step_id": schemaString(), "phase_id": schemaString(), "before_id": schemaString(), "after_id": schemaString(), "text": schemaString(), "title": schemaString(), "status": schemaEnum(PlanPending, PlanRunning, PlanCompleted, PlanDeferred, PlanBlocked, PlanCancelled, "active", "paused", "todo", "running", "done", "complete", "canceled"), "reason": schemaString(), "new_step": step, "steps": steps, "evidence": map[string]any{"type": "array", "items": schemaString(), "minItems": 1, "description": "REQUIRED whenever set_status.status is completed. Supply concrete observed results; reason is not evidence. Missing evidence rejects the entire batch without advancing revision."}, "resume_condition": resume, "depends_on": schemaStrings(),
	}, "op")
	return protocol.ToolDefinition{Type: "function", Name: "update_plan", Description: strings.TrimSpace(planManual), Parameters: schemaObject(map[string]any{
		"new_task": map[string]any{"type": "boolean"}, "summary": schemaString(), "plan": map[string]any{"type": "array", "items": snapshotStep, "minItems": 1, "maxItems": 16}, "steps": steps, "reason": schemaString(), "action": schemaEnum("create", "update", "complete"), "plan_id": schemaString(), "expected_revision": map[string]any{"type": "integer"}, "mode": schemaEnum("plan", "goal", "todo", "phase"), "objective": schemaString(), "acceptance": acceptance, "phases": map[string]any{"type": "array", "items": phase}, "changes": map[string]any{"type": "array", "items": change}, "completion": map[string]any{"type": "array", "items": schemaObject(map[string]any{"criterion": schemaString(), "evidence": schemaStrings()}, "criterion", "evidence")},
	})}
}

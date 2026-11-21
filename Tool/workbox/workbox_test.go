// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Tool/workbox/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: sample; instance; TestWorkflowAdmissionAndReviewBoundary; TestInterruptedEffectsNeverReturnToPending; TestConditionsUseActualResultsAndUnavailableBindingsFail; TestDefinitionRejectsUndeclaredToolsAndDependencies; TestAcceptedInputAndDefinitionAreIndependentSnapshots
// Impact: python -B scripts/code-atlas.py show Tool/workbox/workbox_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package workbox

import (
	"encoding/json"
	"strings"
	"testing"
)

func sample(t *testing.T) Package {
	t.Helper()
	files := map[string][]byte{
		"workflow.json": []byte(`{
		 "schema":"aieyra.workbox/1","name":"statistics","description":"Compute, review, then export an actual result",
		 "input":{"type":"object","properties":{"values":{"type":"array","items":{"type":"number"}}},"required":["values"],"additionalProperties":false},
		 "tools":{"statistics":{"package":"example.statistics"},"report":{"package":"example.report"}},
		 "steps":[
		  {"id":"calculate","title":"Calculate","kind":"call","needs":[],"tool":"statistics","arguments":{"values":{"$input":"/values"}},"effect":"read"},
		  {"id":"review","title":"Review the actual result","kind":"checkpoint","needs":["calculate"]},
		  {"id":"export","title":"Export after review","kind":"call","needs":["calculate","review"],"tool":"report","arguments":{"sum":{"$step":"calculate","path":"/sum"}},"effect":"external","when":{"step":"calculate","path":"/sum","equals":12}}
		 ],
		 "outputs":{"statistics":{"$step":"calculate","path":""}},
		 "agentTemplate":{"title":"Statistics specialist","prompt":"Use the workflow and inspect actual receipts.","max_tokens":2000,"timeout_seconds":120,"retention":"task"}
		}`),
		"manual.md":    []byte("Calculate, review explicitly, then export. Interrupted effects require recovery, never blind replay."),
		"desktop.json": []byte(`{"schema":"aieyra.workbox-view/1","result":"workflow","title":"Statistics workflow"}`),
		"cli.json":     []byte(`{"schema":"aieyra.workbox-text/1","result":"workflow","format":"json"}`),
	}
	p, err := Decode(files, "workflow.json", "manual.md", "desktop.json", "cli.json")
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func instance(t *testing.T) Instance {
	t.Helper()
	i, err := New("workflow-test", "owner", "mod:example.workflow@"+strings.Repeat("a", 64), sample(t), map[string]any{"values": []any{float64(2), float64(3), float64(7)}}, "now")
	if err != nil {
		t.Fatal(err)
	}
	return i
}

func TestWorkflowAdmissionAndReviewBoundary(t *testing.T) {
	i := instance(t)
	if _, err := i.Next(); err == nil {
		t.Fatal("inspection implicitly started a ready workflow")
	}
	i.State = "running"
	if _, _, err := i.Prepare(2); err == nil {
		t.Fatal("export bypassed its prerequisites")
	}
	args, skip, err := i.Prepare(0)
	if err != nil || skip || string(args) != `{"values":[2,3,7]}` {
		t.Fatal(string(args), skip, err)
	}
	i.Steps[0].State, i.Steps[0].Result = "completed", json.RawMessage(`{"sum":12}`)
	if n, err := i.Next(); err != nil || n != 1 {
		t.Fatal("review boundary was skipped", n, err)
	}
	i.Steps[1].State = "awaiting_review"
	if _, err := i.Next(); err == nil {
		t.Fatal("unreviewed result reached a mutating step")
	}
	i.Steps[1].State, i.Steps[1].Result = "completed", json.RawMessage(`{"approved":true}`)
	args, skip, err = i.Prepare(2)
	if err != nil || skip || string(args) != `{"sum":12}` {
		t.Fatal(string(args), skip, err)
	}
	i.Steps[2].State, i.Steps[2].Result = "completed", json.RawMessage(`{"file":"actual.json"}`)
	if err := i.Finish("finished"); err != nil || i.State != "completed" {
		t.Fatal(i, err)
	}
	if got := i.Outputs["statistics"].(map[string]any)["sum"]; got != float64(12) {
		t.Fatal("output did not bind actual prior receipt", got)
	}
}

func TestInterruptedEffectsNeverReturnToPending(t *testing.T) {
	for _, state := range []string{"in_flight", "waiting"} {
		i := instance(t)
		i.State, i.Steps[0].State = "running", state
		i.Steps[0].Invocation, i.Steps[0].Attempts = "stable-invocation", 1
		i.Steps[0].Receipt = "original-cell"
		if !i.Interrupted("restart") || i.State != "unknown" || i.Steps[0].State != "unknown" || i.Steps[0].Invocation != "stable-invocation" || i.Steps[0].Receipt != "original-cell" || i.Steps[0].Attempts != 1 {
			t.Fatal("interruption lost the original side effect identity", i)
		}
		if i.Interrupted("restart-again") {
			t.Fatal("repeated recovery rewrote an already unknown result")
		}
		i.State = "running"
		if _, err := i.Next(); err == nil {
			t.Fatal("resume bypassed an unknown effect")
		}
	}
	i := instance(t)
	i.State = "running"
	if !i.Interrupted("restart") || i.State != "paused" || i.Steps[0].State != "pending" {
		t.Fatal("an undispatched step was incorrectly declared executed", i)
	}
}

func TestConditionsUseActualResultsAndUnavailableBindingsFail(t *testing.T) {
	i := instance(t)
	i.State = "running"
	i.Steps[0].State, i.Steps[0].Result = "completed", json.RawMessage(`{"sum":9}`)
	i.Steps[1].State, i.Steps[1].Result = "completed", json.RawMessage(`{"approved":true}`)
	if _, skipped, err := i.Prepare(2); err != nil || !skipped {
		t.Fatal("condition was not evaluated against the saved output", skipped, err)
	}
	i.Steps[0].Result = json.RawMessage(`{"unrelated":12}`)
	if _, _, err := i.Prepare(2); err == nil {
		t.Fatal("missing output was guessed")
	}
	for _, pointer := range []string{"not-a-pointer", "/~bad", "/values/01", "/values/-1", "/values/9"} {
		if _, err := Select(i.Input, pointer); err == nil {
			t.Fatal("invalid pointer accepted", pointer)
		}
	}
}

func TestDefinitionRejectsUndeclaredToolsAndDependencies(t *testing.T) {
	for _, modify := range []func(*Definition){
		func(d *Definition) { d.Steps[0].Needs = []string{"export"} },
		func(d *Definition) { d.Steps[2].Needs = []string{"review"} },
		func(d *Definition) { d.Steps[0].Arguments["values"] = map[string]any{"$input": "/private"} },
		func(d *Definition) { d.Steps[0].Arguments["values"] = map[string]any{"$evaluate": "code"} },
		func(d *Definition) { d.Tools["statistics"] = Tool{Builtin: "exec"} },
		func(d *Definition) { d.Tools["statistics"] = Tool{Builtin: "image_gen"} },
		func(d *Definition) { d.Steps[1].Tool = "report" },
		func(d *Definition) { d.AgentTemplate.MaxTokens = 0 },
	} {
		d := sample(t).Definition
		modify(&d)
		if d.Validate() == nil {
			t.Fatal("invalid workflow definition was accepted", d)
		}
	}
}

func TestAcceptedInputAndDefinitionAreIndependentSnapshots(t *testing.T) {
	p, input := sample(t), map[string]any{"values": []any{float64(2)}}
	i, err := New("isolated", "owner", "mod:example.workflow@"+strings.Repeat("b", 64), p, input, "now")
	if err != nil {
		t.Fatal(err)
	}
	input["values"].([]any)[0] = float64(999)
	p.Steps[0].Arguments["values"] = "changed"
	i.State = "running"
	raw, _, err := i.Prepare(0)
	if err != nil || string(raw) != `{"values":[2]}` {
		t.Fatal("caller mutation changed accepted execution", string(raw), err)
	}
}

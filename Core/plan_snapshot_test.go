// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestPlanSnapshotAdapterPreservesEvidenceCASAndAcceptance; TestPlanSnapshotAdapterRejectsUnknownAndMixedFormats
// Impact: python -B scripts/code-atlas.py show Core/plan_snapshot_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"encoding/json"
	"testing"
)

func TestPlanSnapshotAdapterPreservesEvidenceCASAndAcceptance(t *testing.T) {
	e := &PlanEngine{}
	n := 0
	call := func(args string) PlanToolResult {
		t.Helper()
		n++
		r, _ := e.apply(ToolCall{ID: string(rune('a' + n)), Function: FunctionCall{Name: "update_plan", Arguments: args}}, "snapshot")
		var out PlanToolResult
		if err := json.Unmarshal([]byte(r.Output), &out); err != nil {
			t.Fatal(err)
		}
		return out
	}
	create := `{"summary":"读取和验证","plan":[{"id":"read","description":"读取输入","status":"in_progress","result":""},{"id":"verify","description":"验证结果","status":"pending","result":""}]}`
	if r := call(create); !r.OK || e.State.Revision != 1 {
		t.Fatalf("create: %+v", r)
	}
	e.RequestSnapshot, e.SnapshotBound = ClonePlan(e.State), true
	if r := call(`{"summary":"跳过","plan":[{"id":"read","description":"读取输入","status":"completed","result":""},{"id":"verify","description":"验证结果","status":"completed","result":""}]}`); r.OK || e.State.Revision != 1 {
		t.Fatal("empty evidence accepted")
	}
	if r := call(`{"summary":"丢弃验收","plan":[{"id":"read","description":"读取输入","status":"completed","result":"已读取"}]}`); r.OK {
		t.Fatal("step loss accepted")
	}
	if r := call(`{"summary":"更换目标","plan":[{"id":"read","description":"不再读输入","status":"in_progress"},{"id":"verify","description":"验证结果","status":"pending"}]}`); r.OK {
		t.Fatal("acceptance overwritten")
	}
	update := `{"summary":"输入已读取","plan":[{"id":"read","description":"读取输入","status":"completed","result":"读取input.json并核对nonce"},{"id":"verify","description":"验证结果","status":"in_progress","result":""}]}`
	if r := call(update); !r.OK || e.State.Revision != 2 {
		t.Fatalf("update: %+v", r)
	}
	if r := call(update); r.OK || r.Error.Code != "revision_conflict" {
		t.Fatalf("stale not rejected: %+v", r)
	}
	e.RequestSnapshot = ClonePlan(e.State)
	if r := call(update); !r.OK || !r.NoChange || e.State.Revision != 2 {
		t.Fatalf("unchanged current snapshot must succeed without a new revision: %+v", r)
	}
	if r := call(`{"summary":"所有检查通过","plan":[{"id":"read","description":"读取输入","status":"completed","result":"读取input.json并核对nonce"},{"id":"verify","description":"验证结果","status":"completed","result":"运行独立解析断言，退出码0"}]}`); !r.OK || e.State.Status != "complete" {
		t.Fatalf("complete: %+v", r)
	}
	if err := ValidatePlan(e.State); err != nil {
		t.Fatal(err)
	}
	if len(e.State.Completion) != 2 || e.State.Acceptance[1] != "验证结果" {
		t.Fatal("acceptance lost")
	}
}

func TestPlanSnapshotAdapterRejectsUnknownAndMixedFormats(t *testing.T) {
	for _, raw := range []string{
		`{"summary":"x","plan":[{"description":"x","status":"pending","hidden":"x"}]}`,
		`{"summary":"x","plan":[{"description":"x","status":"pending"}],"action":"create"}`,
		`{"summary":"x","plan":[{"description":"x","status":"completed","result":"fake history"}]}`,
	} {
		u, err := ParsePlanUpdate(raw)
		if err == nil {
			e := &PlanEngine{}
			u, err = e.adaptUpdate(u)
			if err == nil {
				_, err = ApplyPlanUpdate(nil, u)
			}
		}
		if err == nil {
			t.Fatalf("accepted invalid snapshot %s", raw)
		}
	}
}

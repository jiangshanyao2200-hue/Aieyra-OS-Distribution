// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestPlanCurrentTargetAndActionableErrors; TestPlanSimpleFormUsesRequestSnapshotAndEvidence; TestPlanActionSynonymsAndUnknownActionHint
// Impact: python -B scripts/code-atlas.py show Core/plan_usability_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

// 用户实测中连续三次漏传 plan_id，被误导成版本冲突；省略 ID 只绑定当前计划。
func TestPlanCurrentTargetAndActionableErrors(t *testing.T) {
	e := &PlanEngine{State: initialPlan(t)}
	invoke := func(u PlanUpdate, serial int) PlanToolResult {
		t.Helper()
		args, _ := json.Marshal(u)
		turn, err := ExecutePlanTools(e, Message{Role: RoleAssistant, ToolCalls: []ToolCall{{ID: fmt.Sprint(serial), Function: FunctionCall{Name: "update_plan", Arguments: string(args)}}}}, fmt.Sprint(serial), func(ToolTurn) error { return nil })
		if err != nil {
			t.Fatal(err)
		}
		var result PlanToolResult
		if err = json.Unmarshal([]byte(turn.Messages[1].Content), &result); err != nil {
			t.Fatal(err)
		}
		return result
	}
	u := PlanUpdate{Action: "update", ExpectedRevision: 1, Changes: []PlanOperation{{Op: "set_status", StepID: "p1", Status: PlanCompleted, Reason: "已检查", Evidence: []string{"两种布局已逐项比较"}}}}
	if r := invoke(u, 1); !r.OK || r.Revision != 2 || r.PlanID != e.State.ID {
		t.Fatalf("漏 ID 的当前计划更新失败: %+v", r)
	}
	if r := invoke(u, 2); r.OK || r.Error.Code != "revision_conflict" || r.Revision != 2 {
		t.Fatalf("未保持过期版本保护: %+v", r)
	}
	u.ExpectedRevision = 2
	u.PlanID = "plan_other"
	if r := invoke(u, 3); r.OK || r.Error.Code != "plan_id_mismatch" {
		t.Fatalf("错误 ID 被误报: %+v", r)
	}
	u.PlanID = ""
	u.Changes = []PlanOperation{{Op: "revise", StepID: "p2", Text: "不应提交", Reason: "批次回退"}, {Op: "replace", StepID: "p2", NewStep: &PlanStep{ID: "p2", Text: "错误重用 ID", Status: PlanPending}, Reason: "替换测试"}}
	if r := invoke(u, 4); r.OK || r.Error.Code != "replacement_id_conflict" || !strings.Contains(r.Error.Message, "revise") {
		t.Fatalf("替换错误不可纠正: %+v", r)
	}
	_, step := e.State.FindStep("p2")
	if e.State.Revision != 2 || step.Text == "不应提交" {
		t.Fatal("失败批次污染计划")
	}
}

func TestPlanSimpleFormUsesRequestSnapshotAndEvidence(t *testing.T) {
	e := &PlanEngine{}
	invoke := func(args string, id string) PlanToolResult {
		r, _ := e.apply(ToolCall{ID: id, Function: FunctionCall{Name: "update_plan", Arguments: args}}, "simple")
		var result PlanToolResult
		json.Unmarshal([]byte(r.Output), &result)
		return result
	}
	create := invoke(`{"action":"create","objective":"核对任务","acceptance":["完成核对"],"steps":[{"text":"读代码","status":"running"},{"text":"验证"}]}`, "create")
	if !create.OK || e.State.Mode != "plan" || e.State.Phases[0].Steps[1].ID != "p2" {
		t.Fatalf("%+v", create.Error)
	}
	e.RequestSnapshot, e.SnapshotBound = ClonePlan(e.State), true
	if r := invoke(`{"action":"update","reason":"已读取","changes":[{"op":"set_status","step_id":"读代码","status":"done","evidence":["实际代码已检查"]},{"op":"set_status","step_id":"验证","status":"running"}]}`, "update"); !r.OK || r.Revision != 2 {
		t.Fatalf("%+v", r.Error)
	}
	if r := invoke(`{"action":"update","reason":"旧请求","changes":[{"op":"revise","step_id":"p2","text":"不能覆盖"}]}`, "stale"); r.OK || r.Error.Code != "revision_conflict" {
		t.Fatalf("%+v", r)
	}
	e.RequestSnapshot = ClonePlan(e.State)
	if r := invoke(`{"action":"update","reason":"完成","changes":[{"op":"set_status","step_id":"p2","status":"done"}]}`, "no-evidence"); r.OK || e.State.Revision != 2 {
		t.Fatal("completed without evidence")
	}
}

// R45：模型写了近义 action（或只给 changes）白白浪费一轮；常见近义词映射到严格动作，错误提示带上收到的值。
func TestPlanActionSynonymsAndUnknownActionHint(t *testing.T) {
	e := &PlanEngine{State: initialPlan(t)}
	invoke := func(args string, id string) PlanToolResult {
		e.RequestSnapshot, e.SnapshotBound = ClonePlan(e.State), true
		r, _ := e.apply(ToolCall{ID: id, Function: FunctionCall{Name: "update_plan", Arguments: args}}, id)
		var result PlanToolResult
		json.Unmarshal([]byte(r.Output), &result)
		return result
	}
	if r := invoke(`{"action":"progress","changes":[{"op":"set_status","step_id":"p1","status":"done","reason":"已检查","evidence":["读回文件一致"]}]}`, "a1"); !r.OK || r.Revision != 2 {
		t.Fatalf("近义 action 未映射到 update: %+v", r.Error)
	}
	if r := invoke(`{"changes":[{"op":"set_status","step_id":"p2","status":"in_progress","reason":"开始"}]}`, "a2"); !r.OK || r.Revision != 3 {
		t.Fatalf("只给 changes 未按 update 处理: %+v", r.Error)
	}
	if r := invoke(`{"action":"rewrite","changes":[{"op":"set_status","step_id":"p2","status":"completed","reason":"x","evidence":["y"]}]}`, "a3"); r.OK || !strings.Contains(r.Error.Message, `"rewrite"`) {
		t.Fatalf("未知 action 应拒绝并提示收到的值: %+v", r)
	}
}

// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: schemaObject; schemaString; schemaStrings; schemaEnum; PlanToolDefinition; ToolReceipt; PlanEngine; ToolTurn; PlanToolResult; Clone; apply; applyContext; ExecutePlanTools; executePlanTools; Replay; ValidateToolTurn
// Impact: python -B scripts/code-atlas.py show Core/tools.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

// 工具定义与持久化边界保持供应商无关。
import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"github.com/aieyra/aieyra-os/contracts/protocol"
	patchtool "github.com/aieyra/aieyra-os/tool/base/official/apply_patch"
	plantool "github.com/aieyra/aieyra-os/tool/base/official/update_plan"
	"reflect"
)

var schemaObject = protocol.SchemaObject
var schemaString = protocol.SchemaString
var schemaStrings = protocol.SchemaStrings
var schemaEnum = protocol.SchemaEnum

func PlanToolDefinition() ToolDefinition {
	definition := plantool.PlanToolDefinition()
	definition.Description = runtimePrompt("Matrix/工具说明/持久计划.txt")
	return definition
}

type ToolReceipt struct {
	Key          string            `json:"key"`
	ToolName     string            `json:"tool_name,omitempty"`
	ArgumentHash string            `json:"argument_hash"`
	Output       string            `json:"output"`
	Transition   *PlanTransition   `json:"transition,omitempty"`
	Patch        *PatchResult      `json:"patch,omitempty"`
	Images       []ImageAttachment `json:"image_attachments,omitempty"`
}
type PlanEngine struct {
	PriorTaskID     string
	RequestSnapshot *PlanState
	SnapshotBound   bool
	State           *PlanState
	Receipts        map[string]ToolReceipt
}
type ToolTurn struct {
	Replayed     bool          `json:"-"`
	InvocationID string        `json:"invocation_id"`
	Messages     []Message     `json:"messages"`
	Receipts     []ToolReceipt `json:"receipts"`
}
type PlanToolResult struct {
	OK           bool         `json:"ok"`
	NoChange     bool         `json:"no_change,omitempty"`
	Error        *PlanError   `json:"error,omitempty"`
	PlanID       string       `json:"plan_id,omitempty"`
	Revision     int          `json:"revision,omitempty"`
	State        *PlanState   `json:"state,omitempty"`
	Changes      []PlanChange `json:"changes,omitempty"`
	CurrentPhase string       `json:"current_phase_id,omitempty"`
	CurrentStep  string       `json:"current_step_id,omitempty"`
	Status       string       `json:"status,omitempty"`
}

func (e *PlanEngine) Clone() *PlanEngine {
	out := &PlanEngine{State: ClonePlan(e.State), Receipts: map[string]ToolReceipt{}, RequestSnapshot: ClonePlan(e.RequestSnapshot), SnapshotBound: e.SnapshotBound, PriorTaskID: e.PriorTaskID}
	for k, v := range e.Receipts {
		out.Receipts[k] = v
	}
	return out
}
func (e *PlanEngine) apply(call ToolCall, invocation string) (ToolReceipt, bool) {
	return e.applyContext(context.Background(), call, invocation)
}

func (e *PlanEngine) applyContext(ctx context.Context, call ToolCall, invocation string) (ToolReceipt, bool) {
	key := invocation + ":" + call.ID
	sum := sha256.Sum256([]byte(call.Function.Name + "\x00" + call.Function.Arguments))
	hash := hex.EncodeToString(sum[:])
	if old, ok := e.Receipts[key]; ok {
		if old.ArgumentHash == hash {
			return old, true
		}
		b, _ := json.Marshal(PlanToolResult{Error: &PlanError{Code: "call_conflict", Message: "同一调用身份携带了不同参数，已拒绝"}, State: ClonePlan(e.State)})
		return ToolReceipt{Key: key, ArgumentHash: hash, Output: string(b)}, false
	}
	var result PlanToolResult
	var transition *PlanTransition
	var err error
	if ctx.Err() != nil {
		err = planError("cancelled", "本轮已停止，此调用未执行")
	} else if call.Function.Name != "update_plan" {
		err = planError("unknown_tool", "没有注册工具 %q", call.Function.Name)
	} else {
		var u PlanUpdate
		u, err = ParsePlanUpdate(call.Function.Arguments)
		if err == nil {
			u, err = e.adaptUpdate(u)
		}
		if err == nil {
			// 每个会话只有一个当前计划；省略 ID 时绑定当前对象，版本校验仍不可省略。
			if u.Action != "create" && u.PlanID == "" && e.State != nil {
				u.PlanID = e.State.ID
			}
			if u.NewTask {
				if u.Action != "create" || e.State == nil || e.PriorTaskID != e.State.ID || !e.SnapshotBound || e.RequestSnapshot == nil || !reflect.DeepEqual(e.RequestSnapshot, e.State) {
					err = planError("task_boundary_required", "new_task 仅用于新的用户任务第一次建计划；当前任务须更新原计划，不能改写或绕过原验收。")
				} else {
					transition, err = ApplyPlanUpdate(nil, u)
					if transition != nil {
						transition.Before, transition.TaskBoundary = ClonePlan(e.State), true
					}
				}
			} else {
				transition, err = ApplyPlanUpdate(e.State, u)
			}
		}
	}
	if err != nil {
		pe, ok := err.(*PlanError)
		if !ok {
			pe = &PlanError{Code: "internal_error", Message: err.Error()}
		}
		if pe.Code == "no_change" {
			result.OK, result.NoChange = true, true
		} else {
			result.Error = pe
		}
		result.State = ClonePlan(e.State)
	} else {
		result.OK = true
		result.NoChange = transition == nil
		if transition != nil {
			e.PriorTaskID = ""
			e.State = ClonePlan(transition.State)
			result.Changes = transition.Changes
			if len(transition.Changes) > 0 && transition.Changes[0].Kind == "create" {
				result.State = ClonePlan(e.State)
			}
		}
		if e.State != nil {
			result.PlanID = e.State.ID
			result.Revision = e.State.Revision
			result.Status = e.State.Status
			ph, s := e.State.Current()
			if ph != nil {
				result.CurrentPhase = ph.ID
			}
			if s != nil {
				result.CurrentStep = s.ID
			}
		}
	}
	// 失败也回传同一层级的定位字段，模型无需猜测失败是否消耗了版本。
	if e.State != nil {
		result.PlanID, result.Revision, result.Status = e.State.ID, e.State.Revision, e.State.Status
	}
	data, _ := json.Marshal(result)
	receipt := ToolReceipt{Key: key, ArgumentHash: hash, Output: string(data), Transition: transition}
	if e.Receipts == nil {
		e.Receipts = map[string]ToolReceipt{}
	}
	e.Receipts[key] = receipt
	return receipt, false
}

// 将一次响应的所有工具结果和领域事件写成一条记录；任何落盘失败都不采用候选状态。
func ExecutePlanTools(e *PlanEngine, response Message, invocation string, persist func(ToolTurn) error) (ToolTurn, error) {
	return executePlanTools(context.Background(), e, response, invocation, persist)
}

func executePlanTools(ctx context.Context, e *PlanEngine, response Message, invocation string, persist func(ToolTurn) error) (ToolTurn, error) {
	turn := ToolTurn{InvocationID: invocation, Messages: []Message{response}}
	if invocation == "" || len(response.ToolCalls) == 0 || len(response.ToolCalls) > 32 {
		return turn, fmt.Errorf("工具响应身份或数量无效")
	}
	candidate := e.Clone()
	seen := map[string]bool{}
	replayedCalls := 0
	for _, call := range response.ToolCalls {
		if call.ID == "" || seen[call.ID] {
			return ToolTurn{}, fmt.Errorf("工具调用 ID 缺失或重复")
		}
		seen[call.ID] = true
		if old, ok := candidate.Receipts[invocation+":"+call.ID]; ok {
			sum := sha256.Sum256([]byte(call.Function.Name + "\x00" + call.Function.Arguments))
			if old.ArgumentHash != hex.EncodeToString(sum[:]) {
				return ToolTurn{}, fmt.Errorf("工具调用身份冲突，已拒绝且未写入会话")
			}
		}
		receipt, replayed := candidate.applyContext(ctx, call, invocation)
		result := Message{Role: RoleTool, ToolCallID: call.ID, Name: call.Function.Name, Content: receipt.Output}
		turn.Messages = append(turn.Messages, result)
		if replayed {
			replayedCalls++
		}
		if !replayed {
			turn.Receipts = append(turn.Receipts, receipt)
		}
	}
	if replayedCalls > 0 {
		if replayedCalls != len(response.ToolCalls) {
			return ToolTurn{}, fmt.Errorf("重复响应改变了调用集合，已拒绝")
		}
		turn.Replayed = true
		return turn, nil
	}
	if persist == nil {
		return ToolTurn{}, fmt.Errorf("工具执行缺少持久化边界")
	}
	if err := persist(turn); err != nil {
		return ToolTurn{}, fmt.Errorf("工具结果保存失败，计划未应用：%w", err)
	}
	*e = *candidate
	return turn, nil
}
func (e *PlanEngine) Replay(receipt ToolReceipt) error {
	if receipt.Key == "" || len(receipt.ArgumentHash) != 64 || !json.Valid([]byte(receipt.Output)) {
		return fmt.Errorf("工具收据损坏")
	}
	if receipt.Patch != nil && patchtool.PatchModelOutput(*receipt.Patch) != receipt.Output {
		return fmt.Errorf("补丁收据摘要与差异不匹配")
	}
	if old, ok := e.Receipts[receipt.Key]; ok {
		if old.ArgumentHash != receipt.ArgumentHash || old.Output != receipt.Output {
			return fmt.Errorf("工具收据身份冲突")
		}
		return nil
	}
	if t := receipt.Transition; t != nil {
		if err := ValidatePlan(t.State); err != nil {
			return err
		}
		if e.State == nil {
			if t.Before != nil || t.State.Revision != 1 {
				return fmt.Errorf("计划初始版本不连续")
			}
		} else if t.Before == nil || t.Before.ID != e.State.ID || t.Before.Revision != e.State.Revision {
			return fmt.Errorf("计划历史版本不连续")
		}
		if e.State != nil {
			if t.State.ID == e.State.ID && t.State.Revision != e.State.Revision+1 {
				return fmt.Errorf("计划修订号不连续")
			}
			if t.TaskBoundary && (t.State.ID == e.State.ID || !reflect.DeepEqual(t.Before, e.State)) {
				return fmt.Errorf("新任务必须完整保留原计划")
			}
			if t.State.ID != e.State.ID && (t.State.Revision != 1 || !t.TaskBoundary && e.State.Status != "complete" && e.State.Status != "cancelled") {
				return fmt.Errorf("新计划覆盖了未结束的目标")
			}
		}
		e.State = ClonePlan(t.State)
	}
	if e.Receipts == nil {
		e.Receipts = map[string]ToolReceipt{}
	}
	e.Receipts[receipt.Key] = receipt
	return nil
}

// 同一条落盘记录必须包含完整的调用/结果配对，不能恢复出孤立工具调用。
func ValidateToolTurn(t ToolTurn) error {
	if t.InvocationID == "" || len(t.Messages) < 2 || t.Messages[0].Role != RoleAssistant {
		return fmt.Errorf("工具事务身份或消息无效")
	}
	calls := t.Messages[0].ToolCalls
	if len(calls)+1 != len(t.Messages) {
		return fmt.Errorf("工具事务缺少结果")
	}
	seen := map[string]bool{}
	for i, c := range calls {
		result := t.Messages[i+1]
		if c.ID == "" || seen[c.ID] || result.Role != RoleTool || result.ToolCallID != c.ID || !json.Valid([]byte(result.Content)) {
			return fmt.Errorf("工具事务配对无效")
		}
		seen[c.ID] = true
	}
	for _, r := range t.Receipts {
		if r.Patch != nil && patchtool.PatchModelOutput(*r.Patch) != r.Output {
			return fmt.Errorf("补丁事务摘要与差异不匹配")
		}
		found := false
		for i, c := range calls {
			if r.Key == t.InvocationID+":"+c.ID && r.Output == t.Messages[i+1].Content && reflect.DeepEqual(r.Images, t.Messages[i+1].Images) {
				sum := sha256.Sum256([]byte(c.Function.Name + "\x00" + c.Function.Arguments))
				found = r.ArgumentHash == hex.EncodeToString(sum[:])
				break
			}
		}
		if !found {
			return fmt.Errorf("工具事务收据不匹配")
		}
	}
	return nil
}

// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: CompactionState; contextCompactionKey; compactBoundaryKey; memoryEditHistoryKey; contextCompaction; cloneCompaction; snapshot; set; compactionPending; validateCompaction; requestContextCompaction; scheduledCompaction; record; begin; completed; commitContextCheckpoint; allowMemoryEdit; consumeMemoryEdit; memoryMutation; editMemory; takeMemoryChange; compactionOutcomeMessage
// Impact: python -B scripts/code-atlas.py show Core/context_compaction.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"
)

// One maintenance record belongs to the same conversation archive as messages,
// tool receipts and checkpoints. Scheduling is not completion. The successful
// record is committed atomically inside the checkpoint it describes.
type CompactionState struct {
	RequestID   string              `json:"request_id"`
	Trigger     string              `json:"trigger"`
	State       string              `json:"state"`
	Code        string              `json:"code,omitempty"`
	First       int                 `json:"first_message"`
	Covered     int                 `json:"covered_messages"`
	Compression *ContextCompression `json:"compression,omitempty"`
	Packet      string              `json:"pac_id,omitempty"`
	Updated     string              `json:"updated_at"`
	Purpose     string              `json:"purpose,omitempty"`
}

type contextCompactionKey struct{}
type compactBoundaryKey struct{}
type memoryEditHistoryKey struct{}
type contextCompaction struct {
	mu            sync.Mutex
	last          *CompactionState
	editReady     string
	memoryChanged bool
}

func cloneCompaction(v *CompactionState) *CompactionState {
	if v == nil {
		return nil
	}
	c := *v
	if v.Compression != nil {
		x := *v.Compression
		c.Compression = &x
	}
	return &c
}
func (c *contextCompaction) snapshot() *CompactionState {
	c.mu.Lock()
	defer c.mu.Unlock()
	return cloneCompaction(c.last)
}
func (c *contextCompaction) set(v *CompactionState) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.last = cloneCompaction(v)
}
func compactionPending(v *CompactionState) bool {
	return v != nil && (v.State == "scheduled" || v.State == "running")
}

func validateCompaction(v *CompactionState, messages int, checkpoint bool) error {
	if v == nil || v.RequestID == "" || len(v.RequestID) > 256 || v.First < 0 || v.Covered < v.First || v.Covered > messages {
		return fmt.Errorf("上下文整理记录范围或身份无效")
	}
	if v.Purpose != "" && v.Purpose != "memory_edit" && v.Purpose != "identity_enter" && v.Purpose != "mother_maintenance" {
		return fmt.Errorf("上下文整理用途无效")
	}
	switch v.Trigger {
	case "manual", "automatic", "seal", "recovery":
	default:
		return fmt.Errorf("上下文整理来源无效")
	}
	switch v.State {
	case "scheduled", "running", "skipped", "deferred", "failed", "cancelled", "interrupted":
		if checkpoint {
			return fmt.Errorf("检查点缺少已完成整理记录")
		}
	case "completed":
		if !checkpoint {
			return fmt.Errorf("整理完成记录必须随检查点提交")
		}
	default:
		return fmt.Errorf("上下文整理状态无效")
	}
	if _, err := time.Parse(time.RFC3339Nano, v.Updated); err != nil {
		return fmt.Errorf("上下文整理时间无效")
	}
	return nil
}

func requestContextCompaction(ctx context.Context, args map[string]any, callID string) (any, error) {
	c, _ := ctx.Value(contextCompactionKey{}).(*contextCompaction)
	if c == nil {
		return nil, fmt.Errorf("当前执行会话不支持上下文整理")
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	for key := range args {
		if key != "action" && !(key == "purpose" && args["action"] == "compact" && args[key] == "memory_edit") {
			return nil, fmt.Errorf("compact 只接受 action 及可选 purpose=memory_edit，范围和请求编号由宿主管理")
		}
	}
	if args["action"] == "compact_status" {
		return map[string]any{"ok": true, "compaction": c.snapshot()}, nil
	}
	if args["action"] != "compact" {
		return nil, fmt.Errorf("未知上下文整理操作")
	}
	exclusive, _ := ctx.Value(compactBoundaryKey{}).(bool)
	if !exclusive {
		return nil, fmt.Errorf("上下文整理须单独成一次回复：这次回复只能有这一个 memory compact 调用；本次未压缩，请单独重发")
	}
	identity, _ := ctx.Value(toolInvocationKey{}).(string)
	if identity == "" {
		identity = callID
	}
	if identity == "" {
		return nil, fmt.Errorf("上下文整理缺少工具调用身份")
	}
	id := fmt.Sprintf("compact-%x", sha256.Sum256([]byte(identity)))
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.last != nil && c.last.RequestID == id {
		return map[string]any{"ok": true, "compaction": cloneCompaction(c.last), "replayed": true}, nil
	}
	if compactionPending(c.last) {
		return nil, fmt.Errorf("已有上下文整理等待完成，请查询 compact_status")
	}
	c.editReady = ""
	c.last = &CompactionState{RequestID: id, Trigger: "manual", State: "scheduled", Purpose: memString(args["purpose"]), Updated: time.Now().UTC().Format(time.RFC3339Nano)}
	return map[string]any{"ok": true, "compaction": cloneCompaction(c.last)}, nil
}

// Only a successfully committed tool result may restore a scheduled request.
// This also covers recovery of an interrupted tool transaction, without replay.
func scheduledCompaction(turn ToolTurn) *CompactionState {
	if len(turn.Messages) != 2 || len(turn.Messages[0].ToolCalls) != 1 {
		return nil
	}
	call := turn.Messages[0].ToolCalls[0]
	var args map[string]any
	if json.Unmarshal([]byte(call.Function.Arguments), &args) != nil {
		return nil
	}
	var result struct {
		OK         bool             `json:"ok"`
		Compaction *CompactionState `json:"compaction"`
		Data       json.RawMessage  `json:"data"`
	}
	if json.Unmarshal([]byte(turn.Messages[1].Content), &result) != nil || !result.OK {
		return nil
	}
	if call.Function.Name == "toolbox" && args["name"] == "compact" && args["action"] == "call" {
		if json.Unmarshal(result.Data, &result) != nil || !result.OK {
			return nil
		}
	} else if call.Function.Name != "memory" || args["action"] != "compact" && args["action"] != "context_clean" {
		return nil
	}
	if result.Compaction == nil || result.Compaction.State != "scheduled" || validateCompaction(result.Compaction, 0, false) != nil {
		return nil
	}
	return cloneCompaction(result.Compaction)
}

func (c *contextCompaction) record(a *SessionArchive, state, code string) error {
	v := c.snapshot()
	if v == nil {
		return nil
	}
	v.State, v.Code, v.Updated = state, code, time.Now().UTC().Format(time.RFC3339Nano)
	if err := a.Append("compaction_state", v); err != nil {
		return err
	}
	c.set(v)
	return nil
}

func (c *contextCompaction) begin(a *SessionArchive, first, end int) error {
	v := c.snapshot()
	if !compactionPending(v) {
		v = &CompactionState{RequestID: fmt.Sprintf("auto-%x", sha256.Sum256([]byte(fmt.Sprintf("%s:%d:%d", a.Path, first, end)))), Trigger: "automatic"}
	}
	v.First, v.Covered = first, end
	c.set(v)
	return c.record(a, "running", "")
}

func (c *contextCompaction) completed(cp *Checkpoint, trigger string) *CompactionState {
	v := c.snapshot()
	// PAC can have committed before the session checkpoint. Only an exact
	// running range belongs to that recovery; a later scheduled call does not.
	matched := compactionPending(v) && (trigger != "recovery" || v.State == "running" && v.Covered == cp.Covered)
	if !matched {
		v = &CompactionState{RequestID: fmt.Sprintf("checkpoint-%d", cp.Covered), Trigger: trigger}
	}
	v.State, v.Code, v.Covered, v.Packet = "completed", "", cp.Covered, cp.Packet
	if !matched {
		v.First = cp.First
	}
	v.Compression, v.Updated = cp.Compression, time.Now().UTC().Format(time.RFC3339Nano)
	return v
}

func (m *AgentManager) commitContextCheckpoint(ctx context.Context, job *agentJob, a *SessionArchive, cp *Checkpoint, c *contextCompaction, trigger string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	cp.Compaction = c.completed(cp, trigger)
	if err := a.Append("checkpoint", cp); err != nil {
		return err
	}
	c.set(cp.Compaction)
	m.mu.Lock()
	job.record.Compression = cp.Compression
	err := m.saveLocked(job)
	m.mu.Unlock()
	// The checkpoint changes model context, not the user's history range or
	// reading identity. Original messages and tool receipts remain addressable.
	return err
}

// A completed checkpoint grants one edit in this live execution only. Recovery
// restores receipts, not an unused permission to mutate memory after restart.
func (c *contextCompaction) allowMemoryEdit() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.last != nil && c.last.State == "completed" && c.last.Purpose == "memory_edit" {
		c.editReady = c.last.RequestID
	}
}

func (c *contextCompaction) consumeMemoryEdit(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	exclusive, _ := ctx.Value(compactBoundaryKey{}).(bool)
	if !exclusive {
		return fmt.Errorf("记忆编辑须单独成一次回复：这次回复只能有这一个 memory 调用，不能与其他工具同批；本次未修改记忆，请单独重发")
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.last == nil || c.last.State != "completed" || c.last.Purpose != "memory_edit" || c.editReady == "" || c.editReady != c.last.RequestID {
		return fmt.Errorf("编辑记忆前必须先单独调用 memory compact，purpose=memory_edit，并等待已提交的 completed；压缩失败、取消或未缩短时保留原记忆")
	}
	history, ok := ctx.Value(memoryEditHistoryKey{}).([]Message)
	if !ok || c.last.Covered > len(history) {
		return fmt.Errorf("记忆编辑缺少当前上下文边界")
	}
	for _, message := range history[c.last.Covered:] {
		if message.Role == RoleUser && !message.ContextObservation {
			c.editReady = ""
			return fmt.Errorf("压缩后收到新输入，请在编辑记忆前重新压缩")
		}
	}
	c.editReady = ""
	return nil
}

func memoryMutation(action string) bool {
	return action == "record" || action == "update" || action == "forget" || action == "merge"
}

func (w *Workspace) editMemory(ctx context.Context, a map[string]any) (any, error) {
	c, _ := ctx.Value(contextCompactionKey{}).(*contextCompaction)
	if c == nil {
		return nil, fmt.Errorf("当前会话无法在编辑记忆前压缩")
	}
	if err := c.consumeMemoryEdit(ctx); err != nil {
		return nil, err
	}
	var result any
	var err error
	if a["action"] == "merge" {
		result, err = w.pacTool(ctx, a)
	} else {
		result, err = memoryResult(w.memory(ctx, a))
	}
	if err == nil {
		c.mu.Lock()
		c.memoryChanged = true
		c.mu.Unlock()
	}
	return result, err
}

func (c *contextCompaction) takeMemoryChange() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	changed := c.memoryChanged
	c.memoryChanged = false
	return changed
}

func compactionOutcomeMessage(v *CompactionState) Message {
	return Message{Role: RoleSystem, Name: "context_compaction_result", Content: strings.TrimSpace(runtimePrompt("Matrix/工具说明/主动压缩.txt")) + "\n" + string(rawJSON(v))}
}

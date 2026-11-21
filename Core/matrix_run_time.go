// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: cloneRunTime; checkpointRunTime; recoverRunTime; startsExecution; nestedExecutionObserverKey; observeNestedExecution; startExecution; toolStartObserver
// Impact: python -B scripts/code-atlas.py show Core/matrix_run_time.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"time"
)

func cloneRunTime(r *AgentRunTime) *AgentRunTime {
	if r == nil {
		return nil
	}
	v := *r
	v.Intervals = append([]AgentRunInterval(nil), r.Intervals...)
	return &v
}

// Called under the manager lock at existing persistence boundaries, never from
// the tool observer. Concurrent dispatch only performs an atomic first-start CAS.
func checkpointRunTime(j *agentJob, now int64, terminal bool) {
	start := j.runStarted.Load()
	if start == 0 {
		return
	}
	if j.record.RunTime == nil {
		j.record.RunTime = &AgentRunTime{}
	}
	r := j.record.RunTime
	if j.runCheckpointStart != start {
		r.Intervals = append(r.Intervals, AgentRunInterval{StartedAt: start, FinishedAt: start})
		j.runCheckpointStart = start
	}
	last := &r.Intervals[len(r.Intervals)-1]
	last.FinishedAt = max(last.FinishedAt, now)
	r.ElapsedMS = 0
	for _, interval := range r.Intervals {
		r.ElapsedMS += max(int64(0), interval.FinishedAt-interval.StartedAt)
	}
	if terminal {
		j.runStarted.Store(0)
		j.runCheckpointStart = 0
	}
}

func recoverRunTime(j *agentJob, now int64) {
	if j.record.RunTime == nil || !activeAgent(j.record.State) {
		return
	}
	j.record.RunTime.Incomplete = true
	// A restored human wait is live again now; it need not wait for the reply
	// before its next verifiable interval starts. Other work is interrupted.
	if j.record.State == "waiting_user" {
		for _, interval := range j.record.RunTime.Intervals {
			now = max(now, interval.FinishedAt)
		}
		j.runStarted.Store(now)
	}
}

// Planning, memory/context maintenance and opening tool manuals are preparation.
// Calling an opened tool is execution; a human prompt alone is not execution.
func startsExecution(call ToolCall) bool {
	switch call.Function.Name {
	case "update_plan", "memory", "compact", "team", "exec", "wait":
		return false
	case "toolbox":
		var a struct {
			Action string `json:"action"`
			Name   string `json:"name"`
		}
		return json.Unmarshal([]byte(call.Function.Arguments), &a) == nil && a.Action == "call" && a.Name != "" && a.Name != "compact" && a.Name != "human"
	default:
		return IsDisplayTool(call.Function.Name) || call.Function.Name == "apply_patch" || call.Function.Name == "web_search" || isWorkspaceTool(call.Function.Name)
	}
}

type nestedExecutionObserverKey struct{}

// Execution cells can merely prepare data. Observe their actual nested dispatch,
// not the outer cell or subsequent waits; replayed cells never reach this point.
func observeNestedExecution(ctx context.Context, call ToolCall) {
	if startsExecution(call) {
		if notify, ok := ctx.Value(nestedExecutionObserverKey{}).(func()); ok {
			notify()
		}
	}
}

func (j *agentJob) startExecution() {
	j.runStarted.CompareAndSwap(0, time.Now().UnixMilli())
}

func (j *agentJob) toolStartObserver(invocation string, calls []ToolCall) func(string) {
	execution := make(map[string]bool, len(calls))
	for _, call := range calls {
		execution[invocation+":"+call.ID] = startsExecution(call)
	}
	return func(key string) {
		j.started.Store(key, true)
		if execution[key] {
			j.startExecution()
		}
	}
}

// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: parallelFixture; TestToolTurnReallyRunsConcurrentAndKeepsPairing; TestParallelPersistenceFailureDoesNotDispatchNextBatch; TestParallelBoundariesProtectStateAndSessionIO; TestCancelledMixedTurnPreservesPlanAndDoesNotReplayEffects; TestParallelTurnKeepsActualSessionInputAndReadsOrdered; blockedShellInput; Wait; Write; Stop; Close; TestShellCancellationUnblocksFullStdin; TestIndependentToolsRefillVacantSlotBeforeSlowPeerEnds; TestMixedTurnRecoveryKeepsShellAndPlanPositions
// Impact: python -B scripts/code-atlas.py show Core/tool_parallel_test.go
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
	"sync"
	"testing"
	"time"
)

func parallelFixture(t *testing.T, count int) (*ShellManager, Message) {
	t.Helper()
	m := shellTestManager(t)
	response := Message{Role: RoleAssistant}
	for i := 0; i < count; i++ {
		req := shellTestCommand(t, "parallel")
		wait := 10000
		req.YieldTimeMS = &wait
		req.Env["AIEYRA_PARALLEL_ID"] = fmt.Sprint(i)
		args, _ := json.Marshal(req)
		response.ToolCalls = append(response.ToolCalls, ToolCall{ID: fmt.Sprintf("call-%d", i), Function: FunctionCall{Name: "exec_command", Arguments: string(args)}})
	}
	return m, response
}

func TestToolTurnReallyRunsConcurrentAndKeepsPairing(t *testing.T) {
	m, response := parallelFixture(t, 4)
	e := &PlanEngine{}
	var receipts []ToolReceipt
	turn, err := ExecuteToolTurn(context.Background(), e, m, response, "parallel", func(kind string, v any) error {
		if kind == "tool_progress" {
			receipts = append(receipts, v.(ToolReceipt))
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if err = ValidateToolTurn(turn); err != nil {
		t.Fatal(err)
	}
	for i, message := range turn.Messages[1:] {
		var r ShellResult
		if err = json.Unmarshal([]byte(message.Content), &r); err != nil {
			t.Fatal(err)
		}
		// 每个子进程都等待四个 started 文件；顺序执行必然失败，不依赖机器耗时阈值。
		if r.ExitCode == nil || *r.ExitCode != 0 || r.Output != fmt.Sprintf("result-%d", i) || message.ToolCallID != response.ToolCalls[i].ID {
			t.Fatalf("concurrent barrier/pairing failed: index=%d result=%+v", i, r)
		}
	}
	if len(receipts) != 4 {
		t.Fatal("missing per-call durable receipt")
	}
	byKey := map[string]ToolReceipt{}
	for _, receipt := range receipts {
		byKey[receipt.Key] = receipt
	}
	recovered, err := interruptedToolTurn(ToolIntent{"parallel", response}, byKey)
	if err != nil || len(recovered.Messages) != 5 {
		t.Fatal("completion order broke recovery", err)
	}
	replay, err := ExecuteToolTurn(context.Background(), e, m, response, "parallel", func(string, any) error { t.Fatal("replay persisted again"); return nil })
	if err != nil || !replay.Replayed || len(m.Snapshots()) != 4 {
		t.Fatal("parallel replay spawned again", err)
	}
}

func TestParallelPersistenceFailureDoesNotDispatchNextBatch(t *testing.T) {
	m, response := parallelFixture(t, 5)
	saved := 0
	e := &PlanEngine{}
	_, err := ExecuteToolTurn(context.Background(), e, m, response, "save-fails", func(kind string, v any) error {
		if kind == "tool_progress" {
			saved++
			if saved == 1 {
				return errors.New("injected write failure")
			}
		}
		return nil
	})
	if err == nil || saved != 4 || len(e.Receipts) != 0 {
		t.Fatalf("failure boundary: err=%v receipts=%d", err, saved)
	}
	if _, err := os.Stat(filepath.Join(m.root, "4.started")); !os.IsNotExist(err) {
		t.Fatal("dispatched following side effect after persistence failure")
	}
}

func TestParallelBoundariesProtectStateAndSessionIO(t *testing.T) {
	call := func(name, args string) ToolCall { return ToolCall{Function: FunctionCall{Name: name, Arguments: args}} }
	calls := []ToolCall{
		call("exec_command", `{"cmd":"read"}`), call("exec_command", `{"cmd":"read"}`),
		call("exec_command", `{"cmd":"write","parallel":false}`),
		call("update_plan", `{}`),
		call("write_stdin", `{"session_id":1,"chars":"a"}`), call("read_shell_output", `{"session_id":2}`),
		call("write_stdin", `{"session_id":1,"chars":"b"}`),
	}
	for start, want := range map[int]int{0: 2, 2: 3, 3: 4, 4: 6, 6: 7} {
		if got := parallelToolBatchEnd(calls, start); got != want {
			t.Fatalf("unsafe batch %d..%d, expected end %d", start, got, want)
		}
	}
	m, response := parallelFixture(t, 4)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	turn, err := ExecuteToolTurn(ctx, &PlanEngine{}, m, response, "cancel-before-start", func(string, any) error { return nil })
	if err != nil || len(turn.Messages) != 5 || len(m.Snapshots()) != 0 {
		t.Fatal("cancelled batch started a process", err)
	}
}

func TestCancelledMixedTurnPreservesPlanAndDoesNotReplayEffects(t *testing.T) {
	for _, beforeStart := range []bool{true, false} {
		t.Run(fmt.Sprintf("before_start_%t", beforeStart), func(t *testing.T) {
			m := shellTestManager(t)
			e := &PlanEngine{State: initialPlan(t)}
			original := ClonePlan(e.State)
			req := shellTestCommand(t, "file")
			wait := 30000
			req.YieldTimeMS = &wait
			args, _ := json.Marshal(req)
			response := Message{Role: RoleAssistant, ToolCalls: []ToolCall{
				{ID: "first", Function: FunctionCall{Name: "exec_command", Arguments: string(args)}},
				{ID: "plan", Function: FunctionCall{Name: "update_plan", Arguments: `{"action":"update","expected_revision":1,"changes":[{"op":"revise","step_id":"p1","text":"不应应用此修订","reason":"测试取消边界"}]}`}},
				{ID: "later", Function: FunctionCall{Name: "exec_command", Arguments: string(args)}},
			}}
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			if beforeStart {
				cancel()
			}
			turn, err := ExecuteToolTurn(ctx, e, m, response, "cancel-mixed", func(kind string, value any) error {
				if kind == "tool_progress" {
					cancel()
				}
				return nil
			})
			if err != nil {
				t.Fatal(err)
			}
			if err = ValidateToolTurn(turn); err != nil {
				t.Fatal(err)
			}
			var plan PlanToolResult
			if err = json.Unmarshal([]byte(turn.Messages[2].Content), &plan); err != nil || plan.OK || plan.Error == nil || plan.Error.Code != "cancelled" || plan.Revision != original.Revision || plan.PlanID != original.ID || plan.State == nil {
				t.Fatalf("cancelled plan lost its state/version: %+v, %v", plan, err)
			}
			if e.State.Revision != original.Revision || e.State.Phases[0].Steps[0].Text != original.Phases[0].Steps[0].Text || turn.Receipts[1].Transition != nil {
				t.Fatal("cancellation mutated the plan")
			}
			var last ShellResult
			if err = json.Unmarshal([]byte(turn.Messages[3].Content), &last); err != nil || last.State != "cancelled" || last.SessionID != 0 {
				t.Fatal("cancelled next batch started a process", err, last)
			}
			replay, err := ExecuteToolTurn(context.Background(), e, m, response, "cancel-mixed", func(string, any) error { t.Fatal("replayed cancelled turn wrote again"); return nil })
			if err != nil || !replay.Replayed {
				t.Fatal("cancelled receipts were not idempotent", err)
			}
			data, readErr := os.ReadFile(filepath.Join(m.root, "effect.txt"))
			if beforeStart {
				if !os.IsNotExist(readErr) || len(m.Snapshots()) != 0 {
					t.Fatal("pre-cancelled turn caused effects")
				}
			} else if readErr != nil || string(data) != "once\n" || len(m.Snapshots()) != 1 {
				t.Fatal("cancelled/replayed turn repeated a side effect", readErr, string(data))
			}
		})
	}
}

func TestParallelTurnKeepsActualSessionInputAndReadsOrdered(t *testing.T) {
	m := shellTestManager(t)
	req := shellTestCommand(t, "input_lines")
	zero := 0
	req.YieldTimeMS = &zero
	started := m.start(context.Background(), req)
	if !started.OK || started.SessionID == 0 {
		t.Fatal("input fixture did not start", started)
	}
	response := Message{Role: RoleAssistant}
	appendCall := func(name string, args any) {
		data, _ := json.Marshal(args)
		response.ToolCalls = append(response.ToolCalls, ToolCall{ID: fmt.Sprint(len(response.ToolCalls)), Function: FunctionCall{Name: name, Arguments: string(data)}})
	}
	wait := 30000
	appendCall("write_stdin", ShellInput{SessionID: started.SessionID, Chars: "first\n", YieldTimeMS: &wait})
	appendCall("read_shell_output", ShellRead{SessionID: started.SessionID})
	appendCall("write_stdin", ShellInput{SessionID: started.SessionID, Chars: "second\nquit\n", YieldTimeMS: &wait})
	appendCall("read_shell_output", ShellRead{SessionID: started.SessionID})
	turn, err := ExecuteToolTurn(context.Background(), &PlanEngine{}, m, response, "session-io", func(string, any) error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	if err = ValidateToolTurn(turn); err != nil {
		t.Fatal(err)
	}
	for i, message := range turn.Messages[1:] {
		var r ShellResult
		if err = json.Unmarshal([]byte(message.Content), &r); err != nil || !r.OK || r.SessionID != started.SessionID {
			t.Fatal("session call failed", i, r, err)
		}
		if i < 2 && (!strings.Contains(r.Output, "INPUT=first") || strings.Contains(r.Output, "INPUT=second")) {
			t.Fatal("following input ran before the first read", i, r.Output)
		}
		if i == 2 && (!strings.Contains(r.Output, "INPUT=second") || strings.Contains(r.Output, "INPUT=first")) {
			t.Fatal("stdin output repeated or input order changed", r.Output)
		}
		if i == 3 && (!strings.Contains(r.Output, "INPUT=first") || !strings.Contains(r.Output, "INPUT=second") || strings.Index(r.Output, "INPUT=first") > strings.Index(r.Output, "INPUT=second")) {
			t.Fatal("saved log did not preserve ordered inputs", r.Output)
		}
	}
	finished := shellDone(t, m, m.input(context.Background(), ShellInput{SessionID: started.SessionID}))
	if finished.ExitCode == nil || *finished.ExitCode != 0 || len(m.Snapshots()) != 1 {
		t.Fatal("session continuation restarted a process", finished)
	}
}

// 可控的满管道：先确认 Write 已阻塞再取消，不依赖睡眠碰运气。
type blockedShellInput struct {
	entered, stopped chan struct{}
	once             sync.Once
}

func (p *blockedShellInput) Wait() (int, error) { <-p.stopped; return 1, nil }
func (p *blockedShellInput) Write([]byte) (int, error) {
	close(p.entered)
	<-p.stopped
	return 0, errors.New("closed input")
}
func (p *blockedShellInput) Stop() error { p.once.Do(func() { close(p.stopped) }); return nil }
func (p *blockedShellInput) Close()      { _ = p.Stop() }

func TestShellCancellationUnblocksFullStdin(t *testing.T) {
	p := &blockedShellInput{entered: make(chan struct{}), stopped: make(chan struct{})}
	j := &shellJob{process: p, result: ShellResult{OK: true, SessionID: 1, State: "running"}}
	m := &ShellManager{jobs: map[int]*shellJob{1: j}}
	defer p.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	returned := make(chan ShellResult, 1)
	go func() { returned <- m.input(ctx, ShellInput{SessionID: 1, Chars: "pending input"}) }()
	select {
	case <-p.entered:
	case <-time.After(3 * time.Second):
		t.Fatal("input never reached the pipe")
	}
	cancel()
	select {
	case r := <-returned:
		if r.State != "cancelled" || r.SessionID != 1 {
			t.Fatal("blocked input did not retain its cancelled session", r)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("full stdin prevented cancellation from returning")
	}
}

func TestIndependentToolsRefillVacantSlotBeforeSlowPeerEnds(t *testing.T) {
	m, response := parallelFixture(t, 6)
	for i := range response.ToolCalls {
		var req ShellCommand
		_ = json.Unmarshal([]byte(response.ToolCalls[i].Function.Arguments), &req)
		req.Cmd = shellTestCommand(t, "rolling").Cmd
		data, _ := json.Marshal(req)
		response.ToolCalls[i].Function.Arguments = string(data)
	}
	started := time.Now()
	turn, err := ExecuteToolTurn(context.Background(), &PlanEngine{}, m, response, "rolling", func(string, any) error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	for i, message := range turn.Messages[1:] {
		var r ShellResult
		if err = json.Unmarshal([]byte(message.Content), &r); err != nil || r.ExitCode == nil || *r.ExitCode != 0 || r.Output != fmt.Sprintf("result-%d", i) {
			t.Fatalf("slot refill/pairing: %d %+v %v", i, r, err)
		}
	}
	t.Logf("六项真实命令，慢首项由第五项启动释放，耗时 %s", time.Since(started))
}

func TestMixedTurnRecoveryKeepsShellAndPlanPositions(t *testing.T) {
	m := shellTestManager(t)
	req := shellTestCommand(t, "file")
	wait := 30000
	req.YieldTimeMS = &wait
	cmd, _ := json.Marshal(req)
	plan, _ := json.Marshal(samplePlanUpdate())
	response := Message{Role: RoleAssistant, ToolCalls: []ToolCall{
		{ID: "before", Function: FunctionCall{Name: "exec_command", Arguments: string(cmd)}},
		{ID: "plan", Function: FunctionCall{Name: "update_plan", Arguments: string(plan)}},
		{ID: "after", Function: FunctionCall{Name: "exec_command", Arguments: string(cmd)}},
	}}
	turn, err := ExecuteToolTurn(context.Background(), &PlanEngine{}, m, response, "order", func(string, any) error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	restored := &RestoredSession{}
	if err = restored.applyToolTurn(turn); err != nil {
		t.Fatal(err)
	}
	if len(restored.ShellHistory[2]) != 1 || len(restored.PlanHistory[3]) != 1 || len(restored.ShellHistory[4]) != 1 {
		t.Fatal("recovery collected all plan/shell events at end of response")
	}
}

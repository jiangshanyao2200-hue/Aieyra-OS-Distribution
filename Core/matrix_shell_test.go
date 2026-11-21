// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: terminalToolAnswer; awaitTerminalExit; TestMatrixBackgroundTerminalSurvivesTurnsAndCloses; TestTerminalBackgroundNoticeStableAndPrivate; TestWindowsTerminalEnvironmentUsesSystemDesktop; TestMatrixForegroundTerminalCannotMasqueradeAsDelivery; TestMatrixUnfinishedExecutionCannotMasqueradeAsDelivery; TestMatrixBackgroundTerminalHumanPauseAndResume; TestMatrixBackgroundTerminalHumanCancelAndExpiry
// Impact: python -B scripts/code-atlas.py show Core/matrix_shell_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"runtime"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func terminalToolAnswer(w http.ResponseWriter, n int, command ShellCommand) {
	fixtureAnswer(w, fmt.Sprint("terminal", n), "", []any{map[string]any{"type": "function_call", "id": fmt.Sprint("terminal_", n), "call_id": fmt.Sprint("terminal_call_", n), "name": "exec_command", "arguments": string(rawJSON(command))}})
}

func awaitTerminalExit(t *testing.T, job *shellJob) {
	t.Helper()
	select {
	case <-job.done:
	case <-time.After(7 * time.Second):
		t.Fatal("owned terminal did not exit")
	}
}

func TestMatrixBackgroundTerminalSurvivesTurnsAndCloses(t *testing.T) {
	for _, tty := range []bool{false, true} {
		t.Run(fmt.Sprint("tty=", tty), func(t *testing.T) {
			command := shellTestCommand(t, "input_lines")
			zero := 0
			command.Background, command.TTY, command.YieldTimeMS, command.TimeoutMS = true, tty, &zero, &zero
			var requests atomic.Int32
			m, dir := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
				var body map[string]any
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Error(err)
				}
				n := int(requests.Add(1))
				if n == 1 {
					terminalToolAnswer(w, n, command)
					return
				}
				wire := string(rawJSON(body))
				if !strings.Contains(wire, "Retained background session observations") || !strings.Contains(wire, `\"generation\":1`) {
					t.Error("live original-generation background receipt missing from next model request")
				}
				fixtureAnswer(w, fmt.Sprint("done", n), "Interactive terminal remains running; its command is not complete.", nil)
			})
			r, err := m.Create(context.Background(), testMatrixOwner, AgentSpec{RequestID: "terminal-lifetime", ModelID: "local-model", Task: "keep a terminal available", Workdir: dir, Tools: []string{"exec_command", "write_stdin"}})
			if err != nil {
				t.Fatal(err)
			}
			r, err = m.Wait(context.Background(), testMatrixOwner, r.ID, 10000)
			if err != nil || r.State != "completed" {
				t.Fatal(r.State, r.Error, err)
			}
			shell := m.jobs[r.ID].shell
			rows := shell.Snapshots()
			if len(rows) != 1 || rows[0].State != "running" || !rows[0].Background || rows[0].Generation != 1 {
				t.Fatal(rows)
			}
			job := shell.job(rows[0].SessionID)
			_, activities := activityPage(t, m, r.ID, 0)
			found := false
			for _, activity := range activities {
				if activity.Session == rows[0].SessionID && activity.Tool == "exec_command" {
					found = true
					if activity.State != "running" {
						t.Fatalf("live background terminal projected as %s", activity.State)
					}
				}
			}
			if !found {
				t.Fatal("background terminal missing from activity")
			}
			if _, err = m.SendGeneration(testMatrixOwner, r.ID, "second-turn", "show the same terminal", 1); err != nil {
				t.Fatal(err)
			}
			r, err = m.Wait(context.Background(), testMatrixOwner, r.ID, 10000)
			if err != nil || r.State != "completed" || r.Generation != 2 || m.jobs[r.ID].shell != shell {
				t.Fatal(r.State, r.Error, err)
			}
			// 后台常驻一律是交互式终端（UI设计知识库 形态 §15 K2），即使模型没写 tty。
			if !rows[0].TTY {
				t.Fatal("background session must run in a terminal")
			}
			job.userInput(context.Background(), workspaceTerminalRequest{RequestID: "after-second-turn", Chars: "second-turn-input", PressEnter: true})
			if result := waitTerminalInput(t, job); result.InputState != "written" || result.Generation != 1 || result.State != "running" {
				t.Fatal(result)
			}
			deadline := time.Now().Add(5 * time.Second)
			for !strings.Contains(shell.read(ShellRead{SessionID: rows[0].SessionID}).Output, "INPUT=second-turn-input") {
				if time.Now().After(deadline) {
					t.Fatal("retained terminal lost stdin")
				}
				time.Sleep(10 * time.Millisecond)
			}
			if tty {
				m.Close()
			} else if err = m.CancelGeneration(testMatrixOwner, r.ID, 2); err != nil {
				t.Fatal(err)
			}
			awaitTerminalExit(t, job)
			if result := job.snapshot(1000, false); result.State != "cancelled" || result.ExitCode == nil {
				t.Fatal(result)
			}
		})
	}
}

func TestTerminalBackgroundNoticeStableAndPrivate(t *testing.T) {
	m := shellTestManager(t)
	contract := m.Environment()
	if m.BackgroundNotice() != "" {
		t.Fatal("empty runtime invented a background session")
	}
	m.jobs[7] = &shellJob{result: ShellResult{SessionID: 7, Generation: 1, State: "running", Background: true, TTY: true, PrivateOutput: true, InputState: "written", Cmd: "do-not-echo-command", Output: "do-not-echo-output"}, tail: []byte("do-not-echo-tail")}
	notice := m.BackgroundNotice()
	for _, expected := range []string{`"session_id":7`, `"generation":1`, `"state":"running"`, `"private_output":true`} {
		if !strings.Contains(notice, expected) {
			t.Fatal(notice)
		}
	}
	if strings.Contains(notice, "do-not-echo") {
		t.Fatal("private payload exposed in runtime notice")
	}
	if m.Environment() != contract || m.BackgroundNotice() != notice {
		t.Fatal("unchanged runtime destabilized request prefix or observation")
	}
	// 合成记录没有可关闭的进程；清理前移除，不触碰运行时生命周期。
	delete(m.jobs, 7)
}

func TestWindowsTerminalEnvironmentUsesSystemDesktop(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("Windows known folder resolution")
	}
	m := shellTestManager(t)
	r := shellDone(t, m, m.start(context.Background(), ShellCommand{Cmd: `[Environment]::GetFolderPath('Desktop')`}))
	desktop := strings.TrimSpace(r.Output)
	if !r.OK || r.ExitCode == nil || *r.ExitCode != 0 || desktop == "" {
		t.Fatalf("Windows Desktop lookup: %+v", r)
	}
	contract := m.Environment()
	if !strings.Contains(contract, "Desktop directory resolved by Windows: "+string(rawJSON(desktop))) {
		t.Fatal("terminal environment missing the current Windows Desktop directory")
	}
	observations := []Message{{Role: RoleSystem, Name: "aieyra_shell_runtime", Content: contract}}
	if updates := runtimeContextDelta(observations, []Message{{Role: RoleSystem, Name: "aieyra_shell_runtime", Content: m.Environment()}}); len(updates.Messages) != 0 {
		t.Fatal("stable terminal environment produced a duplicate request observation")
	}
}

func TestMatrixForegroundTerminalCannotMasqueradeAsDelivery(t *testing.T) {
	command := shellTestCommand(t, "input_lines")
	zero := 0
	command.YieldTimeMS = &zero
	var requests atomic.Int32
	m, dir := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
		if n := int(requests.Add(1)); n == 1 {
			terminalToolAnswer(w, n, command)
			return
		}
		fixtureAnswer(w, "false-delivery", "done", nil)
	})
	r, err := m.Create(context.Background(), testMatrixOwner, AgentSpec{RequestID: "foreground-boundary", ModelID: "local-model", Task: "run command", Workdir: dir, Tools: []string{"exec_command"}})
	if err != nil {
		t.Fatal(err)
	}
	r, err = m.Wait(context.Background(), testMatrixOwner, r.ID, 10000)
	if err != nil || r.State != "failed" || !strings.Contains(r.Error, "shell process was still running") {
		t.Fatal(r.State, r.Error, err)
	}
	if r.Failure == nil || r.Failure.Code != "unfinished_shell" || r.Failure.Origin != "local" || r.Failure.Retryable {
		t.Fatalf("unfinished foreground terminal misclassified: %+v", r.Failure)
	}
	if requests.Load() != 2 {
		t.Fatal("unfinished command replayed inference", requests.Load())
	}
	shell := m.jobs[r.ID].shell
	rows := shell.Snapshots()
	if len(rows) != 1 || rows[0].Generation != r.Generation || rows[0].Background {
		t.Fatal("original foreground receipt missing", rows)
	}
	job := shell.job(rows[0].SessionID)
	awaitTerminalExit(t, job)
	if result := job.snapshot(1000, false); result.State != "cancelled" || result.ExitCode == nil {
		t.Fatal("unfinished owned command not cancelled", result)
	}
}

func TestMatrixUnfinishedExecutionCannotMasqueradeAsDelivery(t *testing.T) {
	zero := 0
	var requests atomic.Int32
	m, dir := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
		if requests.Add(1) == 1 {
			// The isolated VM exposes promises but no host timers. Using
			// setTimeout races its ReferenceError against the delivery check.
			// Keep real work pending until the owner cancels this execution.
			call := executionCall("exec", ExecRequest{Code: `text("execution pending"); await new Promise(() => {}); text("unreachable");`, YieldTimeMS: &zero})
			fixtureAnswer(w, "unfinished-cell", "", []any{map[string]any{"type": "function_call", "id": "cell-tool", "call_id": call.ID, "name": call.Function.Name, "arguments": call.Function.Arguments}})
			return
		}
		fixtureAnswer(w, "false-cell-delivery", "done", nil)
	})
	r, err := m.Create(context.Background(), testMatrixOwner, AgentSpec{RequestID: "execution-boundary", ModelID: "local-model", Task: "wait for execution", Workdir: dir, Tools: []string{"exec", "wait"}})
	if err != nil {
		t.Fatal(err)
	}
	r, err = m.Wait(context.Background(), testMatrixOwner, r.ID, 10000)
	if err != nil || r.State != "failed" || !strings.Contains(r.Error, "execution cell was still running") {
		t.Fatal(r.State, r.Error, err, m.jobs[r.ID].shell.ExecutionSnapshots())
	}
	if r.Failure == nil || r.Failure.Code != "unfinished_execution" || r.Failure.Origin != "local" || r.Failure.Retryable {
		t.Fatalf("unfinished execution misclassified: %+v", r.Failure)
	}
	if requests.Load() != 4 {
		t.Fatal("unfinished execution must stop after two recovery opportunities", requests.Load())
	}
	shell := m.jobs[r.ID].shell
	rows := shell.ExecutionSnapshots()
	if len(rows) != 1 {
		t.Fatal("original execution receipt missing", rows)
	}
	shell.execution.mu.Lock()
	cell := shell.execution.cells[rows[0].CellID]
	shell.execution.mu.Unlock()
	select {
	case <-cell.done:
	case <-time.After(7 * time.Second):
		t.Fatal("unfinished owned execution did not exit")
	}
	if result := shell.ExecutionSnapshots()[0]; result.State != "cancelled" {
		t.Fatal("unfinished owned execution not cancelled", result)
	}
}

func TestMatrixBackgroundTerminalHumanPauseAndResume(t *testing.T) {
	command := shellTestCommand(t, "input_lines")
	zero := 0
	command.Background, command.YieldTimeMS = true, &zero
	var requests atomic.Int32
	m, dir := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
		n := int(requests.Add(1))
		switch n {
		case 1:
			terminalToolAnswer(w, n, command)
		case 2:
			humanToolAnswer(w, n, "open", nil)
		case 3:
			humanToolAnswer(w, n, "call", humanTestQuestion())
		default:
			var body any
			_ = json.NewDecoder(r.Body).Decode(&body)
			if !strings.Contains(string(rawJSON(body)), "decision-1") {
				t.Error("human decision lost")
			}
			fixtureAnswer(w, "resumed", "Report complete; terminal remains available.", nil)
		}
	})
	r, err := m.Create(context.Background(), testMatrixOwner, AgentSpec{RequestID: "terminal-human", ModelID: "local-model", Task: "keep interactive session while asking report format", Workdir: dir, Tools: []string{"exec_command", "human"}})
	if err != nil {
		t.Fatal(err)
	}
	r, err = m.Wait(context.Background(), testMatrixOwner, r.ID, 10000)
	if err != nil || r.State != "waiting_user" || len(r.HumanRequests) != 1 {
		t.Fatal(r.State, r.Error, err)
	}
	shell := m.jobs[r.ID].shell
	job := shell.job(shell.Snapshots()[0].SessionID)
	if result := job.snapshot(1000, false); result.State != "running" {
		t.Fatal("human wait killed background terminal", result)
	}
	if _, err = m.ReplyHuman(testMatrixOwner, humanTestReply(r)); err != nil {
		t.Fatal(err)
	}
	r, err = m.Wait(context.Background(), testMatrixOwner, r.ID, 10000)
	if err != nil || r.State != "completed" || r.Generation != 1 || m.jobs[r.ID].shell != shell {
		t.Fatal(r.State, r.Error, err)
	}
	if result := job.snapshot(1000, false); result.State != "running" {
		t.Fatal("human resume replaced terminal", result)
	}
	m.Close()
	awaitTerminalExit(t, job)
}

func TestMatrixBackgroundTerminalHumanCancelAndExpiry(t *testing.T) {
	for _, mode := range []string{"cancel", "expire"} {
		t.Run(mode, func(t *testing.T) {
			m, r, requests := waitingHuman(t)
			m.mu.Lock()
			owner := m.jobs[r.ID]
			m.mu.Unlock()
			shell, err := m.shellForRun(owner, r)
			if err != nil {
				t.Fatal(err)
			}
			command := shellTestCommand(t, "input_lines")
			zero := 0
			command.Background, command.YieldTimeMS = true, &zero
			started := shell.start(context.Background(), command)
			if started.State != "running" {
				t.Fatal(started)
			}
			if mode == "cancel" {
				if err = m.CancelGeneration(testMatrixOwner, r.ID, r.Generation); err != nil {
					t.Fatal(err)
				}
			} else {
				m.mu.Lock()
				owner.record.HumanRequests[0].ExpiresAt = time.Now().Add(-time.Second).UTC().Format(time.RFC3339Nano)
				m.mu.Unlock()
				if _, err = m.HumanStatus(testMatrixOwner, r.HumanRequests[0].ID); err != nil {
					t.Fatal(err)
				}
			}
			awaitTerminalExit(t, shell.job(started.SessionID))
			if _, err = m.ReplyHuman(testMatrixOwner, humanTestReply(r)); err == nil {
				t.Fatal("closed human request resumed")
			}
			if requests.Load() != 2 {
				t.Fatal("closed human request replayed inference")
			}
		})
	}
}

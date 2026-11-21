// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: waitTerminalInput; TestWorkspaceTerminalInputIndependentCursorAndDisconnect; TestWorkspaceTerminalPrivateInputSuppressesRealEcho; TestWorkspaceTerminalScopesAndGeneration; TestWorkspaceTerminalBlockedInputAndDurableIntent; TestWorkspaceTerminalPersistenceFailureDoesNotSend
// Impact: python -B scripts/code-atlas.py show Core/workspace_terminals_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func waitTerminalInput(t *testing.T, j *shellJob) ShellResult {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		j.mu.Lock()
		r := j.result
		j.mu.Unlock()
		if r.InputState != "pending" {
			return r
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("user input did not settle")
	return ShellResult{}
}

func TestWorkspaceTerminalInputIndependentCursorAndDisconnect(t *testing.T) {
	m := shellTestManager(t)
	m.generation = 3
	zero := 0
	command := shellTestCommand(t, "input_lines")
	command.YieldTimeMS = &zero
	r := m.start(context.Background(), command)
	if !r.OK {
		t.Fatal(r)
	}
	j := m.job(r.SessionID)
	j.mu.Lock()
	cursor := j.cursor
	j.mu.Unlock()
	ctx, cancel := context.WithCancel(context.Background())
	request := workspaceTerminalRequest{RequestID: "ui-input", Chars: "view-input\n"}
	accepted := j.userInput(ctx, request)
	if accepted.InputState != "pending" {
		t.Fatal(accepted)
	}
	cancel()
	if done := waitTerminalInput(t, j); done.InputState != "written" {
		t.Fatal(done)
	}
	deadline := time.Now().Add(5 * time.Second)
	for {
		r = m.read(ShellRead{SessionID: r.SessionID, MaxOutputTokens: 1000})
		if strings.Contains(r.Output, "INPUT=view-input") {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("input not received", r)
		}
		time.Sleep(10 * time.Millisecond)
	}
	j.mu.Lock()
	unchanged := j.cursor == cursor
	state := j.result.State
	j.mu.Unlock()
	if !unchanged || state != "running" {
		t.Fatal("view consumed cursor or disconnected process", unchanged, state)
	}
	if duplicate := j.userInput(context.Background(), request); duplicate.InputState != "written" {
		t.Fatal(duplicate)
	}
	if stopped := j.userInput(context.Background(), workspaceTerminalRequest{Terminate: true}); stopped.State != "cancelled" {
		t.Fatal(stopped)
	}
	select {
	case <-j.done:
	case <-time.After(5 * time.Second):
		t.Fatal("explicit stop did not settle")
	}
	r = m.read(ShellRead{SessionID: r.SessionID, MaxOutputTokens: 1000})
	if strings.Count(r.Output, "INPUT=view-input") != 1 {
		t.Fatal("input retried", r.Output)
	}
	model := j.snapshot(1000, true)
	if !strings.Contains(model.Output, "INPUT=view-input") {
		t.Fatal("model lost unread output", model)
	}
}

func TestWorkspaceTerminalPrivateInputSuppressesRealEcho(t *testing.T) {
	for _, tty := range []bool{false, true} {
		t.Run(fmt.Sprintf("tty=%v", tty), func(t *testing.T) {
			m := shellTestManager(t)
			m.generation = 1
			zero := 0
			command := shellTestCommand(t, "input_lines")
			command.TTY = tty
			command.YieldTimeMS = &zero
			r := m.start(context.Background(), command)
			if !r.OK {
				t.Fatal(r)
			}
			j := m.job(r.SessionID)
			secret := "private-synthetic-secret-中文"
			chars := secret
			if !tty {
				chars += "\n"
			}
			accepted := j.userInput(context.Background(), workspaceTerminalRequest{RequestID: "private-test", Chars: chars, PressEnter: tty, Private: true})
			if !accepted.PrivateOutput || accepted.InputState != "pending" {
				t.Fatal(accepted)
			}
			if waitTerminalInput(t, j).InputState != "written" {
				t.Fatal("input failed")
			}
			quit := "quit"
			if !tty {
				quit += "\n"
			}
			j.userInput(context.Background(), workspaceTerminalRequest{RequestID: "quit", Chars: quit, PressEnter: tty})
			if waitTerminalInput(t, j).InputState != "written" {
				t.Fatal("quit failed")
			}
			select {
			case <-j.done:
			case <-time.After(7 * time.Second):
				t.Fatal("private terminal failed to exit")
			}
			if state := j.snapshot(1000, false); state.ExitCode == nil || *state.ExitCode != 0 || !state.PrivateOutput || strings.Contains(state.Output, secret) {
				t.Fatal(state)
			}
			files, err := os.ReadDir(m.dir)
			if err != nil {
				t.Fatal(err)
			}
			for _, file := range files {
				if file.IsDir() {
					continue
				}
				data, err := os.ReadFile(filepath.Join(m.dir, file.Name()))
				if err != nil {
					t.Fatal(err)
				}
				if strings.Contains(string(data), secret) || strings.Contains(string(data), "INPUT=quit") {
					t.Fatal("sensitive echo saved", file.Name())
				}
			}
			restored, err := NewShellManager(m.root, m.dir)
			if err != nil {
				t.Fatal(err)
			}
			defer restored.Close()
			if !restored.job(r.SessionID).snapshot(1000, false).PrivateOutput {
				t.Fatal("private mode lost on reload")
			}
		})
	}
}

func TestWorkspaceTerminalScopesAndGeneration(t *testing.T) {
	w, _ := testWorkspace(t, func(http.ResponseWriter, *http.Request) { t.Error("terminal projection must not call models") })
	m := shellTestManager(t)
	m.generation = 2
	r := shellDone(t, m, m.start(context.Background(), shellTestCommand(t, "output")))
	old := m.job(r.SessionID)
	m.generation = 1
	prior := shellDone(t, m, m.start(context.Background(), shellTestCommand(t, "output")))
	m.generation = 2
	id, foreign := workspaceID(), workspaceID()
	done := make(chan struct{})
	close(done)
	w.mu.Lock()
	w.state.Roles[WorkspaceMatrix] = id
	w.mu.Unlock()
	w.manager.mu.Lock()
	w.manager.jobs[id] = &agentJob{record: AgentRecord{ID: id, Parent: w.state.ID, Generation: 2, State: "completed", Spec: AgentSpec{WorkspaceRole: WorkspaceMatrix}}, shell: m, done: done}
	w.manager.jobs[foreign] = &agentJob{record: AgentRecord{ID: foreign, Parent: "outside", Generation: 2}, shell: m, done: done}
	w.manager.mu.Unlock()
	req := workspaceTerminalRequest{TaskID: w.state.ID, AgentID: id, Generation: 2, SessionID: r.SessionID}
	call := func(action string, p workspaceTerminalRequest) (map[string]any, error) {
		v, err := w.Call(context.Background(), action, rawJSON(p))
		if err != nil {
			return nil, err
		}
		return v.(map[string]any), nil
	}
	value, err := call("workspace.terminals", req)
	if err != nil {
		t.Fatal(err)
	}
	rows := value["sessions"].([]any)
	if len(rows) != 1 || int(rows[0].(map[string]any)["session_id"].(float64)) != r.SessionID {
		t.Fatal("old generation leaked", value)
	}
	if _, ok := rows[0].(map[string]any)["output_ref"]; ok {
		t.Fatal("raw log path leaked")
	}
	old.mu.Lock()
	cursor := old.cursor
	old.mu.Unlock()
	if value, err = call("workspace.terminal_read", req); err != nil || !strings.Contains(string(rawJSON(value)), "stdout 中文") {
		t.Fatal(value, err)
	}
	old.mu.Lock()
	same := old.cursor == cursor
	old.mu.Unlock()
	if !same {
		t.Fatal("UI read stole model cursor")
	}
	for _, change := range []func(*workspaceTerminalRequest){
		func(p *workspaceTerminalRequest) { p.Generation = 1 },
		func(p *workspaceTerminalRequest) { p.SessionGeneration = 9 },
		func(p *workspaceTerminalRequest) { p.AgentID = foreign },
		func(p *workspaceTerminalRequest) { p.TaskID = foreign; p.AgentID = foreign },
		func(p *workspaceTerminalRequest) { p.TaskID = "" },
		func(p *workspaceTerminalRequest) { p.SessionID = prior.SessionID },
	} {
		p := req
		change(&p)
		for _, action := range []string{"workspace.terminal_read", "workspace.terminal_input", "workspace.terminal_resize"} {
			if _, err := call(action, p); err == nil {
				t.Fatal("invalid terminal scope accepted", action, p)
			}
		}
	}
	// A retained session is visible across turns only with an explicit original
	// session generation. The current task generation is still mandatory.
	priorJob := m.job(prior.SessionID)
	priorJob.mu.Lock()
	priorJob.result.Background = true
	priorJob.mu.Unlock()
	p := req
	p.SessionID = prior.SessionID
	if _, err := call("workspace.terminal_read", p); err == nil {
		t.Fatal("old background terminal accepted without original generation")
	}
	p.SessionGeneration = 1
	if value, err := call("workspace.terminal_read", p); err != nil || value["result"].(map[string]any)["generation"] != float64(1) {
		t.Fatal("retained terminal original identity lost", value, err)
	}
	value, err = call("workspace.terminals", req)
	if err != nil || len(value["sessions"].([]any)) != 2 {
		t.Fatal("background session disappeared across turns", value, err)
	}
	old.mu.Lock()
	old.result.InputID = "known"
	old.result.InputState = "written"
	old.mu.Unlock()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err = w.Call(ctx, "workspace.terminal_input", json.RawMessage(rawJSON(req))); err == nil {
		t.Fatal("cancelled request accepted")
	}
	w.manager.mu.Lock()
	w.manager.jobs[id].record.Generation = 3
	w.manager.mu.Unlock()
	req.Generation = 3
	value, err = call("workspace.terminals", req)
	if err != nil || len(value["sessions"].([]any)) != 1 {
		t.Fatal("generation change lost retained terminal or exposed foreground session", value, err)
	}
	retained := value["sessions"].([]any)[0].(map[string]any)
	if retained["session_id"] != float64(prior.SessionID) || retained["generation"] != float64(1) || retained["background"] != true {
		t.Fatal("retained terminal identity changed", retained)
	}
}

func TestWorkspaceTerminalBlockedInputAndDurableIntent(t *testing.T) {
	m := shellTestManager(t)
	p := &blockedShellInput{entered: make(chan struct{}), stopped: make(chan struct{})}
	defer p.Close()
	j := &shellJob{manager: m, process: p, result: ShellResult{OK: true, SessionID: 101, Generation: 2, State: "running"}}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	request := workspaceTerminalRequest{RequestID: "blocked-input", Chars: "synthetic-private-input", Private: true}
	if r := j.userInput(ctx, request); r.InputState != "pending" {
		t.Fatal(r)
	}
	select {
	case <-p.entered:
	case <-time.After(3 * time.Second):
		t.Fatal("write did not begin")
	}
	cancel()
	select {
	case <-p.stopped:
		t.Fatal("view cancellation stopped the process")
	default:
	}
	if r := j.userInput(context.Background(), request); r.InputState != "pending" {
		t.Fatal(r)
	}
	if r := j.userInput(context.Background(), workspaceTerminalRequest{RequestID: "another", Chars: "x"}); r.Error == nil || r.Error.Code != "input_pending" {
		t.Fatal(r)
	}
	restored, err := NewShellManager(m.root, m.dir)
	if err != nil {
		t.Fatal(err)
	}
	defer restored.Close()
	r := restored.job(101).snapshot(100, false)
	if r.InputState != "unknown" || r.InputID != request.RequestID || !r.PrivateOutput {
		t.Fatal(r)
	}
	if r := j.userInput(context.Background(), workspaceTerminalRequest{Terminate: true}); r.State != "cancelled" {
		t.Fatal(r)
	}
	if r := waitTerminalInput(t, j); r.InputState != "failed" {
		t.Fatal(r)
	}
}

func TestWorkspaceTerminalPersistenceFailureDoesNotSend(t *testing.T) {
	m := shellTestManager(t)
	p := &blockedShellInput{entered: make(chan struct{}), stopped: make(chan struct{})}
	defer p.Close()
	m.dir = filepath.Join(m.dir, "does-not-exist")
	j := &shellJob{manager: m, process: p, result: ShellResult{OK: true, SessionID: 1, State: "running"}}
	if r := j.userInput(context.Background(), workspaceTerminalRequest{RequestID: "failed-intent", Chars: "private", Private: true}); r.Error == nil || r.Error.Code != "input_persistence_failed" {
		t.Fatal(r)
	}
	select {
	case <-p.entered:
		t.Fatal("uncommitted input was sent")
	default:
	}
	if j.result.InputID != "" || j.result.PrivateOutput {
		t.Fatal("failed commit changed state", j.result)
	}
}

// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: execution104Heartbeat; execution104Beat; execution104Started; execution104NestedDone; execution104Cancel; TestExecution104CancelOwnsOnlyStartedCommands; TestExecution104ExistingTerminalActionsDoNotTakeOwnership
// Impact: python -B scripts/code-atlas.py show Core/orchestration_cancel104_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func execution104Heartbeat(t *testing.T, m *ShellManager) (ShellCommand, string) {
	t.Helper()
	dir := t.TempDir()
	req := shell104Command(t, "heartbeat", dir)
	zero := 0
	req.YieldTimeMS = &zero
	return req, dir
}

func execution104Beat(dir string) int64 {
	st, err := os.Stat(filepath.Join(dir, "heartbeat"))
	if err != nil {
		return 0
	}
	return st.Size()
}

func execution104Started(t *testing.T, dir string) int {
	t.Helper()
	var pid int
	shell104Poll(t, "native helper PID/heartbeat", func() bool {
		data, err := os.ReadFile(filepath.Join(dir, "ready.json"))
		return err == nil && json.Unmarshal(data, &pid) == nil && pid > 0 && execution104Beat(dir) > 0
	})
	return pid
}

func execution104NestedDone(m *ShellManager, id string) bool {
	for _, c := range m.ExecutionSnapshots() {
		if c.CellID == id {
			return len(c.Records) > 0 && c.Records[0].State == "completed"
		}
	}
	return false
}

func execution104Cancel(t *testing.T, m *ShellManager, id string) {
	t.Helper()
	delay := 5000
	r, _ := m.execution.execute(context.Background(), executionCall("wait", WaitRequest{CellID: id, YieldTimeMS: &delay, Terminate: true}), "stop-one104")
	if r.State != "cancelled" {
		t.Fatalf("single cell did not cancel: %+v", r)
	}
}

func TestExecution104CancelOwnsOnlyStartedCommands(t *testing.T) {
	for _, name := range []string{"terminal", "exec_command"} {
		for _, early := range []bool{true, false} {
			label := name + "/in-flight"
			if early {
				label = name + "/already-yielded"
			}
			t.Run(label, func(t *testing.T) {
				m := shellTestManager(t)
				foreign, foreignDir := execution104Heartbeat(t, m)
				other := m.start(context.Background(), foreign)
				if !other.OK || other.SessionID == 0 {
					t.Fatal(other)
				}
				execution104Started(t, foreignDir)
				owned, ownedDir := execution104Heartbeat(t, m)
				if !early {
					delay := 30000
					owned.YieldTimeMS = &delay
				}
				args := map[string]any{}
				if err := json.Unmarshal(rawJSON(owned), &args); err != nil {
					t.Fatal(err)
				}
				if name == "terminal" {
					args["action"] = "exec"
				}
				zero := 0
				code := "const r=await tools." + name + "(" + string(rawJSON(args)) + "); if(!r.ok||!r.session_id) throw Error(JSON.stringify(r)); text(r.session_id); await new Promise(()=>{});"
				cell, _ := m.execution.execute(context.Background(), executionCall("exec", ExecRequest{Code: code, YieldTimeMS: &zero}), "owned104")
				pid := execution104Started(t, ownedDir)
				var session int
				for _, r := range m.Snapshots() {
					if r.Cmd == owned.Cmd {
						session = r.SessionID
					}
				}
				if session == 0 {
					t.Fatal("native helper is not tied to its shell receipt")
				}
				if early {
					shell104Poll(t, "nested call already handed back its session", func() bool { return execution104NestedDone(m, cell.CellID) })
				} else if execution104NestedDone(m, cell.CellID) {
					t.Fatal("expected cancellation while the initial nested wait is in flight")
				}
				execution104Cancel(t, m, cell.CellID)
				select {
				case <-m.job(session).done:
				case <-time.After(2 * time.Second):
					t.Error("cell cancelled but its actual native shell/helper did not exit")
				}
				r := m.job(session).snapshot(100, false)
				var exit any
				if r.ExitCode != nil {
					exit = *r.ExitCode
				}
				ownBefore, otherBefore := execution104Beat(ownedDir), execution104Beat(foreignDir)
				time.Sleep(100 * time.Millisecond)
				t.Logf("helper PID=%d session=%d state=%s exit=%v owned heartbeat=%d->%d foreign=%d->%d", pid, session, r.State, exit, ownBefore, execution104Beat(ownedDir), otherBefore, execution104Beat(foreignDir))
				if r.Pending() || r.ExitCode == nil || execution104Beat(ownedDir) != ownBefore {
					t.Error("cancel left a live process or continuing side effects")
				}
				if !m.job(other.SessionID).snapshot(100, false).Pending() || execution104Beat(foreignDir) <= otherBefore {
					t.Error("single cell cancellation stopped an unrelated process")
				}
			})
		}
	}
}

func TestExecution104ExistingTerminalActionsDoNotTakeOwnership(t *testing.T) {
	for _, action := range []string{"wait", "read", "input"} {
		t.Run(action, func(t *testing.T) {
			m := shellTestManager(t)
			req, dir := execution104Heartbeat(t, m)
			r := m.start(context.Background(), req)
			if !r.OK || r.SessionID == 0 {
				t.Fatal(r)
			}
			execution104Started(t, dir)
			args := map[string]any{"action": action, "session_id": r.SessionID}
			if action != "read" {
				args["yield_time_ms"] = 0
			}
			zero := 0
			cell, _ := m.execution.execute(context.Background(), executionCall("exec", ExecRequest{Code: "const r=await tools.terminal(" + string(rawJSON(args)) + "); if(!r.ok) throw Error(JSON.stringify(r)); text('observed'); await new Promise(()=>{});", YieldTimeMS: &zero}), "foreign-read104")
			shell104Poll(t, "non-start terminal action returned", func() bool { return execution104NestedDone(m, cell.CellID) })
			execution104Cancel(t, m, cell.CellID)
			before := execution104Beat(dir)
			time.Sleep(100 * time.Millisecond)
			if !m.job(r.SessionID).snapshot(100, false).Pending() || execution104Beat(dir) <= before {
				t.Fatal(strings.Join([]string{action, "incorrectly transferred ownership of an existing session"}, " "))
			}
		})
	}
}

// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: terminalCall; TestUnifiedTerminalLifecycleUsesOneOwnedProcessAndLog; TestUnifiedTerminalStopAndPermissions; TestTerminalDescriptionPreservesOwnedProcessAndStrictArguments
// Impact: python -B scripts/code-atlas.py show Core/terminal_tool_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func terminalCall(action string, args map[string]any) ToolCall {
	args["action"] = action
	return ToolCall{ID: "terminal-call", Function: FunctionCall{Name: "terminal", Arguments: string(rawJSON(args))}}
}

func TestUnifiedTerminalLifecycleUsesOneOwnedProcessAndLog(t *testing.T) {
	m := shellTestManager(t)
	ctx := context.Background()
	req := shellTestCommand(t, "input")
	zero := 0
	req.YieldTimeMS = &zero
	var args map[string]any
	json.Unmarshal(rawJSON(req), &args)
	start := m.Execute(ctx, terminalCall("exec", args))
	if !start.Pending() || start.SessionID <= 0 {
		t.Fatal("start failed", start)
	}
	wait := m.Execute(ctx, terminalCall("wait", map[string]any{"session_id": start.SessionID, "yield_time_ms": 0}))
	if !wait.Pending() || wait.SessionID != start.SessionID {
		t.Fatal("wait changed process", wait)
	}
	deadline := time.Now().Add(5 * time.Second)
	for {
		ready := m.Execute(ctx, terminalCall("read", map[string]any{"session_id": start.SessionID, "offset": 0}))
		if strings.Contains(ready.Output, "READY") {
			break
		}
		if ready.State != "running" || time.Now().After(deadline) {
			t.Fatal("input helper did not become ready", ready)
		}
		time.Sleep(10 * time.Millisecond)
	}
	input := m.Execute(ctx, terminalCall("input", map[string]any{"session_id": start.SessionID, "chars": "terminal-roundtrip\n", "yield_time_ms": 5000}))
	if !input.OK || !strings.Contains(input.Output, "INPUT=terminal-roundtrip") {
		t.Fatal("input failed", input)
	}
	// write_stdin returns once output goes quiet, which can be just before the helper exits.
	if input.Pending() {
		done := m.Execute(ctx, terminalCall("wait", map[string]any{"session_id": start.SessionID, "yield_time_ms": 5000}))
		if !done.OK || done.Pending() {
			t.Fatal("process did not exit after its input", done)
		}
	}
	read := m.Execute(ctx, terminalCall("read", map[string]any{"session_id": start.SessionID, "offset": 0}))
	if !read.OK || read.SessionID != start.SessionID || read.Generation != start.Generation || !strings.Contains(read.Output, "INPUT=terminal-roundtrip") {
		t.Fatal("saved log missing", read)
	}
	// Old archive aliases refer to the same retained log and do not relaunch.
	legacy := m.Execute(ctx, ToolCall{Function: FunctionCall{Name: "read_shell_output", Arguments: string(rawJSON(map[string]any{"session_id": start.SessionID}))}})
	if !legacy.OK || legacy.Output != read.Output {
		t.Fatal("legacy replay broke", legacy)
	}
	for _, bad := range []ToolCall{terminalCall("wait", map[string]any{"session_id": start.SessionID, "chars": "unexpected"}), terminalCall("wait", map[string]any{"session_id": start.SessionID, "terminate": true}), terminalCall("unknown", map[string]any{})} {
		if result := m.Execute(ctx, bad); result.OK || result.Error == nil {
			t.Fatal("ambiguous terminal action accepted", result)
		}
	}
}

func TestUnifiedTerminalStopAndPermissions(t *testing.T) {
	m := shellTestManager(t)
	req := shellTestCommand(t, "wait")
	zero := 0
	req.YieldTimeMS = &zero
	var args map[string]any
	json.Unmarshal(rawJSON(req), &args)
	start := m.Execute(context.Background(), terminalCall("exec", args))
	if !start.Pending() {
		t.Fatal(start)
	}
	stopped := m.Execute(context.Background(), terminalCall("stop", map[string]any{"session_id": start.SessionID, "yield_time_ms": 5000, "description": "停止测试进程"}))
	if stopped.Pending() || stopped.SessionID != start.SessionID {
		t.Fatal("owned process not stopped", stopped)
	}
	ctx := WithToolPermissions(context.Background(), []string{"terminal", "exec_command", "read_shell_output", "write_stdin"})
	defs := FilterToolDefinitions(ctx, ShellToolDefinitions())
	if len(defs) != 1 || defs[0].Name != "terminal" {
		t.Fatal("duplicate shell model interfaces", defs)
	}
	restricted := WithToolPermissions(context.Background(), []string{"read_shell_output"})
	if permittedCall(restricted, terminalCall("exec", map[string]any{"cmd": "ignored"})) == nil {
		t.Fatal("read-only permission gained execution")
	}
	defs = FilterToolDefinitions(restricted, ShellToolDefinitions())
	if len(defs) != 1 || defs[0].Name != "read_shell_output" {
		t.Fatal("legacy narrow permission lost")
	}
}

func TestTerminalDescriptionPreservesOwnedProcessAndStrictArguments(t *testing.T) {
	for _, unified := range []bool{false, true} {
		name := "legacy"
		if unified {
			name = "unified"
		}
		t.Run(name, func(t *testing.T) {
			m := shellTestManager(t)
			ctx := context.Background()
			req := shellTestCommand(t, "input_lines")
			zero := 0
			req.YieldTimeMS = &zero
			req.Description = "原始进程"
			start := m.start(ctx, req)
			if !start.Pending() {
				t.Fatal("start failed", start)
			}
			call := func(action string, args map[string]any) ShellResult {
				args["session_id"] = start.SessionID
				args["description"] = "读取进度，不应执行或发送此文字"
				if unified {
					return m.Execute(ctx, terminalCall(action, args))
				}
				legacy := "write_stdin"
				if action == "read" {
					legacy = "read_shell_output"
				}
				return m.Execute(ctx, ToolCall{Function: FunctionCall{Name: legacy, Arguments: string(rawJSON(args))}})
			}
			wait := call("wait", map[string]any{"yield_time_ms": 0})
			if !wait.OK || !wait.Pending() || wait.SessionID != start.SessionID {
				t.Fatal("description rejected or changed process", wait)
			}
			bad := call("input", map[string]any{"chars": "unexpected\n", "cmd": "unexpected execution", "yield_time_ms": 0})
			if bad.OK || bad.Error == nil {
				t.Fatal("unknown execution argument accepted", bad)
			}
			input := shellDone(t, m, call("input", map[string]any{"chars": "quit\n", "yield_time_ms": 5000}))
			if !input.OK || input.ExitCode == nil || *input.ExitCode != 0 {
				t.Fatal("input failed", input)
			}
			read := call("read", map[string]any{"offset": 0})
			if !read.OK || read.SessionID != start.SessionID || read.Generation != start.Generation || strings.TrimSpace(read.Output) != "INPUT=quit" {
				t.Fatal("metadata changed execution, input bytes or retained log", read)
			}
			jobs := m.Snapshots()
			if len(jobs) != 1 || jobs[0].SessionID != start.SessionID || jobs[0].Description != req.Description || jobs[0].Cmd != req.Cmd {
				t.Fatal("description replaced the original process metadata", jobs)
			}
			again := call("read", map[string]any{"offset": 0})
			if !again.OK || again.Output != read.Output || again.StartedAt != read.StartedAt {
				t.Fatal("read relaunched or changed output", again)
			}
		})
	}
}

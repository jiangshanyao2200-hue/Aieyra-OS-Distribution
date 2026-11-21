// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: portableTestCode; executionCall; runCell; selectedText; TestExecutionNestedToolAndEmitterContract; TestExecutionUnsupportedNestedToolFailsWithoutSideEffects; TestExecutionJavaScriptParallelAndDependencies; TestExecutionWaitDeltasCancelAndRestore; TestExecutionSyntaxErrorAndPersistenceFailure; TestExecutionActualParallelProcesses; TestExecutionSmallBudgetAndCancelOwnedProcess; TestExecutionInterruptedLogAndReplayNeverRerun; TestExecutionNestedJournalFailureStopsBeforeMutation
// Impact: python -B scripts/code-atlas.py show Core/orchestration_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

// These test commands exercise the native host shell on each platform.
func portableTestCode(code string) string {
	if runtime.GOOS == "windows" {
		return code
	}
	return strings.NewReplacer(
		"Get-Content -LiteralPath source.txt", "cat source.txt",
		"Get-Content -LiteralPath generated.txt", "cat generated.txt",
		"Get-Content actual.txt", "cat actual.txt",
		"Start-Sleep -Milliseconds 450; Write-Output 'second'", "sleep 0.45; echo second",
		"Start-Sleep -Milliseconds 700; Write-Output ", "sleep 0.7; echo ",
		"Start-Sleep -Milliseconds 700", "sleep 0.7",
		"Start-Sleep -Seconds 30", "sleep 30",
	).Replace(code)
}

func executionCall(name string, args any) ToolCall {
	if request, ok := args.(ExecRequest); ok {
		request.Code = portableTestCode(request.Code)
		args = request
	}
	data, _ := json.Marshal(args)
	return ToolCall{ID: "call", Type: "function", Function: FunctionCall{Name: name, Arguments: string(data)}}
}

func runCell(t *testing.T, m *ShellManager, code, key string) ExecResult {
	t.Helper()
	delay := 30000
	r, _ := m.execution.execute(context.Background(), executionCall("exec", ExecRequest{Code: code, YieldTimeMS: &delay}), key)
	if !r.OK || r.State != "completed" {
		t.Fatalf("cell failed: %+v", r)
	}
	return r
}

func selectedText(r ExecResult) string {
	var b strings.Builder
	for _, item := range r.Output {
		b.WriteString(item.Text)
	}
	return b.String()
}

func TestExecutionNestedToolAndEmitterContract(t *testing.T) {
	m := shellTestManager(t)
	r := runCell(t, m, `const listed=Object.keys(tools).sort(); text(listed); text(typeof tools.toolbox); const value={result:"complete"}; if(text(JSON.stringify(value).slice(0,12))!==undefined) throw Error("text must not return data");`, "nested-contract")
	var names []string
	for _, name := range executionNestedTools {
		names = append(names, name)
	}
	for _, name := range names {
		if !strings.Contains(selectedText(r), `"`+name+`"`) {
			t.Fatalf("worker missing documented tool %s: %s", name, selectedText(r))
		}
	}
	if !strings.Contains(selectedText(r), "undefined") || !strings.Contains(selectedText(r), `{"result":"c`) {
		t.Fatalf("emitter/toolbox contract: %s", selectedText(r))
	}
	description := OrchestrationToolDefinitions()[0].Description
	for _, instruction := range []string{"The only nested tools", "toolbox is a top-level tool", "return undefined", "text(JSON.stringify(value).slice(0,2000))", "Receipt ok=true does not imply exit_code=0"} {
		if !strings.Contains(description, instruction) {
			t.Fatalf("missing instruction %q", instruction)
		}
	}
	for _, name := range names {
		if !strings.Contains(description, "tools."+name) {
			t.Fatalf("documentation missing actual nested tool %s", name)
		}
	}
	if len(r.Records) != 0 {
		t.Fatal("listing/emitting unexpectedly executed a tool")
	}
}

func TestExecutionUnsupportedNestedToolFailsWithoutSideEffects(t *testing.T) {
	m := shellTestManager(t)
	wait := 10000
	r, _ := m.execution.execute(context.Background(), executionCall("exec", ExecRequest{Code: `await tools.toolbox({action:"list"}); await tools.apply_patch("*** Begin Patch\n*** Add File: forbidden.txt\n+x\n*** End Patch");`, YieldTimeMS: &wait}), "unsupported-tool")
	if r.OK || r.State != "failed" || r.Error == nil || r.Error.Code != "javascript_error" {
		t.Fatalf("unsupported nested call was not rejected: %+v", r)
	}
	if len(r.Records) != 0 {
		t.Fatal("unsupported nested tool created a receipt")
	}
	if _, err := os.Stat(filepath.Join(m.root, "forbidden.txt")); !os.IsNotExist(err) {
		t.Fatal("dependent mutation ran after unsupported call")
	}
}

func TestExecutionJavaScriptParallelAndDependencies(t *testing.T) {
	m := shellTestManager(t)
	if err := os.WriteFile(filepath.Join(m.root, "source.txt"), []byte("hidden-secret\nvisible-value\n"), 0600); err != nil {
		t.Fatal(err)
	}
	r := runCell(t, m, `const results=await Promise.all([1,2].map(()=>tools.exec_command({cmd:"Get-Content -LiteralPath source.txt",yield_time_ms:30000}))); if(results.some(r=>!r.ok||r.exit_code!==0||r.truncated)) throw Error("read failed"); text(results.map(r=>r.output.trim().split(/\r?\n/)[1])); const patch=await tools.apply_patch("*** Begin Patch\n*** Add File: generated.txt\n+dependent-result\n*** End Patch"); if(!patch.ok) throw Error("patch failed"); const next=await tools.exec_command({cmd:"Get-Content -LiteralPath generated.txt",yield_time_ms:30000}); if(!next.ok||next.exit_code!==0) throw Error("verification failed"); text(next.output.trim()); store("value",{answer:42});`, "parallel")
	if strings.Contains(selectedText(r), "hidden-secret") || !strings.Contains(selectedText(r), "dependent-result") {
		t.Fatalf("selection/dependency failed: %+v", r)
	}
	r = runCell(t, m, `text(load("value").answer); text([typeof process,typeof require,typeof fetch]);`, "stored")
	if !strings.Contains(selectedText(r), "42") || strings.Count(selectedText(r), "undefined") != 3 {
		t.Fatal(selectedText(r))
	}
	states := m.ExecutionSnapshots()
	count := 0
	for _, s := range states {
		count += len(s.Records)
	}
	if count != 4 {
		t.Fatalf("nested receipt count=%d", count)
	}
}

func TestExecutionWaitDeltasCancelAndRestore(t *testing.T) {
	m := shellTestManager(t)
	zero := 0
	delay := 30000
	code := `text("first"); const r=await tools.exec_command({cmd:"Start-Sleep -Milliseconds 450; Write-Output 'second'",yield_time_ms:30000}); text(r.output);`
	r, _ := m.execution.execute(context.Background(), executionCall("exec", ExecRequest{Code: code, YieldTimeMS: &zero}), "wait")
	if r.State != "running" || r.CellID == "" {
		t.Fatalf("not yielded: %+v", r)
	}
	r, _ = m.execution.execute(context.Background(), executionCall("wait", WaitRequest{CellID: r.CellID, YieldTimeMS: &delay}), "w1")
	if !r.OK || !strings.Contains(selectedText(r), "second") {
		t.Fatalf("wait: %+v", r)
	}
	id := r.CellID
	r, _ = m.execution.execute(context.Background(), executionCall("wait", WaitRequest{CellID: id, YieldTimeMS: &zero}), "w2")
	if len(r.Output) != 0 {
		t.Fatal("wait duplicated output")
	}
	r, _ = m.execution.execute(context.Background(), executionCall("exec", ExecRequest{Code: `while(true){}`, YieldTimeMS: &zero}), "loop")
	r, _ = m.execution.execute(context.Background(), executionCall("wait", WaitRequest{CellID: r.CellID, YieldTimeMS: &delay, Terminate: true}), "cancel")
	if r.State != "cancelled" {
		t.Fatalf("cancel: %+v", r)
	}
	m.Close()
	restored, err := NewShellManager(m.root, m.dir)
	if err != nil {
		t.Fatal(err)
	}
	defer restored.Close()
	r, _ = restored.execution.execute(context.Background(), executionCall("wait", WaitRequest{CellID: id, YieldTimeMS: &zero}), "restored")
	if r.State != "completed" || len(r.Output) != 0 {
		t.Fatalf("restore duplicated/reran: %+v", r)
	}
}

func TestExecutionSyntaxErrorAndPersistenceFailure(t *testing.T) {
	m := shellTestManager(t)
	wait := 10000
	r, _ := m.execution.execute(context.Background(), executionCall("exec", ExecRequest{Code: `await ! syntax {`, YieldTimeMS: &wait}), "syntax")
	if r.OK || r.Error == nil {
		t.Fatalf("syntax silently accepted: %+v", r)
	}
	response := Message{Role: RoleAssistant, ToolCalls: []ToolCall{executionCall("exec", ExecRequest{Code: `await tools.apply_patch("*** Begin Patch\n*** Add File: forbidden.txt\n+x\n*** End Patch");`, YieldTimeMS: &wait})}}
	_, err := ExecuteToolTurn(context.Background(), &PlanEngine{}, m, response, "failed-intent", func(string, any) error { return os.ErrPermission })
	if err == nil {
		t.Fatal("missing persistence failure")
	}
	if _, err = os.Stat(filepath.Join(m.root, "forbidden.txt")); !os.IsNotExist(err) {
		t.Fatal("side effect before saved intent")
	}
}

func TestExecutionActualParallelProcesses(t *testing.T) {
	m := shellTestManager(t)
	r := runCell(t, m, `const r=await Promise.all([1,2].map(i=>tools.exec_command({cmd:"Start-Sleep -Milliseconds 700; Write-Output " + i,yield_time_ms:30000}))); text(r.map(x=>x.exit_code));`, "parallel-processes")
	if selectedText(r) != "[0,0]" {
		t.Fatal(selectedText(r))
	}
	s := m.Snapshots()
	if len(s) != 2 {
		t.Fatal(len(s))
	}
	firstEnd := s[0].StartedAt.Add(time.Duration(s[0].DurationMS) * time.Millisecond)
	if !s[1].StartedAt.Before(firstEnd) {
		t.Fatal("Promise.all commands did not overlap")
	}
}

func TestExecutionSmallBudgetAndCancelOwnedProcess(t *testing.T) {
	m := shellTestManager(t)
	delay := 10000
	r, _ := m.execution.execute(context.Background(), executionCall("exec", ExecRequest{Code: `text("中🙂".repeat(800));`, YieldTimeMS: &delay, MaxOutputTokens: 100}), "pages")
	got := selectedText(r)
	if len(got) > 300 || !r.HasMore {
		t.Fatalf("budget: %+v", r)
	}
	for i := 0; r.HasMore && i < 40; i++ {
		r, _ = m.execution.execute(context.Background(), executionCall("wait", WaitRequest{CellID: r.CellID, MaxTokens: 100}), "page")
		got += selectedText(r)
	}
	if got != strings.Repeat("中🙂", 800) || r.HasMore {
		t.Fatal("pagination lost/duplicated Unicode output")
	}
	zero := 0
	r, _ = m.execution.execute(context.Background(), executionCall("exec", ExecRequest{Code: `await tools.exec_command({cmd:"Start-Sleep -Seconds 30",yield_time_ms:30000}); text("unexpected");`, YieldTimeMS: &zero}), "cancel-owned")
	deadline := time.Now().Add(3 * time.Second)
	for len(m.Snapshots()) == 0 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	r, _ = m.execution.execute(context.Background(), executionCall("wait", WaitRequest{CellID: r.CellID, YieldTimeMS: &delay, Terminate: true}), "cancel")
	if r.State != "cancelled" || strings.Contains(selectedText(r), "unexpected") {
		t.Fatalf("cancel: %+v", r)
	}
	for _, p := range m.Snapshots() {
		if p.Pending() {
			t.Fatalf("owned process still pending: %+v", p)
		}
	}
}

func TestExecutionInterruptedLogAndReplayNeverRerun(t *testing.T) {
	m := shellTestManager(t)
	delay := 10000
	response := Message{Role: RoleAssistant, ToolCalls: []ToolCall{executionCall("exec", ExecRequest{Code: `await tools.apply_patch("*** Begin Patch\n*** Add File: once.txt\n+once\n*** End Patch"); text("done");`, YieldTimeMS: &delay})}}
	engine := &PlanEngine{}
	persist := func(string, any) error { return nil }
	first, err := ExecuteToolTurn(context.Background(), engine, m, response, "once", persist)
	if err != nil {
		t.Fatal(err)
	}
	replay, err := ExecuteToolTurn(context.Background(), engine, m, response, "once", persist)
	if err != nil || !replay.Replayed || first.Messages[1].Content != replay.Messages[1].Content {
		t.Fatalf("replay: %v %+v", err, replay)
	}
	if len(m.ExecutionSnapshots()) != 1 {
		t.Fatal("replay created new cell")
	}
	path := filepath.Join(m.dir, "cells", "cell_interrupted.jsonl")
	data := `{"type":"start","key":"interrupted:call","description":"interrupted fixture"}` + "\n" + `{"type":"nested","record":{"id":1,"call":{"id":"nested_1","function":{"name":"apply_patch","arguments":"{}"}},"state":"running"}}` + "\n"
	if err = os.WriteFile(path, []byte(data), 0600); err != nil {
		t.Fatal(err)
	}
	m.Close()
	restored, err := NewShellManager(m.root, m.dir)
	if err != nil {
		t.Fatal(err)
	}
	defer restored.Close()
	r, _ := restored.execution.execute(context.Background(), executionCall("wait", WaitRequest{CellID: "cell_interrupted"}), "read")
	if r.State != "interrupted_unknown" || r.OK {
		t.Fatalf("interruption hidden: %+v", r)
	}
	r, _ = restored.execution.execute(context.Background(), response.ToolCalls[0], "interrupted:call")
	if r.OK || r.Error.Code != "already_started" {
		t.Fatalf("interrupted reran: %+v", r)
	}
}

func TestExecutionNestedJournalFailureStopsBeforeMutation(t *testing.T) {
	m := shellTestManager(t)
	zero := 0
	r, _ := m.execution.execute(context.Background(), executionCall("exec", ExecRequest{Code: `await tools.exec_command({cmd:"Start-Sleep -Milliseconds 700",yield_time_ms:30000}); await tools.apply_patch("*** Begin Patch\n*** Add File: must-not-exist.txt\n+x\n*** End Patch");`, YieldTimeMS: &zero}), "journal-failure")
	deadline := time.Now().Add(3 * time.Second)
	for len(m.Snapshots()) == 0 && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	m.execution.mu.Lock()
	cell := m.execution.cells[r.CellID]
	m.execution.mu.Unlock()
	cell.mu.Lock()
	cell.log.Close()
	cell.mu.Unlock()
	delay := 10000
	r, _ = m.execution.execute(context.Background(), executionCall("wait", WaitRequest{CellID: r.CellID, YieldTimeMS: &delay}), "failed")
	if r.OK || r.Error == nil {
		t.Fatalf("journal failure hidden: %+v", r)
	}
	if _, err := os.Stat(filepath.Join(m.root, "must-not-exist.txt")); !os.IsNotExist(err) {
		t.Fatal("mutation after failed journal")
	}
}

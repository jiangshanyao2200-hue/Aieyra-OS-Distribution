// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: activityFixture; TestMatrixActivityReadsOwnedArchiveAndLegacyFallback; TestMatrixActivityKeepsRuntimeOwnerAcrossScanPages; TestMatrixActivityHomeSnapshotShowsCommittedToolWhileNextRequestRuns; TestActivityPreservesActualToolStartForSkippedDisplayPhases; TestActivityShellContinuationKeepsSessionBeforeReceipt; TestActivitySemanticTargetsForWorkspaceAndToolbox; TestBrowserActivityPreservesScriptButWaitsForSafeFillReceipt; TestMatrixActivityCoreLinkProjectsTaskFromOwnedReceipt; TestMatrixActivityPlanTurnKeepsGenerationAndCommittedUpdates; TestMatrixActivityPatchKeepsBoundedOriginalDiffAndNoRepeat; TestMatrixActivityProjectsRealNestedShellAndPatchReceipts; activityPage; TestMatrixActivityReflectsIntentDispatchReceiptAndIncrementalRead; TestMatrixActivityNestedErrorsAndBackgroundPollUpdateOriginal; TestActivityPartialTailDoesNotReplayAndPendingIsUnknownAfterExit; TestMatrixActivityArchiveBoundAndOldReceiptCannotResurface; TestMatrixActivityInvalidPollDoesNotChangeOriginalProcessOutcome; TestActivityReceiptFieldsRespectToolSemantics
// Impact: python -B scripts/code-atlas.py show Core/matrix_activity_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"fmt"
	patchtool "github.com/aieyra/aieyra-os/tool/base/official/apply_patch"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func activityFixture(t *testing.T) (*AgentManager, string, *SessionArchive) {
	t.Helper()
	m, _ := matrixTestManager(t, func(http.ResponseWriter, *http.Request) { t.Error("unexpected network") })
	id := "11111111111111111111111111111111"
	m.jobs[id] = &agentJob{record: AgentRecord{ID: id, Parent: testMatrixOwner, State: "running"}}
	path := filepath.Join(m.dir, "sessions", id+".jsonl")
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		t.Fatal(err)
	}
	return m, id, &SessionArchive{Path: path}
}

func TestMatrixActivityReadsOwnedArchiveAndLegacyFallback(t *testing.T) {
	for _, source := range []string{"legacy", "persistent", "ephemeral"} {
		t.Run(source, func(t *testing.T) {
			m, id, legacy := activityFixture(t)
			archive := legacy
			if source != "legacy" {
				archive = &SessionArchive{Path: filepath.Join(t.TempDir(), "context.jsonl"), ephemeral: source == "ephemeral"}
				m.jobs[id].archive = archive
				// A leftover runtime archive must never override the active source.
				if err := legacy.Append("tool_intent", ToolIntent{"unrelated", Message{ToolCalls: []ToolCall{{ID: "old", Function: FunctionCall{Name: "web_search", Arguments: `{}`}}}}}); err != nil {
					t.Fatal(err)
				}
			}
			for generation := 1; generation <= 2; generation++ {
				invocation := fmt.Sprint("turn-", generation)
				call := ToolCall{ID: "open", Function: FunctionCall{Name: "toolbox", Arguments: `{"action":"open","name":"browser"}`}}
				if err := archive.Append("meta", map[string]int{"workspace_generation": generation}); err != nil {
					t.Fatal(err)
				}
				if err := archive.Append("tool_intent", ToolIntent{invocation, Message{ToolCalls: []ToolCall{call}}}); err != nil {
					t.Fatal(err)
				}
				page, rows := activityPage(t, m, id, 0)
				if len(rows) != generation || rows[generation-1].Generation != generation || rows[generation-1].State != "queued" {
					t.Fatalf("active archive intent missing or mixed: %+v", rows)
				}
				if err := archive.Append("tool_progress", ToolReceipt{Key: invocation + ":open", Output: `{"ok":true}`}); err != nil {
					t.Fatal(err)
				}
				page, delta := activityPage(t, m, id, int64(page["cursor"].(float64)))
				if len(delta) != 1 || delta[0].Generation != generation || delta[0].State != "completed" || delta[0].Hidden || delta[0].Tool != "browser" {
					t.Fatalf("live receipt missing or mixed across generations: %+v", delta)
				}
				_, delta = activityPage(t, m, id, int64(page["cursor"].(float64)))
				if len(delta) != 0 {
					t.Fatal("unchanged archive replayed receipts", delta)
				}
			}
			_, rows := activityPage(t, m, id, 0)
			if rows[0].Generation != 1 || rows[1].Generation != 2 {
				t.Fatal("history was relabelled as the current generation", rows)
			}
		})
	}
}

func TestMatrixActivityKeepsRuntimeOwnerAcrossScanPages(t *testing.T) {
	m, id, archive := activityFixture(t)
	write := func(kind string, value any) {
		t.Helper()
		if err := archive.Append(kind, value); err != nil {
			t.Fatal(err)
		}
	}
	write("meta", map[string]any{"workspace_generation": 1, "workspace_agent": "22222222222222222222222222222222"})
	for i := 0; i < 255; i++ {
		write("state", map[string]any{})
	}
	call := ToolCall{ID: "open", Function: FunctionCall{Name: "toolbox", Arguments: `{"action":"open","name":"browser"}`}}
	write("tool_intent", ToolIntent{"old", Message{ToolCalls: []ToolCall{call}}})
	write("tool_progress", ToolReceipt{Key: "old:open", Output: `{"ok":true}`})
	write("meta", map[string]any{"workspace_generation": 1, "workspace_agent": id})
	write("tool_intent", ToolIntent{"current", Message{ToolCalls: []ToolCall{call}}})
	write("tool_progress", ToolReceipt{Key: "current:open", Output: `{"ok":true}`})
	page, rows := activityPage(t, m, id, 0)
	if len(rows) != 0 || page["has_more"] != true {
		t.Fatal("first scan did not stop at the bounded history page", page)
	}
	_, rows = activityPage(t, m, id, 0)
	if len(rows) != 1 || rows[0].ID != "current:open" || rows[0].Generation != 1 || rows[0].State != "completed" {
		t.Fatal("owner state was lost across the scan boundary", rows)
	}
}

func TestMatrixActivityHomeSnapshotShowsCommittedToolWhileNextRequestRuns(t *testing.T) {
	useTestStage(t, ReleaseStage{Toolbox: true})
	entered, release := make(chan int, 3), make(chan struct{}, 3)
	var calls atomic.Int32
	m, dir := matrixTestManager(t, func(rw http.ResponseWriter, req *http.Request) {
		n := int(calls.Add(1))
		generation := (n + 1) / 2
		callID := fmt.Sprint("preview-", generation)
		if n%2 == 1 {
			fixtureAnswer(rw, fmt.Sprint("open-", generation), "", []any{map[string]any{"type": "function_call", "id": "fc-" + callID, "call_id": callID, "name": "toolbox", "arguments": `{"action":"open","name":"browser"}`}})
			return
		}
		var body struct {
			Input []struct {
				Type   string `json:"type"`
				CallID string `json:"call_id"`
				Output string `json:"output"`
			} `json:"input"`
		}
		if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		found := false
		for _, item := range body.Input {
			if item.Type == "function_call_output" && item.CallID == callID {
				var receipt ToolboxResult
				found = json.Unmarshal([]byte(item.Output), &receipt) == nil && receipt.OK
			}
		}
		if !found {
			t.Error("next model request omitted the successful toolbox receipt")
		}
		entered <- generation
		select {
		case <-release:
		case <-req.Context().Done():
			return
		}
		fixtureAnswer(rw, fmt.Sprint("done-", generation), "verified", nil)
	})
	h, w := openCoreLinkHome(t, m.config, dir)
	defer close(release)
	var previousAgent string
	for round := 1; round <= 3; round++ {
		generation := round
		if round == 3 {
			h.Close()
			h, w = openCoreLinkHome(t, m.config, dir)
			generation = 1
		}
		if _, err := w.Send(fmt.Sprint("preview-turn-", round), "Open the browser tool instructions."); err != nil {
			t.Fatal(err)
		}
		select {
		case got := <-entered:
			if got != round {
				t.Fatalf("unexpected request generation: %d", got)
			}
		case <-time.After(10 * time.Second):
			t.Fatal("tool roundtrip did not reach the next model request")
		}
		value, err := w.Snapshot(0)
		if err != nil {
			t.Fatal(err)
		}
		role := value.(map[string]any)["roles"].([]any)[0].(map[string]any)
		if role["generation"] != generation || role["state"] != "running" || role["execution_started"] != false || role["activity_error"] != nil {
			t.Fatalf("tool preparation changed execution facts: %s", rawJSON(role))
		}
		var activity struct {
			Items []AgentActivity `json:"items"`
		}
		if err := json.Unmarshal(rawJSON(role["activity"]), &activity); err != nil {
			t.Fatal(err)
		}
		if len(activity.Items) != generation {
			t.Fatalf("snapshot lost committed tool receipts while model is running: %+v", activity.Items)
		}
		for i, item := range activity.Items {
			if item.Generation != i+1 || item.Tool != "browser" || item.Action != "load_tool" || item.State != "completed" || item.Hidden || item.StartedAt == 0 {
				t.Fatalf("activity lost source generation or public receipt: %+v", item)
			}
		}
		if !strings.HasSuffix(activity.Items[len(activity.Items)-1].ID, fmt.Sprint(":preview-", round)) {
			t.Fatal("snapshot displayed an earlier runtime's receipt", activity.Items)
		}
		agent := role["id"].(string)
		if round == 3 && agent == previousAgent {
			t.Fatal("reopen reused the original runtime agent")
		}
		previousAgent = agent
		w.manager.mu.Lock()
		archive := w.manager.jobs[agent].archive
		w.manager.mu.Unlock()
		legacy := filepath.Join(w.manager.dir, "sessions", agent+".jsonl")
		if archive == nil || archive.ephemeral || archive.Path == legacy {
			t.Fatal("test did not exercise a real durable home archive")
		}
		if _, err := os.Stat(legacy); !os.IsNotExist(err) {
			t.Fatal("home created a second runtime archive", err)
		}
		release <- struct{}{}
		result, err := w.manager.Wait(context.Background(), w.state.ID, agent, 10000)
		if err != nil || result.State != "completed" {
			t.Fatal("home did not finish", result.State, result.Error, err)
		}
	}
	if calls.Load() != 6 {
		t.Fatal("reading activity dispatched extra model requests", calls.Load())
	}
}

func TestActivityPreservesActualToolStartForSkippedDisplayPhases(t *testing.T) {
	m, id, archive := activityFixture(t)
	call := ToolCall{ID: "time", Function: FunctionCall{Name: "exec_command", Arguments: `{"cmd":"echo verified"}`}}
	if err := archive.Append("tool_intent", ToolIntent{"timed", Message{ToolCalls: []ToolCall{call}}}); err != nil {
		t.Fatal(err)
	}
	_, first := activityPage(t, m, id, 0)
	if len(first) != 1 || first[0].StartedAt == 0 {
		t.Fatal(first)
	}
	if err := archive.Append("tool_progress", ToolReceipt{Key: "timed:time", Output: `{"ok":true,"state":"exited","exit_code":0,"output":"verified"}`}); err != nil {
		t.Fatal(err)
	}
	_, second := activityPage(t, m, id, 0)
	if len(second) != 1 || second[0].StartedAt != first[0].StartedAt {
		t.Fatal("回执更新改变实际开始时间", second)
	}
}

func TestActivityShellContinuationKeepsSessionBeforeReceipt(t *testing.T) {
	for _, name := range []string{"write_stdin", "read_shell_output"} {
		t.Run(name, func(t *testing.T) {
			m, id, archive := activityFixture(t)
			start := ToolCall{ID: "start", Function: FunctionCall{Name: "exec_command", Arguments: `{"cmd":"echo verified"}`}}
			wait := ToolCall{ID: "wait", Function: FunctionCall{Name: name, Arguments: `{"session_id":27}`}}
			for _, intent := range []ToolIntent{{"start", Message{ToolCalls: []ToolCall{start}}}, {"wait", Message{ToolCalls: []ToolCall{wait}}}} {
				if err := archive.Append("tool_intent", intent); err != nil {
					t.Fatal(err)
				}
				if intent.InvocationID == "start" {
					if err := archive.Append("tool_progress", ToolReceipt{Key: "start:start", Output: `{"ok":true,"state":"running","session_id":27}`}); err != nil {
						t.Fatal(err)
					}
				}
			}
			_, rows := activityPage(t, m, id, 0)
			if len(rows) != 2 || rows[0].Session != 27 || rows[1].Session != 27 || rows[1].State != "queued" {
				t.Fatalf("waiting call lost its command identity before receipt: %+v", rows)
			}
			if err := archive.Append("tool_progress", ToolReceipt{Key: "wait:wait", Output: `{"ok":true,"state":"exited","session_id":27,"exit_code":0}`}); err != nil {
				t.Fatal(err)
			}
			_, rows = activityPage(t, m, id, 0)
			if len(rows) != 2 || rows[0].State != "completed" || !rows[1].Hidden {
				t.Fatalf("continuation did not settle its original command: %+v", rows)
			}
		})
	}
}

func TestActivitySemanticTargetsForWorkspaceAndToolbox(t *testing.T) {
	for _, tc := range []struct{ tool, args, wantTool, wantAction, target string }{
		{"agents", `{"action":"create","title":"阅读助手","model_id":"qwen"}`, "agents", "create", "阅读助手"},
		{"workspace", `{"action":"new_session","workdir":"D:/Bird"}`, "workspace", "new_session", "D:/Bird"},
		{"toolbox", `{"action":"list"}`, "toolbox", "list", ""},
		{"toolbox", `{"action":"open","name":"browser"}`, "browser", "load_tool", ""},
	} {
		got := activityPreview(ToolCall{Function: FunctionCall{Name: tc.tool, Arguments: tc.args}}, "semantic", "")
		if got.Tool != tc.wantTool || got.Action != tc.wantAction || tc.target != "" && (len(got.Targets) == 0 || got.Targets[0] != tc.target) {
			t.Fatalf("semantic activity lost: %+v", got)
		}
	}
}

func TestBrowserActivityPreservesScriptButWaitsForSafeFillReceipt(t *testing.T) {
	fill := activityPreview(ToolCall{Function: FunctionCall{Name: "toolbox", Arguments: `{"action":"call","name":"browser","arguments":{"action":"fill","value":"private-credential","element_id":"7"}}`}}, "browser-fill", "")
	if strings.Contains(string(fill.InputPreview), "private-credential") || fill.Action != "fill" {
		t.Fatal("unclassified input exposed before page confirmation", fill)
	}
	script := activityPreview(ToolCall{Function: FunctionCall{Name: "toolbox", Arguments: `{"action":"call","name":"browser","arguments":{"action":"evaluate","script":"({value:0,ok:false})"}}`}}, "browser-script", "")
	if !strings.Contains(string(script.InputPreview), "value:0,ok:false") {
		t.Fatal("actual script missing from tool presentation", script)
	}
}

func TestMatrixActivityCoreLinkProjectsTaskFromOwnedReceipt(t *testing.T) {
	m, id, archive := activityFixture(t)
	call := ToolCall{ID: "send", Function: FunctionCall{Name: "core_link", Arguments: `{"action":"link_send","id":"22222222222222222222222222222222","request_id":"routing-only","message":"核对图像是否可以打开。","unrelated":"must-not-be-projected"}`}}
	if err := archive.Append("tool_intent", ToolIntent{"collaboration", Message{ToolCalls: []ToolCall{call}}}); err != nil {
		t.Fatal(err)
	}
	_, rows := activityPage(t, m, id, 0)
	check := func() {
		t.Helper()
		if len(rows) != 1 || rows[0].Action != "link_send" || rows[0].Tool != "core_link" {
			t.Fatalf("collaboration action missing: %+v", rows)
		}
		var fields map[string]string
		if json.Unmarshal(rows[0].InputPreview, &fields) != nil || len(fields) != 1 || fields["message"] != "核对图像是否可以打开。" || len(rows[0].Targets) != 0 {
			t.Fatalf("readable task lost or routing fields exposed: %+v", rows[0])
		}
	}
	check()
	if err := archive.Append("tool_progress", ToolReceipt{Key: "collaboration:send", Output: `{"ok":true,"data":{"accepted":true}}`}); err != nil {
		t.Fatal(err)
	}
	_, rows = activityPage(t, m, id, 0)
	check()
	if rows[0].State != "completed" {
		t.Fatal("delivery receipt did not complete", rows[0])
	}
}

func TestMatrixActivityPlanTurnKeepsGenerationAndCommittedUpdates(t *testing.T) {
	m, id, archive := activityFixture(t)
	if err := archive.Append("meta", map[string]int{"workspace_generation": 7}); err != nil {
		t.Fatal(err)
	}
	engine := &PlanEngine{}
	for index, args := range []string{
		`{"summary":"验证页面","plan":[{"description":"生成页面","status":"in_progress"},{"description":"独立检查","status":"pending"}]}`,
		`{"expected_revision":1,"summary":"页面已写入","plan":[{"description":"生成页面","status":"completed","result":"实际生成文件已核对"},{"description":"独立检查","status":"in_progress"}]}`,
	} {
		call := ToolCall{ID: "plan", Function: FunctionCall{Name: "update_plan", Arguments: args}}
		turn, err := ExecutePlanTools(engine, Message{ToolCalls: []ToolCall{call}}, fmt.Sprint("plan", index), func(turn ToolTurn) error { return archive.Append("tool_turn", turn) })
		if err != nil || !strings.Contains(turn.Messages[1].Content, `"ok":true`) {
			t.Fatalf("plan failed: %v %+v", err, turn)
		}
		if index == 1 && strings.Contains(turn.Messages[1].Content, `"state":`) {
			t.Fatal("display projection must not enlarge the model's compact receipt")
		}
	}
	page, rows := activityPage(t, m, id, 0)
	if len(rows) != 2 || rows[0].Generation != 7 || rows[1].Generation != 7 {
		t.Fatalf("plan generation lost: %+v", rows)
	}
	var preview struct {
		State PlanState `json:"state"`
	}
	if err := json.Unmarshal(rows[1].Preview, &preview); err != nil || preview.State.Revision != 2 || preview.State.Phases[0].Steps[0].Status != "completed" {
		t.Fatalf("committed plan update lost: %s (%v)", rows[1].Preview, err)
	}
	_, unchanged := activityPage(t, m, id, int64(page["cursor"].(float64)))
	if len(unchanged) != 0 {
		t.Fatal("unchanged plan retransmitted")
	}
}

func TestMatrixActivityPatchKeepsBoundedOriginalDiffAndNoRepeat(t *testing.T) {
	m, id, a := activityFixture(t)
	call := ToolCall{ID: "edit", Function: FunctionCall{Name: "apply_patch", Arguments: `{"patch":"*** Begin Patch\n*** Update File: a.cjs\n*** End Patch"}`}}
	_ = a.Append("tool_intent", ToolIntent{"r", Message{ToolCalls: []ToolCall{call}}})
	patch := PatchResult{OK: true, State: "applied", Files: []PatchFile{{Path: "a.cjs", Operation: "update", Hunks: []PatchHunk{{OldStart: 21, NewStart: 21}}}}}
	for i := 0; i < 60; i++ {
		patch.Files[0].Hunks[0].Lines = append(patch.Files[0].Hunks[0].Lines, PatchLine{Kind: "add", New: 21 + i, Text: "fake-key-only " + strings.Repeat("a", 1000)})
	}
	_ = a.Append("tool_progress", ToolReceipt{Key: "r:edit", Output: patchtool.PatchModelOutput(patch), Patch: &patch})
	p, rows := activityPage(t, m, id, 0)
	if len(rows) != 1 || rows[0].Patch == nil || rows[0].Patch.Omitted == 0 || len(rows[0].Patch.Files[0].Hunks[0].Lines) == 0 {
		t.Fatal(rows)
	}
	data, _ := json.Marshal(rows[0].Patch)
	if len(data) > 13000 || strings.Contains(string(data), "fake-key-only") || !strings.Contains(string(data), `"new":21`) {
		t.Fatal("diff lost bounds, redaction or source positions")
	}
	_, rows = activityPage(t, m, id, int64(p["cursor"].(float64)))
	if len(rows) != 0 {
		t.Fatal("patch retransmitted on unchanged polling")
	}
}

func TestMatrixActivityProjectsRealNestedShellAndPatchReceipts(t *testing.T) {
	m, id, a := activityFixture(t)
	root := t.TempDir()
	shell, err := NewShellManager(root, filepath.Join(m.dir, id+".shell"))
	if err != nil {
		t.Fatal(err)
	}
	defer shell.Close()
	m.jobs[id].shell = shell
	call := executionCall("exec", ExecRequest{Code: `const p=await tools.apply_patch("*** Begin Patch\n*** Add File: actual.txt\n+actual-nested-value\n*** End Patch");text(p);text(await tools.exec_command({cmd:"Get-Content actual.txt",yield_time_ms:30000}));`})
	_ = a.Append("tool_intent", ToolIntent{"real", Message{ToolCalls: []ToolCall{call}}})
	r := runCell(t, shell, `const p=await tools.apply_patch("*** Begin Patch\n*** Add File: actual.txt\n+actual-nested-value\n*** End Patch");text(p);text(await tools.exec_command({cmd:"Get-Content actual.txt",yield_time_ms:30000}));`, "real:call")
	output, _ := json.Marshal(r)
	_ = a.Append("tool_progress", ToolReceipt{Key: "real:call", Output: string(output)})
	_, rows := activityPage(t, m, id, 0)
	patchSeen, readSeen := false, false
	for _, row := range rows {
		if row.Tool == "apply_patch" {
			patchSeen = row.Patch != nil && row.Patch.Files[0].Hunks[0].Lines[0].Text == "actual-nested-value" && row.Parent == "real:call"
		}
		if row.Tool == "exec_command" {
			readSeen = row.Command == portableTestCode("Get-Content actual.txt") && row.Exit != nil && *row.Exit == 0
		}
	}
	if !patchSeen || !readSeen {
		t.Fatalf("real nested projection missing: %+v", rows)
	}
}

func activityPage(t *testing.T, m *AgentManager, id string, since int64) (map[string]any, []AgentActivity) {
	t.Helper()
	p, err := m.Activity(testMatrixOwner, id, since, 0, 400)
	if err != nil {
		t.Fatal(err)
	}
	page := p.(map[string]any)
	b, _ := json.Marshal(page["items"])
	var rows []AgentActivity
	if err = json.Unmarshal(b, &rows); err != nil {
		t.Fatal(err)
	}
	return page, rows
}

func TestMatrixActivityReflectsIntentDispatchReceiptAndIncrementalRead(t *testing.T) {
	m, id, a := activityFixture(t)
	call := ToolCall{ID: "one", Function: FunctionCall{Name: "exec_command", Arguments: `{"cmd":"Get-Content proof.txt","description":"读取 fake-key-only 文件"}`}}
	if err := a.Append("tool_intent", ToolIntent{"response", Message{ToolCalls: []ToolCall{call}}}); err != nil {
		t.Fatal(err)
	}
	p, rows := activityPage(t, m, id, 0)
	if len(rows) != 1 || rows[0].State != "queued" || strings.Contains(rows[0].Title, "fake-key-only") {
		t.Fatal(rows)
	}
	m.jobs[id].started.Store("response:one", true)
	p, rows = activityPage(t, m, id, int64(p["cursor"].(float64)))
	if len(rows) != 1 || rows[0].State != "running" {
		t.Fatal(rows)
	}
	if err := a.Append("tool_progress", ToolReceipt{Key: "response:one", Output: `{"ok":true,"state":"exited","exit_code":0,"session_id":13}`}); err != nil {
		t.Fatal(err)
	}
	p, rows = activityPage(t, m, id, int64(p["cursor"].(float64)))
	if len(rows) != 1 || rows[0].State != "completed" || rows[0].Exit == nil || *rows[0].Exit != 0 {
		t.Fatal(rows)
	}
	_, rows = activityPage(t, m, id, int64(p["cursor"].(float64)))
	if len(rows) != 0 {
		t.Fatal("unchanged rows repeatedly transmitted", rows)
	}
	if _, err := m.Activity("other", id, 0, 0, 100); err == nil {
		t.Fatal("unowned task exposed")
	}
}

func TestMatrixActivityNestedErrorsAndBackgroundPollUpdateOriginal(t *testing.T) {
	m, id, a := activityFixture(t)
	call := ToolCall{ID: "exec", Function: FunctionCall{Name: "exec", Arguments: `{"description":"并行检查"}`}}
	_ = a.Append("tool_intent", ToolIntent{"response", Message{ToolCalls: []ToolCall{call}}})
	_ = a.Append("tool_progress", ToolReceipt{Key: "response:exec", Output: `{"ok":true,"state":"running","cell_id":"cell_one"}`})
	dir := filepath.Join(m.dir, id+".shell", "cells")
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	write := func(events ...cellEvent) {
		t.Helper()
		f, e := os.OpenFile(filepath.Join(dir, "cell_one.jsonl"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
		if e != nil {
			t.Fatal(e)
		}
		defer f.Close()
		for _, event := range events {
			if e = json.NewEncoder(f).Encode(event); e != nil {
				t.Fatal(e)
			}
		}
	}
	nested := ToolCall{ID: "nested_1", Function: FunctionCall{Name: "exec_command", Arguments: `{"cmd":"test","description":"运行测试"}`}}
	write(cellEvent{Type: "start", Key: "response:exec"}, cellEvent{Type: "nested", Record: &NestedToolRecord{ID: 1, Call: nested, State: "running", Output: `{"ok":true,"state":"running","session_id":27}`}})
	_, rows := activityPage(t, m, id, 0)
	if len(rows) != 2 || rows[1].Parent != "response:exec" {
		t.Fatal(rows)
	}
	write(cellEvent{Type: "nested", Record: &NestedToolRecord{ID: 2, Call: ToolCall{Function: FunctionCall{Name: "write_stdin", Arguments: `{"session_id":27}`}}, State: "completed", Output: `{"ok":true,"state":"exited","session_id":27,"exit_code":0}`}})
	_, rows = activityPage(t, m, id, 0)
	var original, folded bool
	for _, r := range rows {
		if r.ID == "cell_one:1" {
			original = r.State == "completed"
		}
		if r.ID == "cell_one:2" {
			folded = r.Hidden
		}
	}
	if !original || !folded {
		t.Fatal(rows)
	}
	write(cellEvent{Type: "nested", Record: &NestedToolRecord{ID: 3, Call: nested, State: "completed", Output: `{"ok":true,"state":"exited","exit_code":1,"session_id":28}`}})
	_, rows = activityPage(t, m, id, 0)
	if rows[len(rows)-1].State != "failed" {
		t.Fatal(rows)
	}
}

func TestActivityPartialTailDoesNotReplayAndPendingIsUnknownAfterExit(t *testing.T) {
	m, id, a := activityFixture(t)
	call := ToolCall{ID: "one", Function: FunctionCall{Name: "apply_patch", Arguments: `{"patch":"*** Begin Patch\n*** Add File: proof.txt\n+x\n*** End Patch"}`}}
	_ = a.Append("tool_intent", ToolIntent{"r", Message{ToolCalls: []ToolCall{call}}})
	f, _ := os.OpenFile(a.Path, os.O_APPEND|os.O_WRONLY, 0600)
	_, _ = f.WriteString(`{"kind":`)
	_ = f.Close()
	p, rows := activityPage(t, m, id, 0)
	if len(rows) != 1 || p["has_more"] != true {
		t.Fatal(p)
	}
	p, rows = activityPage(t, m, id, int64(p["cursor"].(float64)))
	if len(rows) != 0 {
		t.Fatal("partial tail duplicated activity")
	}
	f, _ = os.OpenFile(a.Path, os.O_APPEND|os.O_WRONLY, 0600)
	_, _ = f.WriteString("\"meta\",\"value\":{}}\n")
	_ = f.Close()
	m.jobs[id].record.State = "interrupted"
	_, rows = activityPage(t, m, id, 0)
	if rows[0].State != "interrupted_unknown" {
		t.Fatal(rows)
	}
	if _, err := m.Call(context.Background(), testMatrixOwner, rawJSON(map[string]any{"action": "activity", "id": id})); err != nil {
		t.Fatal(err)
	}
}

func TestMatrixActivityArchiveBoundAndOldReceiptCannotResurface(t *testing.T) {
	m, id, _ := activityFixture(t)
	c := newAgentActivityCache()
	m.jobs[id].activity = c
	for i := 0; i < 4200; i++ {
		c.put(AgentActivity{ID: fmt.Sprint(i), Tool: "exec_command", State: "completed"})
	}
	c.put(AgentActivity{ID: "still-running", Tool: "exec_command", State: "running"})
	p, rows := activityPage(t, m, id, 4200)
	if len(c.items) != 4096 || len(c.archived) != 105 || c.items["still-running"].State != "running" || p["archived_count"].(float64) != 105 {
		t.Fatalf("retention %d %d %v", len(c.items), len(c.archived), p["archived_count"])
	}
	hidden := 0
	for _, r := range rows {
		if r.Hidden {
			hidden++
		}
	}
	if hidden != 105 {
		t.Fatal("removed rows must notify current viewers", hidden)
	}
	c.result("0", ToolCall{Function: FunctionCall{Name: "exec_command"}}, `{"state":"exited","exit_code":0}`)
	if _, exists := c.items["0"]; exists {
		t.Fatal("old archive receipt appeared as new work")
	}
}

func TestMatrixActivityInvalidPollDoesNotChangeOriginalProcessOutcome(t *testing.T) {
	c := newAgentActivityCache()
	call := ToolCall{Function: FunctionCall{Name: "exec_command"}}
	c.result("run", call, `{"ok":true,"session_id":1,"state":"exited","exit_code":0}`)
	c.result("poll", ToolCall{Function: FunctionCall{Name: "write_stdin"}}, `{"ok":false,"session_id":1,"state":"failed","error":{"message":"input closed"}}`)
	if c.items["run"].State != "completed" || c.items["poll"].State != "failed" {
		t.Fatal(c.items)
	}
}

func TestActivityReceiptFieldsRespectToolSemantics(t *testing.T) {
	c := newAgentActivityCache()
	project := ToolCall{Function: FunctionCall{Name: "project", Arguments: `{"action":"index_refresh","path":"project-fixture"}`}}
	c.result("index", project, `{"ok":true,"files":7,"scanned":7,"revision":1}`)
	if row := c.items["index"]; row.State != "completed" || row.Detail != "" || !row.Recorded || len(row.Targets) != 1 || row.Targets[0] != "project-fixture" {
		t.Fatal("successful index count became a failed file-list receipt", row)
	}
	c.result("session", ToolCall{Function: FunctionCall{Name: "workspace"}}, `{"ok":true,"session_id":"conversation-id"}`)
	if row := c.items["session"]; row.State != "completed" || row.Session != 0 {
		t.Fatal("conversation identity became a shell session", row)
	}
	c.result("shell", ToolCall{Function: FunctionCall{Name: "exec_command"}}, `{"ok":true,"session_id":"bad-shell-id","state":"running"}`)
	if c.items["shell"].State != "failed" {
		t.Fatal("malformed process receipt accepted")
	}
	c.result("null", project, `null`)
	if c.items["null"].State != "failed" {
		t.Fatal("null receipt invented success")
	}
}

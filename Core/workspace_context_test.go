// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: contextTestView; TestContextStatisticsRestoreWithoutReplayingRequests; TestEyraContextProjectReferencesDoNotLockFinishedWork; TestEyraContextCleaningUsesFreshRequestAndRejectsLateApply; TestEyraContextCleaningNativeAdapterReturnsEditableText; contextTestAction; contextTestTurn; TestEyraContextFreshEditRestoreSwitchAndReopen; TestEyraContextVersionConflictAndWriteFailureKeepOriginal; TestGroupLongResultCanBeRetrievedThroughActualMemberConversation; TestEyraContextRestoreIncludesMemorySetting; TestEyraContextMutationWaitsForRunningTask; TestEyraContextCleaningFailureAndCancellationPreserveOriginal
// Impact: python -B scripts/code-atlas.py show Core/workspace_context_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func contextTestView(t *testing.T, w *Workspace) map[string]any {
	t.Helper()
	v, e := w.contextCall(context.Background(), rawJSON(map[string]any{"action": "view"}))
	if e != nil {
		t.Fatal(e)
	}
	return v.(map[string]any)
}

func TestContextStatisticsRestoreWithoutReplayingRequests(t *testing.T) {
	var calls int
	m, dir := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
		calls++
		time.Sleep(60 * time.Millisecond)
		fixtureAnswer(w, "metrics", "done", nil)
	})
	w := modeWorkspace(t, m.config, dir, HostOS)
	created := contextTestAction(t, w, "new", map[string]any{"title": "metrics"})
	id := created["session_id"].(string)
	contextTestTurn(t, w, "measure one synthetic request")
	w.mu.Lock()
	err := w.saveLocked()
	agent := w.state.Roles[WorkspaceMatrix]
	w.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	r, err := w.manager.Status(w.state.ID, agent)
	if err != nil {
		t.Fatal(err)
	}
	u := r.Usage[len(r.Usage)-1]
	if u.Timing == nil || u.Timing.FirstByteMS == nil || *u.Timing.FirstByteMS < 40 || u.Timing.FirstEventMS == nil || u.Timing.TextMS == nil || u.Timing.ReasoningMS != nil {
		t.Fatalf("incorrect request milestones: %+v", u.Timing)
	}
	before := workspaceRecordStatus(r, "")
	w.Close()
	count := calls
	reopened := modeWorkspace(t, m.config, dir, HostOS)
	snapshot, err := reopened.Snapshot(0)
	if err != nil {
		t.Fatal(err)
	}
	row := snapshot.(map[string]any)["roles"].([]any)[0].(map[string]any)
	if row["statistics_restored"] != true || row["state"] != "idle" || row["execution_started"] != false || string(rawJSON(row["usage"])) != string(rawJSON(before["usage"])) || string(rawJSON(row["context"])) != string(rawJSON(before["context"])) {
		t.Fatalf("lost or resumed display facts: %s", rawJSON(row))
	}
	if calls != count {
		t.Fatal("restoring statistics made a model request")
	}
	contextTestAction(t, reopened, "new", map[string]any{"title": "empty"})
	snapshot, _ = reopened.Snapshot(0)
	row = snapshot.(map[string]any)["roles"].([]any)[0].(map[string]any)
	if row["context"] != nil || row["usage"] != nil {
		t.Fatal("statistics leaked into another conversation")
	}
	contextTestAction(t, reopened, "switch", map[string]any{"id": id})
	snapshot, _ = reopened.Snapshot(0)
	row = snapshot.(map[string]any)["roles"].([]any)[0].(map[string]any)
	if row["statistics_restored"] != true {
		t.Fatal("switch lost saved statistics")
	}
	contextTestAction(t, reopened, "edit", map[string]any{"text": "different context"})
	snapshot, _ = reopened.Snapshot(0)
	row = snapshot.(map[string]any)["roles"].([]any)[0].(map[string]any)
	if row["context"] != nil {
		t.Fatal("edited context reused an unrelated estimate")
	}
}

func TestEyraContextProjectReferencesDoNotLockFinishedWork(t *testing.T) {
	m, dir := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) { fixtureAnswer(w, "done", "finished", nil) })
	w := modeWorkspace(t, m.config, dir, HostOS)
	contextTestTurn(t, w, "finish the file")
	w.mu.Lock()
	w.state.Messages = append(w.state.Messages, workspaceMessage{ID: "file-reference", From: WorkspaceMatrix, To: "project", Reference: true, State: "context", Text: "completed file changes"})
	w.mu.Unlock()
	if contextTestView(t, w)["busy"] != false {
		t.Fatal("completed file reference locks context management")
	}
	contextTestAction(t, w, "new", map[string]any{"title": "next task"})
	w.mu.Lock()
	w.state.Messages = append(w.state.Messages, workspaceMessage{ID: "queued-user", From: "user", To: WorkspaceMatrix, State: "queued", Text: "actual pending input"})
	w.mu.Unlock()
	v := contextTestView(t, w)
	if v["busy"] != true {
		t.Fatal("actual pending user input is not protected")
	}
	if _, err := w.contextCall(context.Background(), rawJSON(map[string]any{"action": "new", "source": v["source"]})); err == nil {
		t.Fatal("context switched with pending user input")
	}
}

func TestEyraContextCleaningUsesFreshRequestAndRejectsLateApply(t *testing.T) {
	entered, release := make(chan struct{}), make(chan struct{})
	var cleanupRequest map[string]any
	m, dir := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		if tools, ok := body["tools"].([]any); !ok || len(tools) == 0 {
			cleanupRequest = body
			close(entered)
			<-release
			fixtureAnswer(w, "clean", "CLEANED_CONTEXT_56", nil)
			return
		}
		fixtureAnswer(w, "ctx", "normal result", nil)
	})
	w := modeWorkspace(t, m.config, dir, HostOS)
	contextTestTurn(t, w, "OLD_TASK_56")
	v := contextTestAction(t, w, "clean", map[string]any{"text": "整理纠正过的目标"})
	select {
	case <-entered:
	case <-time.After(5 * time.Second):
		t.Fatal("cleaner did not start")
	}
	defer func() {
		select {
		case <-release:
		default:
			close(release)
		}
	}()
	if strings.Contains(string(rawJSON(cleanupRequest)), "aieyra_shell_runtime") || strings.Contains(string(rawJSON(cleanupRequest)), "matrix_assignment") {
		t.Fatal("cleaner inherited working system context")
	}
	if !strings.Contains(string(rawJSON(cleanupRequest)), "OLD_TASK_56") {
		t.Fatal("cleaner did not receive source material")
	}
	contextTestAction(t, w, "edit", map[string]any{"text": "NEW_USER_CORRECTION_56"})
	close(release)
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if c := contextTestView(t, w)["cleaning"].(*contextCleaning); c.State == "ready" {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	clean := contextTestView(t, w)["cleaning"].(*contextCleaning)
	if clean.State != "ready" || clean.Text != "CLEANED_CONTEXT_56" {
		t.Fatal(clean.State, clean.Error)
	}
	_, err := w.contextCall(context.Background(), rawJSON(map[string]any{"action": "edit", "source": v["source"], "text": clean.Text}))
	if err == nil {
		t.Fatal("late cleaner overwrote user correction")
	}
	if !strings.Contains(contextTestView(t, w)["text"].(string), "NEW_USER_CORRECTION_56") {
		t.Fatal("correction lost")
	}
}
func TestEyraContextCleaningNativeAdapterReturnsEditableText(t *testing.T) {
	requests := make(chan map[string]any, 1)
	m, dir := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		requests <- body
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"finish_reason": "stop", "message": map[string]any{"role": "assistant", "content": "白鹭项目\n测试失败，待修复配置文件。"}}}})
	})
	s, err := Load(m.config)
	if err != nil {
		t.Fatal(err)
	}
	s.APIProfiles[0].Adapter = "deepseek"
	s.APIProfiles[0].Model = "deepseek-flash"
	s.APIProfiles[0].Protocol = ProtocolChat
	s.applyPoolProfile()
	if err := s.Save(); err != nil {
		t.Fatal(err)
	}
	w := modeWorkspace(t, m.config, dir, HostOS)
	contextTestAction(t, w, "edit", map[string]any{"text": "白鹭项目，配置文件缺失，测试失败。"})
	before := contextTestView(t, w)
	contextTestAction(t, w, "clean", map[string]any{"text": "整理待办"})
	select {
	case body := <-requests:
		if f, ok := body["response_format"].(map[string]any); ok && f["type"] != "text" {
			t.Fatalf("cleaner forced structured output: %v", f)
		}
		if tools, _ := body["tools"].([]any); len(tools) != 0 {
			t.Fatal("cleaner exposed tools")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("native cleaning request did not start")
	}
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		v := contextTestView(t, w)
		c := v["cleaning"].(*contextCleaning)
		if c.State == "ready" {
			if c.Text != "白鹭项目\n测试失败，待修复配置文件。" || v["source"] != before["source"] {
				t.Fatal("draft corrupted or applied automatically")
			}
			return
		}
		if c.State == "failed" {
			t.Fatal(c.Error)
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("native cleaner did not return an editable draft")
}

func contextTestAction(t *testing.T, w *Workspace, action string, extra map[string]any) map[string]any {
	t.Helper()
	args := map[string]any{"action": action, "source": contextTestView(t, w)["source"]}
	for k, v := range extra {
		args[k] = v
	}
	r, e := w.contextCall(context.Background(), rawJSON(args))
	if e != nil {
		t.Fatal(action, e)
	}
	return r.(map[string]any)
}
func contextTestTurn(t *testing.T, w *Workspace, text string) {
	t.Helper()
	w.mu.Lock()
	r, e := w.dispatchLocked(WorkspaceMatrix, workspaceID(), text)
	w.mu.Unlock()
	if e != nil {
		t.Fatal(e)
	}
	r, e = w.manager.Wait(context.Background(), w.state.ID, r.ID, 10000)
	if e != nil || r.State != "completed" {
		t.Fatalf("%s: %s %v", r.State, r.Error, e)
	}
}

func TestEyraContextFreshEditRestoreSwitchAndReopen(t *testing.T) {
	var mu sync.Mutex
	var wires []string
	m, dir := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
		var body any
		_ = json.NewDecoder(r.Body).Decode(&body)
		mu.Lock()
		wires = append(wires, string(rawJSON(body)))
		mu.Unlock()
		fixtureAnswer(w, "ctx", "result", nil)
	})
	w := modeWorkspace(t, m.config, dir, HostOS)
	contextTestTurn(t, w, "OLD_UNWANTED_BEHAVIOUR_56")
	created := contextTestAction(t, w, "new", map[string]any{"title": "隔离会话"})
	oldID := created["sessions"].([]map[string]any)[0]["id"].(string)
	newID := created["session_id"].(string)
	if created["auto_memory"] != false || created["text"] != "" {
		t.Fatalf("new context: %#v", created)
	}
	contextTestTurn(t, w, "FRESH_TASK_56")
	mu.Lock()
	second := wires[len(wires)-1]
	mu.Unlock()
	if strings.Contains(second, "OLD_UNWANTED_BEHAVIOUR_56") || !strings.Contains(second, "FRESH_TASK_56") {
		t.Fatal("old history leaked into new session", second)
	}
	contextTestAction(t, w, "edit", map[string]any{"text": "USER_CORRECTED_CONTEXT_56"})
	contextTestTurn(t, w, "AFTER_EDIT_56")
	mu.Lock()
	edited := wires[len(wires)-1]
	mu.Unlock()
	if strings.Contains(edited, "FRESH_TASK_56") || !strings.Contains(edited, "USER_CORRECTED_CONTEXT_56") {
		t.Fatal("edit did not replace effective context")
	}
	contextTestAction(t, w, "restore", nil)
	if text := contextTestView(t, w)["text"].(string); !strings.Contains(text, "FRESH_TASK_56") || strings.Contains(text, "USER_CORRECTED_CONTEXT_56") {
		t.Fatal("restore", text)
	}
	contextTestAction(t, w, "switch", map[string]any{"id": oldID})
	if !strings.Contains(contextTestView(t, w)["text"].(string), "OLD_UNWANTED_BEHAVIOUR_56") {
		t.Fatal("old session missing")
	}
	contextTestAction(t, w, "switch", map[string]any{"id": newID})
	w.Close()
	reopened := modeWorkspace(t, m.config, dir, HostOS)
	if contextTestView(t, reopened)["session_id"] != newID {
		t.Fatal("session selection not durable")
	}
	contextTestTurn(t, reopened, "AFTER_REOPEN_56")
	mu.Lock()
	last := wires[len(wires)-1]
	mu.Unlock()
	if !strings.Contains(last, "FRESH_TASK_56") || strings.Contains(last, "OLD_UNWANTED_BEHAVIOUR_56") {
		t.Fatal("reopen did not restore selected context")
	}
}

func TestEyraContextVersionConflictAndWriteFailureKeepOriginal(t *testing.T) {
	m, dir := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) { fixtureAnswer(w, "ctx", "result", nil) })
	w := modeWorkspace(t, m.config, dir, HostOS)
	contextTestAction(t, w, "new", nil)
	contextTestAction(t, w, "edit", map[string]any{"text": "KEEP_ORIGINAL_56"})
	source := contextTestView(t, w)["source"]
	contextTestTurn(t, w, "NEW_WORK_56")
	if _, err := w.contextCall(context.Background(), rawJSON(map[string]any{"action": "edit", "source": source, "text": "STALE"})); err == nil {
		t.Fatal("stale edit accepted")
	}
	file := filepath.Join(w.contextDirectory(), "sessions.json")
	data, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.Rename(file, file+".fixture-backup"); err != nil {
		t.Fatal(err)
	}
	if err = os.Mkdir(file, 0700); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(file, "block"), []byte("fixture"), 0600); err != nil {
		t.Fatal(err)
	}
	before := contextTestView(t, w)
	_, err = w.contextCall(context.Background(), rawJSON(map[string]any{"action": "reset", "source": before["source"]}))
	if err == nil {
		t.Fatal("fault did not reject mutation")
	}
	if got := contextTestView(t, w); got["source"] != before["source"] || got["text"] != before["text"] {
		t.Fatal("failed save changed active context")
	}
	if err = os.Remove(filepath.Join(file, "block")); err != nil {
		t.Fatal(err)
	}
	if err = os.Remove(file); err != nil {
		t.Fatal(err)
	}
	if err = os.Rename(file+".fixture-backup", file); err != nil {
		t.Fatal(err)
	}
	after, _ := os.ReadFile(file)
	if string(after) != string(data) {
		t.Fatal("original pointer changed")
	}
}

func TestGroupLongResultCanBeRetrievedThroughActualMemberConversation(t *testing.T) {
	long := strings.Repeat("完整长报告", 5000) + "END_OF_COMPLETE_RESULT_56"
	f := newGroupFixture(t, func(who string, n int) string {
		if who == "jia" {
			return long
		}
		return groupPass
	})
	id := f.group()
	f.must(map[string]any{"action": "group_post", "id": id, "text": "@甲 生成完整报告", "request_id": "full-56"})
	f.settle(id)
	group := f.must(map[string]any{"action": "group", "id": id})
	var member map[string]any
	for _, row := range group["members"].([]map[string]any) {
		if row["name"] == "甲" {
			member = row
			break
		}
	}
	if member == nil {
		t.Fatal("fixture member missing")
	}
	view := f.must(map[string]any{"action": "snapshot", "id": member["session"]})
	if !strings.Contains(string(rawJSON(view)), long) {
		t.Fatal("group advertises a complete result that the actual member conversation cannot retrieve")
	}
}

func TestEyraContextRestoreIncludesMemorySetting(t *testing.T) {
	m, dir := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) { fixtureAnswer(w, "ctx", "result", nil) })
	w := modeWorkspace(t, m.config, dir, HostOS)
	contextTestAction(t, w, "new", nil)
	contextTestAction(t, w, "edit", map[string]any{"text": "retained", "auto_memory": true})
	contextTestAction(t, w, "reset", nil)
	if v := contextTestAction(t, w, "restore", nil); v["auto_memory"] != true || !strings.Contains(v["text"].(string), "retained") {
		t.Fatal("previous version incomplete", v)
	}
	w.Close()
	w = modeWorkspace(t, m.config, dir, HostOS)
	if v := contextTestView(t, w); v["auto_memory"] != true {
		t.Fatal("restored setting not durable")
	}
}

func TestEyraContextMutationWaitsForRunningTask(t *testing.T) {
	entered, release := make(chan struct{}), make(chan struct{})
	m, dir := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
		close(entered)
		<-release
		fixtureAnswer(w, "ctx", "result", nil)
	})
	w := modeWorkspace(t, m.config, dir, HostOS)
	defer close(release)
	w.mu.Lock()
	_, err := w.dispatchLocked(WorkspaceMatrix, workspaceID(), "RUNNING_TASK")
	w.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	select {
	case <-entered:
	case <-time.After(5 * time.Second):
		t.Fatal("no request")
	}
	v := contextTestView(t, w)
	for _, action := range []string{"new", "reset", "edit", "memory", "switch", "restore"} {
		if _, err := w.contextCall(context.Background(), rawJSON(map[string]any{"action": action, "source": v["source"], "text": "replace"})); err == nil {
			t.Fatal("running mutation accepted", action)
		}
	}
}

func TestEyraContextCleaningFailureAndCancellationPreserveOriginal(t *testing.T) {
	for _, kind := range []string{"error", "length", "cancel"} {
		t.Run(kind, func(t *testing.T) {
			entered, release := make(chan struct{}), make(chan struct{})
			m, dir := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
				close(entered)
				if kind == "cancel" {
					<-release
				}
				if kind == "error" {
					w.WriteHeader(http.StatusServiceUnavailable)
					return
				}
				_ = json.NewEncoder(w).Encode(map[string]any{"id": "clean", "choices": []any{map[string]any{"index": 0, "finish_reason": "length", "message": map[string]any{"role": "assistant", "content": "INCOMPLETE"}}}})
			})
			w := modeWorkspace(t, m.config, dir, HostOS)
			contextTestAction(t, w, "edit", map[string]any{"text": "ORIGINAL_56"})
			before := contextTestView(t, w)
			contextTestAction(t, w, "clean", nil)
			select {
			case <-entered:
			case <-time.After(5 * time.Second):
				t.Fatal("cleaner not called")
			}
			if kind == "cancel" {
				contextTestAction(t, w, "cancel_clean", nil)
				close(release)
			}
			deadline := time.Now().Add(5 * time.Second)
			for time.Now().Before(deadline) {
				c := contextTestView(t, w)["cleaning"].(*contextCleaning)
				if c.State != "running" {
					break
				}
				time.Sleep(10 * time.Millisecond)
			}
			after := contextTestView(t, w)
			clean := after["cleaning"].(*contextCleaning)
			want := "failed"
			if kind == "cancel" {
				want = "cancelled"
			}
			if clean.State != want || clean.Text != "" || after["text"] != before["text"] || after["source"] != before["source"] {
				t.Fatal("original not preserved", clean.State, clean.Error)
			}
		})
	}
}

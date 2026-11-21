// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestCodingProjectSelectionPersistsWithoutModelAndRejectsStaleMutation; TestCodingProjectWorkingDirectoryAndUserContextReachNextTurn; TestCodingProjectSwitchPersistsOperationBoundary
// Impact: python -B scripts/code-atlas.py show Core/program_coding_project_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"net/http"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestCodingProjectSelectionPersistsWithoutModelAndRejectsStaleMutation(t *testing.T) {
	m, _ := matrixTestManager(t, nil)
	first, second := t.TempDir(), t.TempDir()
	apply := func(p map[string]any) codingProjectState {
		t.Helper()
		value, err := m.codingProjectCall(rawJSON(p))
		if err != nil {
			t.Fatal(err)
		}
		return value.(map[string]any)["project"].(codingProjectState)
	}
	state := apply(map[string]any{"operation": "open", "root": first, "expected_revision": 0})
	state = apply(map[string]any{"operation": "draft", "root": first, "path": "a.txt", "unsaved": true})
	state = apply(map[string]any{"operation": "focus", "root": first, "path": "b.txt"})
	if state.ActiveFile != "b.txt" || state.Unsaved || !state.Drafts["a.txt"] {
		t.Fatal("lost previous unsaved file", state)
	}
	state = apply(map[string]any{"operation": "saved", "root": first, "path": "b.txt", "version": "actual-version"})
	if state.Saved["b.txt"] != "actual-version" {
		t.Fatal(state)
	}
	loaded, err := (&AgentManager{dir: m.dir, config: m.config}).readCodingProject()
	if err != nil || loaded.Revision != state.Revision || loaded.Root != state.Root {
		t.Fatal("reopen lost workspace", loaded, err)
	}
	for _, p := range []map[string]any{
		{"operation": "open", "root": second, "expected_revision": 0},
		{"operation": "focus", "root": second, "path": "a.txt"},
		{"operation": "focus", "root": first, "path": "../outside"},
		{"operation": "open", "root": filepath.Join(first, "missing"), "expected_revision": state.Revision},
	} {
		if _, err := m.codingProjectCall(rawJSON(p)); err == nil {
			t.Fatal("accepted invalid/stale selection", p)
		}
	}
	state = apply(map[string]any{"operation": "open", "root": second, "expected_revision": state.Revision})
	if state.ActiveFile != "" || len(state.Drafts) > 0 || len(state.Saved) > 0 {
		t.Fatal("old context leaked into new project", state)
	}
}

func TestCodingProjectWorkingDirectoryAndUserContextReachNextTurn(t *testing.T) {
	useTestStage(t, ReleaseStage{Toolbox: true, TeamCollaboration: true})
	bodies := make(chan string, 2)
	release := make(chan struct{})
	var calls atomic.Int32
	m, _ := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
		var body any
		_ = json.NewDecoder(r.Body).Decode(&body)
		calls.Add(1)
		bodies <- string(rawJSON(body))
		select {
		case <-release:
		case <-r.Context().Done():
			return
		}
		fixtureAnswer(w, "project-context", "工作区已读取", nil)
	})
	h := NewWorkspaceHost(m.config, "", "")
	t.Cleanup(h.Close)
	call := func(p map[string]any) any {
		t.Helper()
		v, e := h.conversationCall(context.Background(), rawJSON(p))
		if e != nil {
			t.Fatal(e)
		}
		return v
	}
	first, second := t.TempDir(), t.TempDir()
	call(map[string]any{"action": "coding_project", "operation": "open", "root": first})
	binding := call(map[string]any{"action": "program_open", "program": "coding"}).(map[string]any)["binding"].(map[string]any)
	if binding["host_session_id"] == "" || calls.Load() != 0 {
		t.Fatal("manual project started model")
	}
	for _, row := range binding["members"].([]map[string]any) {
		if row["workdir"] != first || row["state"] != "idle" {
			t.Fatal("idle member lost root or started work", row)
		}
	}
	settings, _ := Load(m.config)
	settings.ExecutionProfile = "local-model"
	settings.VisionProfile = "local-model"
	if e := settings.Save(); e != nil {
		t.Fatal(e)
	}
	binding = call(map[string]any{"action": "program_open", "program": "coding"}).(map[string]any)["binding"].(map[string]any)
	cm, e := h.conversationManager()
	if e != nil {
		t.Fatal(e)
	}
	id := binding["host_session_id"].(string)
	record, e := cm.Status(cm.owner, id)
	if e != nil {
		t.Fatal(e)
	}
	cm.mu.Lock()
	job := cm.jobs[id]
	cm.mu.Unlock()
	shell, e := cm.shellForRun(job, record)
	if e != nil {
		t.Fatal(e)
	}
	call(map[string]any{"action": "coding_project", "operation": "open", "root": second, "expected_revision": 1})
	cm.mu.Lock()
	remaining := job.shell
	cm.mu.Unlock()
	if remaining != nil {
		t.Fatal("old shell survived switch", shell)
	}
	call(map[string]any{"action": "coding_project", "operation": "saved", "root": second, "path": "human.txt", "version": "human-version"})
	call(map[string]any{"action": "coding_project", "operation": "draft", "root": second, "path": "pending.txt", "unsaved": true})
	for _, row := range binding["members"].([]map[string]any) {
		r, e := cm.Status(cm.owner, row["session_id"].(string))
		if e != nil {
			t.Fatal(e)
		}
		spec, e := cm.resolveConversationSpec(r)
		if e != nil || spec.Workdir != second {
			t.Fatal("member resolved old root", spec.Workdir, e)
		}
	}
	call(map[string]any{"action": "group_post", "id": codingScopeID(), "text": "核对当前项目", "request_id": "user-project-context"})
	select {
	case body := <-bodies:
		if !strings.Contains(body, "human.txt") || !strings.Contains(body, "human-version") || !strings.Contains(body, "pending.txt") || !strings.Contains(body, "unsaved_files") {
			t.Fatal("user context missing from request")
		}
	case <-time.After(15 * time.Second):
		t.Fatal("no model request")
	}
	record, e = cm.Status(cm.owner, id)
	if e != nil || record.Spec.Workdir != second {
		t.Fatal("admitted task retained old tool root", record.Spec.Workdir, e)
	}
	state, e := cm.readCodingProject()
	if e != nil {
		t.Fatal(e)
	}
	if _, e = h.conversationCall(context.Background(), rawJSON(map[string]any{"action": "coding_project", "operation": "open", "root": first, "expected_revision": state.Revision})); e == nil {
		t.Fatal("switched while provider running")
	}
	close(release)
}

func TestCodingProjectSwitchPersistsOperationBoundary(t *testing.T) {
	m, _ := matrixTestManager(t, nil)
	first, second := t.TempDir(), t.TempDir()
	id := "11111111111111111111111111111111"
	m.jobs[id] = &agentJob{record: AgentRecord{ID: id, State: "completed", Generation: 4, Spec: AgentSpec{Kind: "conversation", GroupID: codingScopeID(), Workdir: first}}}
	_, err := m.codingProjectCall(rawJSON(map[string]any{"operation": "open", "root": first}))
	if err != nil {
		t.Fatal(err)
	}
	initial, err := m.readCodingProject()
	if err != nil || len(initial.GenerationFloor) != 0 {
		t.Fatal("initial default history was discarded", initial, err)
	}
	_, err = m.codingProjectCall(rawJSON(map[string]any{"operation": "open", "root": second, "expected_revision": initial.Revision}))
	if err != nil {
		t.Fatal(err)
	}
	restored, err := (&AgentManager{dir: m.dir, config: m.config}).readCodingProject()
	if err != nil || restored.GenerationFloor[id] != 4 {
		t.Fatal("project switch lost operation boundary", restored, err)
	}
}

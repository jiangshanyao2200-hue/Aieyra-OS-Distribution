// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: collaborationFixture; confirmedStation; TestCollaborationProjectionTracksActualRolesAndHelpers; TestCollaborationStationRejectsStaleOrLateConfirmation; TestCollaborationLostStationPreventsReturnedPatch; createTestSplit; waitSplitRecord; TestCollaborationSplitEnrollmentRetryAndSingleSubmission; TestCollaborationCancelAndCloseDuringJoin; TestCollaborationStationConcurrentRunsAndFailure; TestCollaborationStationRejectsUnconfirmedBeforeModel; TestCollaborationParentCancelDoesNotCancelSplit; collaborationArchive; TestCollaborationTaskScopeHistoryHumansAndNavigation
// Impact: python -B scripts/code-atlas.py show Core/workspace_collaboration_test.go
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
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func collaborationFixture(t *testing.T, handler http.HandlerFunc, adapter func(context.Context, *Workspace, string) (workspaceMembership, error)) *Workspace {
	t.Helper()
	t.Setenv("AIEYRA_CONTROL_DISABLED", "1")
	t.Setenv("APPDATA", t.TempDir())
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	m, dir := matrixTestManager(t, handler)
	// 只配置视觉模型，验证固定协同不依赖旧执行档。
	s, err := Load(m.config)
	if err != nil {
		t.Fatal(err)
	}
	s.VisionProfile, s.ExecutionProfile = "local-model", ""
	if err := s.Save(); err != nil {
		t.Fatal(err)
	}
	h := NewWorkspaceHost(m.config, "", t.TempDir())
	if err := h.SetMode(HostOS); err != nil {
		t.Fatal(err)
	}
	h.stationAdapter = adapter
	w, err := newWorkspace(m.config, "", dir, "", nil, h)
	if err != nil {
		t.Fatal(err)
	}
	w.mu.Lock()
	w.startupPrepared = true
	w.greeting.State = "skipped"
	w.collaboration.Mode = "split"
	w.mu.Unlock()
	h.workspaces[w.state.ID] = w
	t.Cleanup(h.Close)
	return w
}

func confirmedStation(w *Workspace, action string) workspaceMembership {
	state := "connected"
	if action == "finish" {
		state = "finished"
	}
	return workspaceMembership{State: state, Project: "os", NativeID: w.state.ID, ActorID: "actor-" + w.state.ID, SeatID: "seat-" + w.state.ID, TransportID: "transport-" + w.state.ID, ObservedAt: time.Now().UTC().Format(time.RFC3339Nano)}
}

func TestCollaborationProjectionTracksActualRolesAndHelpers(t *testing.T) {
	withLegacyHomeTeam(t)
	w := collaborationFixture(t, func(http.ResponseWriter, *http.Request) { t.Error("projection called provider") }, nil)
	configure := func(mode string, roles []string) error {
		_, err := w.collaborationCall(context.Background(), WorkspaceMatrix, rawJSON(map[string]any{"action": "configure", "mode": mode, "roles": roles}))
		return err
	}
	if err := configure("natural", nil); err != nil {
		t.Fatal(err)
	}
	if state := w.collaborationSnapshot(); state["active"] != false || state["dispatched"] != false {
		t.Fatal("template falsely dispatched", state)
	}
	id := collaborationArchive(t, w, WorkspaceProject, "old completed activity")
	w.mu.Lock()
	w.live[WorkspaceProject] = WorkspaceLive{Text: "obsolete activity"}
	w.mu.Unlock()
	state := w.collaborationSnapshot()
	if state["active"] != false || state["dispatched"] != true {
		t.Fatal("completed role remains active")
	}
	if state["roles"].([]map[string]any)[1]["activity"] != "completed" {
		t.Fatal("completed role retained obsolete current activity")
	}
	w.manager.mu.Lock()
	w.manager.jobs[id].record.State = "waiting_user"
	w.manager.mu.Unlock()
	if w.collaborationSnapshot()["active"] != true {
		t.Fatal("waiting role omitted")
	}
	if err := configure("custom", []string{WorkspaceProject}); err == nil {
		t.Fatal("active role silently revoked")
	}
	w.manager.mu.Lock()
	w.manager.jobs[id].record.State = "completed"
	w.manager.mu.Unlock()
	if err := configure("custom", []string{WorkspaceProject}); err != nil {
		t.Fatal(err)
	}
	if err := configure("custom", []string{WorkspaceProject, WorkspaceProject}); err == nil {
		t.Fatal("duplicate role accepted")
	}
	if err := configure("custom", []string{WorkspaceMatrix}); err == nil {
		t.Fatal("invalid custom role accepted")
	}
	helper := collaborationArchive(t, w, "", "helper-result")
	w.manager.mu.Lock()
	w.manager.jobs[helper].record.State = "running"
	w.manager.mu.Unlock()
	state = w.collaborationSnapshot()
	helpers := state["helpers"].([]map[string]any)
	if state["active"] != true || len(helpers) != 1 || helpers[0]["task_id"] != helper || helpers[0]["parent_task_id"] != w.state.ID {
		t.Fatal("helper relation or activity missing", helpers)
	}
	w.manager.mu.Lock()
	w.manager.jobs[helper].record.State = "completed"
	w.manager.mu.Unlock()
	if w.collaborationSnapshot()["active"] != false {
		t.Fatal("completed helper remains active")
	}
	if w.Mode() != HostOS {
		t.Fatal("fixture host changed")
	}
	w.host.mode = HostCLI
	if _, err := w.collaborationCall(context.Background(), WorkspaceMatrix, rawJSON(map[string]any{"action": "status"})); err == nil {
		t.Fatal("OS collaboration leaked to CLI")
	}
}

func TestCollaborationStationRejectsStaleOrLateConfirmation(t *testing.T) {
	for _, test := range []string{"malformed", "expired", "future", "stale", "closed", "frozen", "cancelled"} {
		t.Run(test, func(t *testing.T) {
			w := &Workspace{state: workspaceState{ID: workspaceID()}, split: &workspaceSplit{}, host: &WorkspaceHost{}}
			w.split.ID = w.state.ID
			original := confirmedStation(w, "idle")
			w.split.Membership = original
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			w.host.stationAdapter = func(ctx context.Context, child *Workspace, action string) (workspaceMembership, error) {
				v := confirmedStation(child, action)
				switch test {
				case "malformed":
					v.ObservedAt = "not-a-date"
				case "expired":
					v.ObservedAt = time.Now().Add(-time.Minute).Format(time.RFC3339Nano)
				case "future":
					v.ObservedAt = time.Now().Add(time.Minute).Format(time.RFC3339Nano)
				case "stale":
					v.Stale = true
				case "closed":
					child.mu.Lock()
					child.closed = true
					child.mu.Unlock()
				case "frozen":
					child.mu.Lock()
					child.updateFrozen = true
					child.mu.Unlock()
				case "cancelled":
					cancel()
				}
				return v, nil
			}
			if err := w.splitStationRun(ctx, true); err == nil {
				t.Fatal("invalid confirmation started run")
			}
			if w.split.Running != 0 || w.split.Membership.State != "offline" || !w.split.Membership.Stale || w.split.Membership.ActorID != original.ActorID {
				t.Fatal("late failure changed identity or remained connected", w.split.Membership)
			}
		})
	}
}

func TestCollaborationLostStationPreventsReturnedPatch(t *testing.T) {
	var calls atomic.Int32
	var lost atomic.Bool
	w := collaborationFixture(t, func(rw http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		lost.Store(true)
		fixtureAnswer(rw, "lost-before-tool", "", []any{map[string]any{"type": "function_call", "id": "fc_patch", "call_id": "call_patch", "name": "apply_patch", "arguments": `{"patch":"*** Begin Patch\n*** Add File: should-not-exist.txt\n+forbidden\n*** End Patch"}`}})
	}, func(ctx context.Context, child *Workspace, action string) (workspaceMembership, error) {
		if lost.Load() && action == "working" {
			return workspaceMembership{}, fmt.Errorf("offline before tool")
		}
		return confirmedStation(child, action), nil
	})
	child := createTestSplit(t, w, "patch-offline", "Do not execute the returned patch after station loss")
	r := waitSplitRecord(t, child)
	if r.State != "failed" || calls.Load() != 1 {
		t.Fatal("unexpected failed boundary", r.State, r.Error, calls.Load())
	}
	if _, err := os.Stat(filepath.Join(child.state.Workdir, "should-not-exist.txt")); !os.IsNotExist(err) {
		t.Fatal("patch executed after station loss", err)
	}
	child.manager.mu.Lock()
	started := child.manager.jobs[r.ID].runStarted.Load()
	child.manager.mu.Unlock()
	if started != 0 {
		t.Fatal("rejected tool counted as dispatched")
	}
}

func createTestSplit(t *testing.T, w *Workspace, request, text string) *Workspace {
	t.Helper()
	value, err := w.splitCall(context.Background(), rawJSON(map[string]any{"action": "split", "request_id": request, "title": request, "message": text, "workdir": w.state.Workdir}))
	if err != nil {
		t.Fatal(err)
	}
	next := w.splitTarget(value.(map[string]any)["id"].(string))
	if next == nil {
		t.Fatal("created split not owned")
	}
	return next
}

func waitSplitRecord(t *testing.T, w *Workspace) AgentRecord {
	t.Helper()
	deadline := time.Now().Add(8 * time.Second)
	for time.Now().Before(deadline) {
		w.mu.Lock()
		id := w.state.Roles[WorkspaceMatrix]
		w.mu.Unlock()
		if id != "" {
			r, err := w.manager.Wait(context.Background(), w.state.ID, id, 6000)
			if err != nil {
				t.Fatal(err)
			}
			return r
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("split never dispatched")
	return AgentRecord{}
}

func TestCollaborationSplitEnrollmentRetryAndSingleSubmission(t *testing.T) {
	var calls, joins atomic.Int32
	var available atomic.Bool
	w := collaborationFixture(t, func(rw http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		var request any
		_ = json.NewDecoder(r.Body).Decode(&request)
		text := string(rawJSON(request))
		if !strings.Contains(text, "only-child-assignment") || strings.Contains(text, "parent-private-message") {
			t.Error("split context crossed parent boundary")
		}
		fixtureAnswer(rw, "split-answer", "child-completed", nil)
	}, func(ctx context.Context, child *Workspace, action string) (workspaceMembership, error) {
		if action == "join" {
			joins.Add(1)
		}
		if !available.Load() {
			return workspaceMembership{}, fmt.Errorf("fixture offline")
		}
		return confirmedStation(child, action), nil
	})
	w.mu.Lock()
	w.state.Messages = append(w.state.Messages, workspaceMessage{ID: "parent-only", From: "user", To: WorkspaceMatrix, Text: "parent-private-message", State: "completed"})
	w.mu.Unlock()
	child := createTestSplit(t, w, "split-once", "only-child-assignment")
	if calls.Load() != 0 || child.splitRow()["initial_submitted"] != false {
		t.Fatal("failed enrollment executed")
	}
	if _, err := child.controlSend("bypass", "unauthorized initial"); err == nil {
		t.Fatal("pending split accepted ordinary send")
	}
	available.Store(true)
	if createTestSplit(t, w, "split-once", "only-child-assignment") != child || joins.Load() != 1 {
		t.Fatal("duplicate create replayed enrollment")
	}
	if _, err := w.splitCall(context.Background(), rawJSON(map[string]any{"action": "retry", "task_id": child.state.ID})); err != nil {
		t.Fatal(err)
	}
	r := waitSplitRecord(t, child)
	// A completed Matrix turn also maintains semantic continuity. Count the
	// actual usage kinds so maintenance cannot masquerade as a second dispatch.
	kinds := map[string]int{}
	for _, usage := range r.Usage {
		kinds[usage.Kind]++
	}
	if r.State != "completed" || r.Generation != 1 || calls.Load() != 2 || joins.Load() != 2 || kinds["model"] != 1 || kinds["continuity"] != 1 || len(r.Usage) != 2 {
		t.Fatalf("submission: %s %s calls=%d joins=%d kinds=%v", r.State, r.Error, calls.Load(), joins.Load(), kinds)
	}
	if child.splitRow()["initial_submitted"] != true {
		t.Fatal("submission not committed")
	}
	if _, err := child.startSplit(context.Background()); err != nil {
		t.Fatal(err)
	}
	createTestSplit(t, w, "split-once", "only-child-assignment")
	if calls.Load() != 2 || joins.Load() != 2 {
		t.Fatal("completed initial request replayed")
	}
	if _, err := w.splitCall(context.Background(), rawJSON(map[string]any{"action": "split", "request_id": "split-once", "title": "split-once", "message": "changed", "workdir": w.state.Workdir})); err == nil {
		t.Fatal("conflicting stable request accepted")
	}
}

func TestCollaborationCancelAndCloseDuringJoin(t *testing.T) {
	for _, closeTask := range []bool{false, true} {
		t.Run(fmt.Sprint("close=", closeTask), func(t *testing.T) {
			entered, release := make(chan *Workspace, 1), make(chan struct{})
			var calls, finishes atomic.Int32
			w := collaborationFixture(t, func(http.ResponseWriter, *http.Request) { calls.Add(1) }, func(ctx context.Context, child *Workspace, action string) (workspaceMembership, error) {
				if action == "join" {
					entered <- child
					<-release
				}
				if action == "finish" {
					finishes.Add(1)
				}
				return confirmedStation(child, action), nil // Simulate late success despite cancellation.
			})
			done := make(chan error, 1)
			go func() {
				_, e := w.splitCall(context.Background(), rawJSON(map[string]any{"action": "split", "request_id": "race", "title": "race", "message": "never execute", "workdir": w.state.Workdir}))
				done <- e
			}()
			var child *Workspace
			select {
			case child = <-entered:
			case <-time.After(5 * time.Second):
				t.Fatal("join not reached")
			}
			frozen, e := w.host.freezeForUpdate(true)
			if e != nil || frozen.(map[string]any)["idle"] != false {
				t.Fatal("freeze passed pending join", e)
			}
			closed := make(chan struct{})
			if closeTask {
				go func() { child.Close(); close(closed) }()
			} else {
				child.mu.Lock()
				e = child.cancelLocked()
				child.mu.Unlock()
				if e != nil {
					t.Fatal(e)
				}
				close(closed)
			}
			deadline := time.Now().Add(2 * time.Second)
			for {
				child.split.mu.Lock()
				cancelled := child.split.Cancelled
				child.split.mu.Unlock()
				if cancelled {
					break
				}
				if time.Now().After(deadline) {
					t.Fatal("cancellation blocked by join")
				}
				time.Sleep(time.Millisecond)
			}
			close(release)
			select {
			case e = <-done:
				if e != nil {
					t.Fatal(e)
				}
			case <-time.After(5 * time.Second):
				t.Fatal("join did not return")
			}
			select {
			case <-closed:
			case <-time.After(5 * time.Second):
				t.Fatal("close deadlocked")
			}
			if calls.Load() != 0 || child.splitRow()["initial_submitted"] != false {
				t.Fatal("late join ran cancelled request")
			}
			if _, e = child.startSplit(context.Background()); e != nil {
				t.Fatal(e)
			}
			if closeTask && finishes.Load() != 1 {
				t.Fatal("close did not finish exactly once")
			}
		})
	}
}

func TestCollaborationStationConcurrentRunsAndFailure(t *testing.T) {
	var mu sync.Mutex
	actions := []string{}
	var fail, wrong atomic.Bool
	w := &Workspace{state: workspaceState{ID: workspaceID()}, split: &workspaceSplit{}, host: &WorkspaceHost{}}
	w.split.ID = w.state.ID
	w.host.stationAdapter = func(ctx context.Context, child *Workspace, action string) (workspaceMembership, error) {
		mu.Lock()
		actions = append(actions, action)
		mu.Unlock()
		if fail.Load() {
			return workspaceMembership{}, fmt.Errorf("offline")
		}
		v := confirmedStation(child, action)
		if wrong.Load() {
			v.ActorID = "foreign"
		}
		return v, nil
	}
	ctx := context.Background()
	for i := 0; i < 2; i++ {
		if e := w.splitStationRun(ctx, true); e != nil {
			t.Fatal(e)
		}
	}
	if e := w.splitStationRun(ctx, false); e != nil {
		t.Fatal(e)
	}
	if actions[len(actions)-1] != "working" || w.split.Running != 1 {
		t.Fatal("first completion idled active sibling", actions)
	}
	fail.Store(true)
	if e := w.splitStationRun(ctx, true); e == nil || w.split.Running != 1 || !w.split.Membership.Stale {
		t.Fatal("failed start counted as executing")
	}
	fail.Store(false)
	wrong.Store(true)
	if e := w.splitStationBoundary(ctx, "working"); e == nil || w.split.Membership.ActorID != "actor-"+w.state.ID {
		t.Fatal("actor silently rebound")
	}
	wrong.Store(false)
	if e := w.splitStationRun(ctx, false); e != nil {
		t.Fatal(e)
	}
	if actions[len(actions)-1] != "idle" || w.split.Running != 0 {
		t.Fatal("last completion did not idle")
	}
	var wg sync.WaitGroup
	start := make(chan struct{})
	end := make(chan struct{})
	errs := make(chan error, 8)
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			errs <- w.splitStationRun(ctx, true)
			<-end
			errs <- w.splitStationRun(ctx, false)
		}()
	}
	close(start)
	for i := 0; i < 4; i++ {
		if e := <-errs; e != nil {
			t.Fatal(e)
		}
	}
	w.split.mu.Lock()
	running := w.split.Running
	w.split.mu.Unlock()
	if running != 4 {
		t.Fatal("lost concurrent starts", running)
	}
	close(end)
	wg.Wait()
	for i := 0; i < 4; i++ {
		if e := <-errs; e != nil {
			t.Fatal(e)
		}
	}
	if w.split.Running != 0 || actions[len(actions)-1] != "idle" {
		t.Fatal("concurrent completion count", actions)
	}
}

func TestCollaborationStationRejectsUnconfirmedBeforeModel(t *testing.T) {
	var calls atomic.Int32
	w := collaborationFixture(t, func(http.ResponseWriter, *http.Request) { calls.Add(1) }, func(ctx context.Context, child *Workspace, action string) (workspaceMembership, error) {
		if action == "working" {
			return workspaceMembership{}, fmt.Errorf("connection lost")
		}
		return confirmedStation(child, action), nil
	})
	child := createTestSplit(t, w, "lost", "never reach provider")
	r := waitSplitRecord(t, child)
	if r.State != "failed" || calls.Load() != 0 {
		t.Fatal("unconfirmed run reached provider", r.State, calls.Load())
	}
	if !child.splitRow()["membership"].(workspaceMembership).Stale {
		t.Fatal("failed boundary appears online")
	}
}

func TestCollaborationParentCancelDoesNotCancelSplit(t *testing.T) {
	started, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	w := collaborationFixture(t, func(rw http.ResponseWriter, r *http.Request) {
		once.Do(func() { close(started) })
		select {
		case <-release:
			fixtureAnswer(rw, "independent", "finished", nil)
		case <-r.Context().Done():
		}
	}, func(ctx context.Context, child *Workspace, action string) (workspaceMembership, error) {
		return confirmedStation(child, action), nil
	})
	child := createTestSplit(t, w, "independent", "wait for fixture release")
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("no child request")
	}
	w.mu.Lock()
	err := w.cancelLocked()
	w.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	child.mu.Lock()
	id := child.state.Roles[WorkspaceMatrix]
	child.mu.Unlock()
	r, err := child.manager.Status(child.state.ID, id)
	if err != nil || r.State != "running" {
		t.Fatal("parent cancellation reached child", r.State, err)
	}
	close(release)
	if r = waitSplitRecord(t, child); r.State != "completed" {
		t.Fatal(r.State, r.Error)
	}
}

func collaborationArchive(t *testing.T, w *Workspace, role, text string) string {
	t.Helper()
	id := workspaceID()
	a := &SessionArchive{ephemeral: true}
	if err := a.Append("message", Message{Role: RoleAssistant, Content: text}); err != nil {
		t.Fatal(err)
	}
	if err := a.Append("tool_progress", ToolReceipt{Key: "turn:call", ToolName: "exec_command", Output: `{"ok":true,"output":"` + text + `"}`}); err != nil {
		t.Fatal(err)
	}
	w.manager.mu.Lock()
	w.manager.jobs[id] = &agentJob{record: AgentRecord{ID: id, Parent: w.state.ID, Depth: 1, State: "completed", Generation: 1, Spec: AgentSpec{WorkspaceRole: role, ModelID: "local-model", Workdir: w.state.Workdir}, HumanRequests: []HumanRequest{{ID: "human-" + id, SessionID: w.state.ID, AgentID: id, State: "resolved", Generation: 1}}}, archive: a}
	w.manager.mu.Unlock()
	if role != "" {
		w.mu.Lock()
		w.state.Roles[role] = id
		w.mu.Unlock()
	}
	return id
}

func TestCollaborationTaskScopeHistoryHumansAndNavigation(t *testing.T) {
	w := collaborationFixture(t, func(http.ResponseWriter, *http.Request) { t.Error("read-only scope ran model") }, func(ctx context.Context, child *Workspace, action string) (workspaceMembership, error) {
		return workspaceMembership{}, fmt.Errorf("offline fixture")
	})
	a := createTestSplit(t, w, "a", "a-only")
	b := createTestSplit(t, w, "b", "b-only")
	aid := collaborationArchive(t, a, WorkspaceMatrix, "a-receipt")
	helper := collaborationArchive(t, a, "", "helper-only")
	bid := collaborationArchive(t, b, WorkspaceMatrix, "b-receipt")
	if _, e := a.taskOwner(b.state.ID); e == nil {
		t.Fatal("sibling scope exposed")
	}
	if _, e := a.taskOwner(w.state.ID); e == nil {
		t.Fatal("parent scope exposed")
	}
	if got, e := w.taskOwner(helper); e != nil || got != a {
		t.Fatal("descendant helper not routed", e)
	}
	ctx := context.Background()
	value, e := w.Call(ctx, "workspace.history", rawJSON(map[string]any{"task_id": helper, "segment": helper}))
	if e != nil {
		t.Fatal(e)
	}
	rows := value.(map[string]any)["entries"].([]historyEntry)
	if len(rows) != 2 {
		t.Fatal("child history scope", len(rows))
	}
	for _, row := range rows {
		if row.Agent != helper {
			t.Fatal("sibling history exposed", row)
		}
	}
	for _, agent := range []string{aid, bid} {
		if _, e = w.Call(ctx, "workspace.receipt", rawJSON(map[string]any{"task_id": helper, "agent_id": agent, "id": "turn:call"})); e == nil {
			t.Fatal("cross-task receipt allowed")
		}
	}
	if _, e = w.Call(ctx, "workspace.receipt", rawJSON(map[string]any{"task_id": helper, "agent_id": helper, "id": "turn:call"})); e != nil {
		t.Fatal(e)
	}
	if _, e = w.Call(ctx, "workspace.document", rawJSON(map[string]any{"task_id": helper, "id": "parent-report"})); e == nil {
		t.Fatal("helper fell back to parent document")
	}
	value, e = w.taskCall(ctx, "workspace.task_snapshot", rawJSON(map[string]any{"task_id": a.state.ID}))
	if e != nil {
		t.Fatal(e)
	}
	snapshot := value.(map[string]any)
	if snapshot["session_id"] != a.state.ID || snapshot["navigation_root_id"] != w.state.ID || len(snapshot["tasks"].([]map[string]any)) != 4 {
		t.Fatal("split lost root navigation")
	}
	c := &MatrixControl{manager: w.manager}
	value, e = c.scopedHuman("humans.list", rawJSON(map[string]any{"task_id": helper}))
	if e != nil || len(value.([]HumanRequest)) != 1 || value.([]HumanRequest)[0].AgentID != helper {
		t.Fatal("human list scope", value, e)
	}
	if _, e = c.scopedHuman("humans.status", rawJSON(map[string]any{"task_id": helper, "id": "human-" + aid})); e == nil {
		t.Fatal("sibling human request exposed")
	}
	if _, e = c.scopedHuman("humans.reply", rawJSON(map[string]any{"task_id": a.state.ID, "session_id": b.state.ID, "agent_id": bid})); e == nil {
		t.Fatal("foreign human session accepted")
	}
	if _, e = c.scopedHuman("humans.list", rawJSON(map[string]any{"task_id": helper, "unexpected": true})); e == nil {
		t.Fatal("routing weakened strict decode")
	}
	if _, e = c.Call(ctx, "agents.activity", rawJSON(map[string]any{"task_id": helper, "id": aid})); e == nil {
		t.Fatal("foreign activity accepted")
	}
	if _, e = w.terminalCall(ctx, "workspace.terminals", rawJSON(map[string]any{"task_id": a.state.ID, "agent_id": aid, "generation": 1})); e != nil {
		t.Fatal(e)
	}
	for _, p := range []map[string]any{{"task_id": a.state.ID, "agent_id": bid, "generation": 1}, {"task_id": a.state.ID, "agent_id": aid, "generation": 2}} {
		if _, e = w.terminalCall(ctx, "workspace.terminals", rawJSON(p)); e == nil {
			t.Fatal("terminal binding bypassed")
		}
	}
	before := a.split.Membership
	a.split.mu.Lock()
	a.split.Membership = confirmedStation(a, "idle")
	a.split.Membership.ObservedAt = time.Now().Add(-time.Minute).UTC().Format(time.RFC3339Nano)
	a.split.mu.Unlock()
	if !a.splitRow()["membership"].(workspaceMembership).Stale {
		t.Fatal("expired membership appears fresh")
	}
	a.split.mu.Lock()
	a.split.Membership = before
	a.split.mu.Unlock()
	profile, e := a.stationProfile()
	if e != nil {
		t.Fatal(e)
	}
	if profile != filepath.Join(DataDir(a.config), "stations", a.state.ID+".json") {
		t.Fatal("test profile escaped fixture", profile)
	}
	if filepath.Base(profile) != a.state.ID+".json" {
		t.Fatal("profile not bound to runtime")
	}
}

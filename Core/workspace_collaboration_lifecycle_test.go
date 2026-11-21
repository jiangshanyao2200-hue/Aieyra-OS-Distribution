// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestCollaborationActualRolesShareStationUntilLastCompletion; TestCollaborationRequestLossBlocksRetryAndMaintenance; TestCollaborationLostStationPreventsReturnedShell
// Impact: python -B scripts/code-atlas.py show Core/workspace_collaboration_lifecycle_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestCollaborationActualRolesShareStationUntilLastCompletion(t *testing.T) {
	withLegacyHomeTeam(t)
	roles := []string{WorkspaceMatrix, WorkspaceProject, "helper"}
	releases := map[string]chan struct{}{}
	for _, role := range roles {
		releases[role] = make(chan struct{})
	}
	entered := make(chan string, 4)
	var mu sync.Mutex
	var actions []string
	var maintenance atomic.Int32
	w := collaborationFixture(t, func(rw http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var request map[string]json.RawMessage
		_ = json.Unmarshal(body, &request)
		if len(request["tools"]) == 0 {
			maintenance.Add(1)
			fixtureAnswer(rw, "continuity-result", "retained maintenance request", nil)
			return
		}
		for _, role := range roles {
			if strings.Contains(string(body), "lifecycle-assignment-"+role) {
				entered <- role
				select {
				case <-releases[role]:
					fixtureAnswer(rw, "answer-"+role, "result-"+role, nil)
				case <-r.Context().Done():
				}
				return
			}
		}
		t.Error("unrecognized role request")
		http.Error(rw, "unknown assignment", 400)
	}, func(_ context.Context, child *Workspace, action string) (workspaceMembership, error) {
		mu.Lock()
		actions = append(actions, action)
		mu.Unlock()
		return confirmedStation(child, action), nil
	})
	// Release blocked HTTP handlers even if a lifecycle assertion fails.
	t.Cleanup(func() {
		for _, release := range releases {
			select {
			case <-release:
			default:
				close(release)
			}
		}
	})
	child := createTestSplit(t, w, "all-roles", "lifecycle-assignment-matrix")
	if _, err := child.collaborationCall(context.Background(), WorkspaceMatrix, rawJSON(map[string]any{"action": "configure", "mode": "natural"})); err != nil {
		t.Fatal(err)
	}
	ids := map[string]string{}
	// This case measures the three assigned runs. Explicitly receive the
	// member result so asynchronous completion delivery cannot start another
	// Matrix generation while Wait observes the first one's completion.
	// Background delivery and wakeup are covered by team_async_test.go.
	memberDone := make(chan error, 1)
	go func() {
		_, err := child.team(context.Background(), WorkspaceMatrix, rawJSON(map[string]any{"action": "dispatch", "role": WorkspaceProject, "request_id": "dispatch-project", "message": "lifecycle-assignment-project", "wait": true}))
		memberDone <- err
	}()
	helper, err := child.manager.Create(context.Background(), child.state.ID, AgentSpec{RequestID: "helper-lifecycle", ModelID: "local-model", Task: "lifecycle-assignment-helper", Workdir: child.state.Workdir, Tools: []string{"exec_command"}})
	if err != nil {
		t.Fatal(err)
	}
	ids["helper"] = helper.ID
	seen := map[string]bool{}
	for len(seen) < len(roles) {
		select {
		case role := <-entered:
			if seen[role] {
				t.Fatal("role submitted twice", role)
			}
			seen[role] = true
		case <-time.After(8 * time.Second):
			t.Fatal("roles never reached actual requests", seen)
		}
	}
	child.mu.Lock()
	for role, id := range child.state.Roles {
		ids[role] = id
	}
	child.mu.Unlock()
	child.split.mu.Lock()
	running := child.split.Running
	child.split.mu.Unlock()
	if running != len(roles) {
		t.Fatal("actual workers not counted", running)
	}
	for i, role := range []string{WorkspaceProject, "helper", WorkspaceMatrix} {
		close(releases[role])
		record, err := child.manager.Wait(context.Background(), child.state.ID, ids[role], 10000)
		if err != nil || record.State != "completed" {
			t.Fatalf("%s: %s %s %v", role, record.State, record.Error, err)
		}
		if role == WorkspaceProject {
			select {
			case err := <-memberDone:
				if err != nil {
					t.Fatal(err)
				}
			case <-time.After(10 * time.Second):
				t.Fatal("explicit member wait did not return")
			}
		}
		if role == "helper" && (record.LastWorkerPID == 0 || record.LastWorkerPID == os.Getpid()) {
			t.Fatal("helper did not use actual isolated model worker")
		}
		child.split.mu.Lock()
		running = child.split.Running
		child.split.mu.Unlock()
		mu.Lock()
		last := actions[len(actions)-1]
		mu.Unlock()
		want := "working"
		if i == len(roles)-1 {
			want = "idle"
		}
		if running != len(roles)-1-i || last != want {
			t.Fatalf("%s completion idled a live worker: count=%d action=%s", role, running, last)
		}
	}
	if maintenance.Load() != 1 {
		t.Fatal("continuous memory maintenance omitted or repeated", maintenance.Load())
	}
	child.Close()
	mu.Lock()
	defer mu.Unlock()
	finishes := 0
	for _, action := range actions {
		if action == "finish" {
			finishes++
		}
	}
	if finishes != 1 || actions[len(actions)-1] != "finish" {
		t.Fatal("close did not finish after all workers", actions)
	}
}

func TestCollaborationRequestLossBlocksRetryAndMaintenance(t *testing.T) {
	for _, kind := range []string{"model", "compact", "continuity"} {
		for _, helper := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/helper=%v", kind, helper), func(t *testing.T) {
				var calls atomic.Int32
				var lost atomic.Bool
				w := collaborationFixture(t, func(rw http.ResponseWriter, r *http.Request) {
					calls.Add(1)
					lost.Store(true)
					http.Error(rw, "temporarily unavailable", http.StatusServiceUnavailable)
				}, func(_ context.Context, child *Workspace, action string) (workspaceMembership, error) {
					if lost.Load() && action == "working" {
						return workspaceMembership{}, fmt.Errorf("station offline")
					}
					return confirmedStation(child, action), nil
				})
				w.split = &workspaceSplit{ID: w.state.ID}
				settings, err := w.manager.settings("local-model")
				if err != nil {
					t.Fatal(err)
				}
				role := WorkspaceMatrix
				if helper {
					role = ""
				}
				job := &agentJob{record: AgentRecord{ID: workspaceID(), Parent: w.state.ID, Depth: 1, Spec: AgentSpec{WorkspaceRole: role, MaxRequests: 5}}}
				ctx := WithProviderSession(fastRetryContext(true), w.state.ID)
				_, _, err = w.manager.agentRequest(ctx, job, settings, []Message{{Role: RoleUser, Content: "fixed assignment"}}, nil, kind)
				if err == nil || calls.Load() != 1 || job.record.Requests != 1 || len(job.record.Usage) != 1 {
					t.Fatalf("loss retried or discarded accounting: calls=%d requests=%d usage=%d err=%v", calls.Load(), job.record.Requests, len(job.record.Usage), err)
				}
				// A subsequent compact/continuity boundary must fail before HTTP
				// and must not consume another request from the user's budget.
				_, _, err = w.manager.agentRequest(ctx, job, settings, []Message{{Role: RoleUser, Content: "maintenance"}}, nil, kind)
				if err == nil || calls.Load() != 1 || job.record.Requests != 1 {
					t.Fatal("offline maintenance reached provider", err, calls.Load(), job.record.Requests)
				}
			})
		}
	}
}

func TestCollaborationLostStationPreventsReturnedShell(t *testing.T) {
	var lost atomic.Bool
	var calls atomic.Int32
	w := collaborationFixture(t, func(rw http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		lost.Store(true)
		fixtureAnswer(rw, "shell-after-loss", "", []any{map[string]any{"type": "function_call", "id": "fc_shell", "call_id": "call_shell", "name": "exec_command", "arguments": `{"cmd":"echo forbidden > should-not-exist.txt"}`}})
	}, func(_ context.Context, child *Workspace, action string) (workspaceMembership, error) {
		if lost.Load() && action == "working" {
			return workspaceMembership{}, fmt.Errorf("station offline before shell")
		}
		return confirmedStation(child, action), nil
	})
	child := createTestSplit(t, w, "shell-offline", "Do not execute shell after membership loss")
	record := waitSplitRecord(t, child)
	if record.State != "failed" || calls.Load() != 1 || record.ToolTurns != 0 {
		t.Fatal("unconfirmed shell proceeded", record.State, record.Error, calls.Load(), record.ToolTurns)
	}
	if _, err := os.Stat(filepath.Join(child.state.Workdir, "should-not-exist.txt")); !os.IsNotExist(err) {
		t.Fatal("shell side effect after loss", err)
	}
}

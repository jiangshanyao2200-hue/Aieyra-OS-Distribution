// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestWorkspaceShutdownWaitsForEveryStationAndKeepsRPCAndProfile; TestWorkspaceShutdownRejectsTaskScopeAndRetainsMemoryFailure
// Impact: python -B scripts/code-atlas.py show Core/workspace_shutdown_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"os"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestWorkspaceShutdownWaitsForEveryStationAndKeepsRPCAndProfile(t *testing.T) {
	finishing := make(chan string, 2)
	release := make(chan struct{}, 2)
	var finishes atomic.Int32
	w := collaborationFixture(t, func(rw http.ResponseWriter, r *http.Request) {
		fixtureAnswer(rw, "shutdown-fixture", "completed", nil)
	}, func(_ context.Context, child *Workspace, action string) (workspaceMembership, error) {
		if action == "finish" {
			finishes.Add(1)
			finishing <- child.state.ID
			<-release
		}
		return confirmedStation(child, action), nil
	})
	// Never strand cleanup if an assertion fails before both finishes arrive.
	t.Cleanup(func() { close(release) })
	a := createTestSplit(t, w, "shutdown-a", "shutdown-assignment-a")
	b := createTestSplit(t, w, "shutdown-b", "shutdown-assignment-b")
	waitSplitRecord(t, a)
	waitSplitRecord(t, b)
	c, err := NewMatrixControl(w.manager)
	if err != nil {
		t.Fatal(err)
	}
	w.host.controls[w.state.ID] = c
	call := func() map[string]any {
		t.Helper()
		request, _ := http.NewRequest("POST", c.address+"/v1/rpc", bytes.NewBufferString(`{"action":"workspace.shutdown","arguments":{}}`))
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("Authorization", "Bearer "+c.token)
		response, err := (&http.Client{Timeout: time.Second}).Do(request)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		var value struct {
			OK   bool           `json:"ok"`
			Data map[string]any `json:"data"`
		}
		if err := json.NewDecoder(response.Body).Decode(&value); err != nil || !value.OK {
			t.Fatal("shutdown RPC was lost", err)
		}
		return value.Data
	}
	if call()["phase"] != "stopping" {
		t.Fatal("returned before waiting for finish")
	}
	select {
	case <-finishing:
	case <-time.After(3 * time.Second):
		t.Fatal("no station finish")
	}
	if call()["phase"] != "stopping" {
		t.Fatal("duplicate close bypassed finish")
	}
	if _, err := os.Stat(w.dir); err != nil {
		t.Fatal("native profile removed before host exit", err)
	}
	if _, err := w.host.Open("", w.state.Workdir); err == nil {
		t.Fatal("host accepted work during close")
	}
	if _, err := w.Call(context.Background(), "workspace.send", rawJSON(map[string]any{"request_id": "late", "message": "late"})); err == nil {
		t.Fatal("stopping workspace accepted send")
	}
	release <- struct{}{}
	select {
	case <-finishing:
	case <-time.After(3 * time.Second):
		t.Fatal("second finish missing")
	}
	if call()["phase"] != "stopping" {
		t.Fatal("second finish not awaited")
	}
	release <- struct{}{}
	select {
	case <-w.host.beginShutdown():
	case <-time.After(3 * time.Second):
		t.Fatal("shutdown failed to finish")
	}
	if call()["phase"] != "stopped" || finishes.Load() != 2 {
		t.Fatal("missing or duplicate finish")
	}
	var concurrent sync.WaitGroup
	for i := 0; i < 3; i++ {
		concurrent.Add(1)
		go func() { defer concurrent.Done(); w.host.Close() }()
	}
	concurrent.Wait()
	if _, err := os.Stat(c.file); !os.IsNotExist(err) {
		t.Fatal("discovery survived final close", err)
	}
	if _, err := os.Stat(w.dir); !os.IsNotExist(err) {
		t.Fatal("native runtime survived final close", err)
	}
}

func TestWorkspaceShutdownRejectsTaskScopeAndRetainsMemoryFailure(t *testing.T) {
	w := collaborationFixture(t, func(rw http.ResponseWriter, r *http.Request) { fixtureAnswer(rw, "shutdown", "completed", nil) }, func(_ context.Context, child *Workspace, action string) (workspaceMembership, error) {
		member := confirmedStation(child, action)
		if action == "finish" {
			member.Error = "memory_save_unconfirmed"
		}
		return member, nil
	})
	child := createTestSplit(t, w, "scope", "scope-assignment")
	waitSplitRecord(t, child)
	if _, err := child.Call(context.Background(), "workspace.shutdown", nil); err == nil {
		t.Fatal("child closed its parent")
	}
	if _, err := w.Call(context.Background(), "workspace.shutdown", rawJSON(map[string]any{"task_id": child.state.ID})); err == nil {
		t.Fatal("selected task closed host")
	}
	w.host.mu.Lock()
	closed := w.host.closed
	w.host.mu.Unlock()
	if closed {
		t.Fatal("rejected shutdown changed host")
	}
	<-w.host.beginShutdown()
	state := w.host.shutdownStatus()
	if state["phase"] != "stopped" || state["failures"].(map[string]string)[child.state.ID] != "memory_save_unconfirmed" {
		t.Fatal("memory failure hidden", state)
	}
}

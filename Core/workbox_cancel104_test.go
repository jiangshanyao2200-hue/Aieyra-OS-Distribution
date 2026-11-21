// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: workflowCancel104Fixture; workflowCancel104; workflowWait104; read; start; TestWorkboxCancel104StopsBeforeRunnerRegistration; TestWorkboxCancel104SaveFailureStopsValidatedWork; TestWorkboxCancel104BusyStateDoesNotBypassValidation; TestWorkboxCancel104AcceptedWorkflowOutlivesCaller; TestWorkboxCancel104OldRequestDoesNotStopNewRun; TestWorkboxCancel104NativeParentStopsBeforeRunnerRegistration; TestWorkboxCancel104UnrelatedActorStopPreservesAdmission; TestWorkboxCancel104NativeRouteStopsBeforeRunnerRegistration; TestWorkboxCancel104RejectedBoundAdmissionSettlement
// Impact: python -B scripts/code-atlas.py show Core/workbox_cancel104_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/aieyra/aieyra-os/tool/workbox"
)

type workflowCancel104Fixture struct {
	m                *AgentManager
	identity         string
	store            workboxStore
	initial          workbox.Instance
	entered, stopped chan struct{}
	calls            atomic.Int32
}

func workflowCancel104(t *testing.T) *workflowCancel104Fixture {
	t.Helper()
	f := &workflowCancel104Fixture{entered: make(chan struct{}), stopped: make(chan struct{})}
	release := make(chan struct{})
	var entered, stopped sync.Once
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.calls.Add(1)
		_, _ = io.Copy(io.Discard, r.Body)
		entered.Do(func() { close(f.entered) })
		select {
		case <-r.Context().Done():
			stopped.Do(func() { close(f.stopped) })
		case <-release:
		}
		http.Error(w, "owned cancellation fixture", http.StatusServiceUnavailable)
	}))
	m, dir := matrixTestManager(t, func(http.ResponseWriter, *http.Request) { t.Error("unexpected language-model request") })
	m.config = imageGenTestConfig(t, server.URL, true)
	t.Setenv("AIEYRA_ROOT", mustProjectRoot(t))
	f.m = m
	f.identity = installWorkflowSample(t, m, "workbox-images")
	f.initial = workflowTestCall(t, m, context.Background(), f.identity, map[string]any{
		"action": "create", "request_id": "cancel104", "workdir": dir,
		"input": map[string]any{"prompt": "one owned local request", "edit_prompt": "never replay", "profile_id": "", "size": "1536x1024"},
	})
	var err error
	f.store, err = m.workflowStore(testMatrixOwner, f.initial.ID)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { close(release); m.Close(); server.Close() })
	return f
}

func workflowWait104(t *testing.T, label string, ready func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if ready() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("owned workflow did not reach " + label)
}

func (f *workflowCancel104Fixture) read(t *testing.T) workboxDocument {
	t.Helper()
	d, err := f.store.read()
	if err != nil {
		t.Fatal(err)
	}
	return d
}

func (f *workflowCancel104Fixture) start(t *testing.T, ctx context.Context) {
	t.Helper()
	if _, err := f.m.workflowCall(ctx, testMatrixOwner, f.identity, rawJSON(workflowCommandArgs("run", f.initial))); err != nil {
		t.Fatal(err)
	}
	select {
	case <-f.entered:
	case <-time.After(5 * time.Second):
		t.Fatal("local image provider was not reached")
	}
}

func TestWorkboxCancel104StopsBeforeRunnerRegistration(t *testing.T) {
	for _, action := range []string{"run", "resume"} {
		t.Run(action, func(t *testing.T) {
			f := workflowCancel104(t)
			if action == "resume" {
				var err error
				f.initial, err = f.store.update(context.Background(), func(d *workboxDocument) error {
					d.Instance.State = "paused"
					workflowTouch(&d.Instance)
					return nil
				})
				if err != nil {
					t.Fatal(err)
				}
			}
			stateLease, err := f.store.lock("state")
			if err != nil {
				t.Fatal(err)
			}
			defer stateLease.Close()
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			command := rawJSON(workflowCommandArgs(action, f.initial))
			type outcome struct {
				instance workbox.Instance
				err      error
			}
			done := make(chan outcome, 1)
			go func() {
				i, err := f.m.workflowCall(ctx, testMatrixOwner, f.identity, command)
				done <- outcome{i, err}
			}()
			workflowWait104(t, "owned runner lease before state commit", func() bool {
				lease, err := f.store.lock("runner")
				if err != nil {
					return true
				}
				lease.Close()
				return false
			})
			// The state lease ensures workflowOwner has finished before taking mu.
			// Hold registration while the real state transaction commits. This
			// exercises the production cancellation scan, not a mocked stop result.
			f.m.mu.Lock()
			locked := true
			defer func() {
				if locked {
					f.m.mu.Unlock()
				}
			}()
			stateLease.Close()
			workflowWait104(t, "committed run before runner registration", func() bool {
				d, err := f.store.read()
				return err == nil && d.Instance.State == "running"
			})
			if _, ok := f.m.workflowRuns.Load(f.store.dir); ok {
				t.Fatal("barrier did not precede runner registration")
			}
			f.m.cancelWorkflowRunsLocked(testMatrixOwner)
			cancel()
			f.m.mu.Unlock()
			locked = false
			var result outcome
			select {
			case result = <-done:
			case <-time.After(5 * time.Second):
				t.Fatal("stopped runner admission did not return")
			}
			if !errors.Is(result.err, context.Canceled) {
				t.Error("stopped caller was not rejected with its original cancellation", result.err)
			}
			select {
			case <-f.entered:
				t.Error("local provider was reached after the owning caller stopped")
			case <-time.After(400 * time.Millisecond):
			}
			d := f.read(t)
			t.Logf("action=%s admissionError=%v committedState=%s attempts=%d providerRequests=%d", action, result.err, d.Instance.State, d.Instance.Steps[0].Attempts, f.calls.Load())
			if f.calls.Load() != 0 || d.Instance.Steps[0].Attempts != 0 {
				t.Error("cancelled registration dispatched a workflow step")
			}
			if d.Instance.State != "cancelled" || result.instance.State != "cancelled" || result.instance.Revision != d.Instance.Revision {
				t.Error("rejected caller admission did not durably settle cancelled", result.instance.State, d.Instance.State)
			}
			// The run request really committed before the stop. Reading its
			// receipt must neither relaunch nor allocate a second runner.
			beforeReplay := f.calls.Load()
			if _, err := f.m.workflowCall(context.Background(), testMatrixOwner, f.identity, command); err != nil {
				t.Fatal("committed run receipt could not be read", err)
			}
			if f.calls.Load() != beforeReplay {
				t.Error("reading a stopped admission receipt dispatched again")
			}
		})
	}
}

func TestWorkboxCancel104SaveFailureStopsValidatedWork(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("actual Windows snapshot replacement denial")
	}
	f := workflowCancel104(t)
	f.start(t, context.Background())
	d := f.read(t)
	path := filepath.Join(f.store.dir, "state.json")
	original, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	// A read-only destination denies replacement while authoritative reads and
	// the state lease still work. Only this fixture's snapshot is changed.
	if err = os.Chmod(path, 0444); err != nil {
		t.Fatal(err)
	}
	defer os.Chmod(path, 0600)
	if err = f.store.write(d); err == nil {
		t.Fatal("fixture did not deny an actual snapshot write")
	}
	t.Logf("actual snapshot replacement failure: %v", err)
	command := workflowCommandArgs("cancel", d.Instance)
	for _, kind := range []string{"owner", "package", "revision", "request_id"} {
		t.Run("reject-"+kind, func(t *testing.T) {
			owner, identity := testMatrixOwner, f.identity
			bad := workflowCommandArgs("cancel", d.Instance)
			switch kind {
			case "owner":
				owner = "different-owner"
			case "package":
				identity += "-different"
			case "revision":
				bad["expected_revision"] = d.Instance.Revision - 1
			case "request_id":
				for request := range d.Requests {
					bad["request_id"] = request
					break
				}
			}
			if _, err := f.m.workflowCall(context.Background(), owner, identity, rawJSON(bad)); err == nil {
				t.Fatal("invalid cancellation was accepted")
			}
			select {
			case <-f.stopped:
				t.Fatal("invalid cancellation stopped the real provider")
			case <-time.After(50 * time.Millisecond):
			}
		})
	}
	result, cancelErr := f.m.workflowCall(context.Background(), testMatrixOwner, f.identity, rawJSON(command))
	if cancelErr == nil {
		t.Fatal("failed cancellation snapshot was reported committed")
	}
	select {
	case <-f.stopped:
	case <-time.After(2 * time.Second):
		t.Error("validated cancellation did not stop the real provider after snapshot failure")
	}
	current, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(original, current) {
		t.Fatal("failed cancellation changed the original snapshot", err)
	}
	after := f.read(t)
	if _, ok := after.Requests[fmt.Sprint(command["request_id"])]; ok {
		t.Fatal("failed cancellation consumed its request identity")
	}
	if result.State != after.Instance.State || result.Revision != after.Instance.Revision {
		t.Error("failed cancellation returned an uncommitted state or revision")
	}
	t.Logf("cancelError=%v returnedState=%s returnedRevision=%d diskState=%s diskRevision=%d providerRequests=%d bytesUnchanged=%v", cancelErr, result.State, result.Revision, after.Instance.State, after.Instance.Revision, f.calls.Load(), bytes.Equal(original, current))
	if f.calls.Load() != 1 {
		t.Fatal("cancellation duplicated the provider request")
	}
	if t.Failed() {
		return
	}
	if err = os.Chmod(path, 0600); err != nil {
		t.Fatal(err)
	}
	workflowWait104(t, "stopped runner lease release", func() bool {
		_, ok := f.m.workflowRuns.Load(f.store.dir)
		if ok {
			return false
		}
		lease, err := f.store.lock("runner")
		if err != nil {
			return false
		}
		lease.Close()
		return true
	})
	after = f.read(t)
	recovered, err := f.m.workflowCall(context.Background(), testMatrixOwner, f.identity, rawJSON(workflowCommandArgs("recover", after.Instance)))
	if err != nil || recovered.Steps[0].Attempts != 1 || f.calls.Load() != 1 || recovered.State == "completed" {
		t.Fatal("recovery replayed the uncertain effect or invented success", recovered, err)
	}
	// The failed request was not committed. After reading recovery's revision,
	// the caller can explicitly retry its original identity with current CAS.
	command["expected_revision"] = recovered.Revision
	last, err := f.m.workflowCall(context.Background(), testMatrixOwner, f.identity, rawJSON(command))
	if err != nil || last.State != "cancelled" || last.Steps[0].Attempts != 1 || f.calls.Load() != 1 {
		t.Fatal("explicit cancellation retry did not retain the original effect", last, err)
	}
	if _, err = f.m.workflowCall(context.Background(), testMatrixOwner, f.identity, rawJSON(command)); err != nil || f.calls.Load() != 1 {
		t.Fatal("committed cancel replay changed its effect", err)
	}
}

func TestWorkboxCancel104BusyStateDoesNotBypassValidation(t *testing.T) {
	f := workflowCancel104(t)
	f.start(t, context.Background())
	d := f.read(t)
	lease, err := f.store.lock("state")
	if err != nil {
		t.Fatal(err)
	}
	defer lease.Close()
	if _, err = f.m.workflowCall(context.Background(), testMatrixOwner, f.identity, rawJSON(workflowCommandArgs("cancel", d.Instance))); err == nil {
		t.Fatal("unvalidated busy-state cancellation was accepted")
	}
	select {
	case <-f.stopped:
		t.Fatal("busy cancellation bypassed the authoritative state transaction")
	case <-time.After(50 * time.Millisecond):
	}
	lease.Close()
	d = f.read(t)
	if _, err = f.m.workflowCall(context.Background(), testMatrixOwner, f.identity, rawJSON(workflowCommandArgs("cancel", d.Instance))); err != nil {
		t.Fatal(err)
	}
	select {
	case <-f.stopped:
	case <-time.After(5 * time.Second):
		t.Fatal("valid explicit retry did not stop the real provider")
	}
	if f.calls.Load() != 1 {
		t.Fatal("retry duplicated the provider request")
	}
}

func TestWorkboxCancel104AcceptedWorkflowOutlivesCaller(t *testing.T) {
	f := workflowCancel104(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	f.start(t, ctx)
	cancel() // Normal tool-turn cleanup must not revoke an accepted workflow.
	select {
	case <-f.stopped:
		t.Fatal("caller completion stopped the accepted background workflow")
	case <-time.After(150 * time.Millisecond):
	}
	d := f.read(t)
	if _, err := f.m.workflowCall(context.Background(), testMatrixOwner, f.identity, rawJSON(workflowCommandArgs("cancel", d.Instance))); err != nil {
		t.Fatal(err)
	}
	select {
	case <-f.stopped:
	case <-time.After(5 * time.Second):
		t.Fatal("explicit cancellation did not reach the accepted background workflow")
	}
	if f.calls.Load() != 1 {
		t.Fatal("accepted workflow was replayed")
	}
}

func TestWorkboxCancel104OldRequestDoesNotStopNewRun(t *testing.T) {
	f := workflowCancel104(t)
	old := workflowCommandArgs("cancel", f.initial)
	cancelled, err := f.m.workflowCall(context.Background(), testMatrixOwner, f.identity, rawJSON(old))
	if err != nil || cancelled.State != "cancelled" {
		t.Fatal("idle cancellation did not commit", cancelled, err)
	}
	f.initial, err = f.m.workflowCall(context.Background(), testMatrixOwner, f.identity, rawJSON(workflowCommandArgs("recover", cancelled)))
	if err != nil || f.initial.State != "paused" {
		t.Fatal("explicit recovery did not retain pending work", f.initial, err)
	}
	f.start(t, context.Background())
	if _, err = f.m.workflowCall(context.Background(), testMatrixOwner, f.identity, rawJSON(old)); err != nil {
		t.Fatal("original cancellation receipt could not be read", err)
	}
	current := f.read(t)
	old["expected_revision"] = current.Instance.Revision
	if _, err = f.m.workflowCall(context.Background(), testMatrixOwner, f.identity, rawJSON(old)); err == nil {
		t.Fatal("old cancellation identity accepted changed input")
	}
	select {
	case <-f.stopped:
		t.Fatal("old cancellation receipt or conflicting retry stopped a newer run")
	case <-time.After(150 * time.Millisecond):
	}
	if _, err = f.m.workflowCall(context.Background(), testMatrixOwner, f.identity, rawJSON(workflowCommandArgs("cancel", current.Instance))); err != nil {
		t.Fatal(err)
	}
	select {
	case <-f.stopped:
	case <-time.After(5 * time.Second):
		t.Fatal("new cancellation did not stop the current run")
	}
	if f.calls.Load() != 1 {
		t.Fatal("old cancellation replayed a provider request")
	}
}

func TestWorkboxCancel104NativeParentStopsBeforeRunnerRegistration(t *testing.T) {
	for _, action := range []string{"run", "resume"} {
		t.Run(action, func(t *testing.T) {
			f := workflowCancel104(t)
			workdir := f.read(t).Workdir
			w := workboxHostFixture(t, f.m, workdir)
			parent := strings.Repeat("6", 32)
			f.m.mu.Lock()
			f.m.jobs[parent] = &agentJob{record: AgentRecord{ID: parent, Parent: f.m.owner, State: "completed", Spec: AgentSpec{WorkspaceRole: WorkspaceMatrix}}}
			f.m.mu.Unlock()
			w.state.Roles[WorkspaceMatrix] = parent
			i := nativeWorkbox(t, w, f.identity, "call", map[string]any{"command": map[string]any{
				"action": "create", "request_id": "native-parent-cancel104", "workdir": workdir,
				"input": map[string]any{"prompt": "one native owned request", "edit_prompt": "never replay", "profile_id": "", "size": "1536x1024"},
			}})["instance"].(workbox.Instance)
			service := f.m.workboxHost.Load()
			store, err := service.workflowStore(i.Owner, i.ID)
			if err != nil {
				t.Fatal(err)
			}
			if action == "resume" {
				i, err = store.update(context.Background(), func(d *workboxDocument) error {
					d.Instance.State = "paused"
					workflowTouch(&d.Instance)
					return nil
				})
				if err != nil {
					t.Fatal(err)
				}
			}
			stateLease, err := store.lock("state")
			if err != nil {
				t.Fatal(err)
			}
			defer stateLease.Close()
			ctx := context.Background() // Native RPC lifetime is independent of the parent job.
			command := workflowCommandArgs(action, i)
			type outcome struct {
				result any
				err    error
			}
			done := make(chan outcome, 1)
			go func() {
				result, err := w.workboxesCall(ctx, rawJSON(map[string]any{"action": "call", "package": f.identity, "owner": i.Owner, "command": command}))
				done <- outcome{result, err}
			}()
			workflowWait104(t, "native runner lease before its state transaction", func() bool {
				lease, err := store.lock("runner")
				if err != nil {
					return true
				}
				lease.Close()
				return false
			})
			if err := f.m.Cancel(f.m.owner, parent); err != nil {
				t.Fatal("actual primary stop failed", err)
			}
			stateLease.Close()
			var result outcome
			select {
			case result = <-done:
			case <-time.After(5 * time.Second):
				t.Fatal("native admission did not return after actual parent stop")
			}
			if result.err != nil {
				t.Fatal("native RPC did not return its command outcome", result.err)
			}
			out := result.result.(map[string]any)
			if out["ok"] != false || !strings.Contains(fmt.Sprint(out["error"]), "stopped") {
				t.Error("native command did not reject the stopped admission", out)
			}
			select {
			case <-f.entered:
				t.Error("native workflow reached the provider after actual parent stop")
			case <-time.After(400 * time.Millisecond):
			}
			d, err := store.read()
			if err != nil {
				t.Fatal(err)
			}
			t.Logf("action=%s actualPrimaryCancelReturned=true nativeCallerContextError=%v rejected=%v providerRequests=%d attempts=%d", action, ctx.Err(), out["ok"] == false, f.calls.Load(), d.Instance.Steps[0].Attempts)
			if ctx.Err() != nil || f.calls.Load() != 0 || d.Instance.Steps[0].Attempts != 0 {
				t.Error("parent cancellation failed to fence independent native admission")
			}
			if d.Instance.State != "cancelled" || out["instance"].(workbox.Instance).State != "cancelled" {
				t.Error("rejected native admission remained active without a runner", d.Instance.State)
			}
			if t.Failed() {
				return
			}
			// The original request is a receipt, not permission to restart it.
			nativeWorkbox(t, w, f.identity, "call", map[string]any{"owner": i.Owner, "command": command})
			if f.calls.Load() != 0 {
				t.Fatal("reading the stopped native request restarted it")
			}
			i = nativeWorkbox(t, w, f.identity, "call", map[string]any{"owner": i.Owner, "command": workflowCommandArgs("recover", d.Instance)})["instance"].(workbox.Instance)
			if i.State != "paused" || i.Steps[0].Attempts != 0 {
				t.Fatal("explicit recovery did not retain untouched steps", i)
			}
			nativeWorkbox(t, w, f.identity, "call", map[string]any{"owner": i.Owner, "command": workflowCommandArgs("resume", i)})
			select {
			case <-f.entered:
			case <-time.After(5 * time.Second):
				t.Fatal("fresh native command after parent stop could not run")
			}
			if err := f.m.Cancel(f.m.owner, parent); err != nil {
				t.Fatal("second actual parent stop failed", err)
			}
			select {
			case <-f.stopped:
			case <-time.After(5 * time.Second):
				t.Fatal("parent stop missed the already registered native request")
			}
			if f.calls.Load() != 1 {
				t.Fatal("native recovery replayed a provider operation", f.calls.Load())
			}
		})
	}
}

func TestWorkboxCancel104UnrelatedActorStopPreservesAdmission(t *testing.T) {
	f := workflowCancel104(t)
	other := strings.Repeat("7", 32)
	f.m.mu.Lock()
	f.m.jobs[other] = &agentJob{record: AgentRecord{ID: other, Parent: f.m.owner, State: "completed"}}
	f.m.mu.Unlock()
	stateLease, err := f.store.lock("state")
	if err != nil {
		t.Fatal(err)
	}
	defer stateLease.Close()
	done := make(chan error, 1)
	go func() {
		_, err := f.m.workflowCall(context.Background(), testMatrixOwner, f.identity, rawJSON(workflowCommandArgs("run", f.initial)))
		done <- err
	}()
	workflowWait104(t, "unrelated actor admission runner lease", func() bool {
		lease, err := f.store.lock("runner")
		if err != nil {
			return true
		}
		lease.Close()
		return false
	})
	if err := f.m.Cancel(f.m.owner, other); err != nil {
		t.Fatal("unrelated actor stop failed", err)
	}
	stateLease.Close()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal("unrelated actor stop rejected this owner's admission", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("unrelated actor stop blocked this owner's admission")
	}
	select {
	case <-f.entered:
	case <-time.After(5 * time.Second):
		t.Fatal("uncancelled owner never reached its owned provider")
	}
	d := f.read(t)
	if _, err := f.m.workflowCall(context.Background(), testMatrixOwner, f.identity, rawJSON(workflowCommandArgs("cancel", d.Instance))); err != nil {
		t.Fatal(err)
	}
	select {
	case <-f.stopped:
	case <-time.After(5 * time.Second):
		t.Fatal("valid explicit stop did not reach the uncancelled owner's provider")
	}
	if f.calls.Load() != 1 {
		t.Fatal("unrelated actor stop duplicated a provider operation", f.calls.Load())
	}
}

func TestWorkboxCancel104NativeRouteStopsBeforeRunnerRegistration(t *testing.T) {
	f := workflowCancel104(t)
	workdir := f.read(t).Workdir
	w := workboxHostFixture(t, f.m, workdir)
	parent := strings.Repeat("8", 32)
	f.m.mu.Lock()
	f.m.jobs[parent] = &agentJob{record: AgentRecord{ID: parent, Parent: f.m.owner, State: "completed", Spec: AgentSpec{WorkspaceRole: WorkspaceMatrix}}}
	f.m.mu.Unlock()
	w.state.Roles[WorkspaceMatrix] = parent
	i := nativeWorkbox(t, w, f.identity, "call", map[string]any{"command": map[string]any{
		"action": "create", "request_id": "native-route-cancel104", "workdir": workdir,
		"input": map[string]any{"prompt": "one native owned request", "edit_prompt": "never replay", "profile_id": "", "size": "1536x1024"},
	}})["instance"].(workbox.Instance)
	admitted, release := make(chan struct{}), make(chan struct{})
	var gateOnce, releaseOnce sync.Once
	t.Cleanup(func() { releaseOnce.Do(func() { close(release) }) })
	ctx := context.WithValue(context.Background(), liveToolPermissionKey{}, func(name string) bool {
		if name == f.identity {
			gateOnce.Do(func() { close(admitted); <-release })
		}
		return true
	})
	type outcome struct {
		result any
		err    error
	}
	done := make(chan outcome, 1)
	go func() {
		result, err := w.workboxesCall(ctx, rawJSON(map[string]any{"action": "call", "package": f.identity, "owner": i.Owner, "command": workflowCommandArgs("run", i)}))
		done <- outcome{result, err}
	}()
	select {
	case <-admitted:
	case <-time.After(5 * time.Second):
		t.Fatal("native RPC did not reach its actual post-routing package check")
	}
	if err := f.m.Cancel(f.m.owner, parent); err != nil {
		t.Fatal("actual primary stop failed", err)
	}
	releaseOnce.Do(func() { close(release) })
	select {
	case result := <-done:
		if result.err != nil {
			t.Fatal(result.err)
		}
		if result.result.(map[string]any)["ok"] != false {
			t.Error("native request routed before parent stop was admitted afterward")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("native RPC did not finish")
	}
	select {
	case <-f.entered:
		t.Error("old routed native RPC reached the provider after parent stop")
	case <-time.After(400 * time.Millisecond):
	}
	service := f.m.workboxHost.Load()
	store, err := service.workflowStore(i.Owner, i.ID)
	if err != nil {
		t.Fatal(err)
	}
	d, err := store.read()
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("actualPrimaryCancelReturned=true nativeCallerContextError=%v providerRequests=%d attempts=%d", ctx.Err(), f.calls.Load(), d.Instance.Steps[0].Attempts)
	if ctx.Err() != nil || f.calls.Load() != 0 || d.Instance.Steps[0].Attempts != 0 {
		t.Error("native route was not fenced by actual parent cancellation")
	}
	if d.Instance.State != "cancelled" {
		t.Error("rejected native route remained active without a runner", d.Instance.State)
	}
}

func TestWorkboxCancel104RejectedBoundAdmissionSettlement(t *testing.T) {
	for _, scenario := range []string{"settle", "concurrent-pause", "concurrent-cancel", "write-failure", "state-busy"} {
		t.Run(scenario, func(t *testing.T) {
			if scenario == "write-failure" && runtime.GOOS != "windows" {
				t.Skip("actual Windows snapshot replacement denial")
			}
			f := workflowCancel104(t)
			const actor = "owned-stopped-bound-specialist"
			bound := &AgentManager{ctx: context.Background(), jobs: map[string]*agentJob{actor: {record: AgentRecord{ID: actor, State: "cancelled"}}}}
			bound.mu.Lock()
			locked := true
			defer func() {
				if locked {
					bound.mu.Unlock()
				}
			}()
			ctx := context.WithValue(context.Background(), packageWorkflowRunnerKey{}, packageWorkflowRunner{manager: bound, actor: actor})
			type outcome struct {
				instance workbox.Instance
				err      error
			}
			done := make(chan outcome, 1)
			go func() {
				i, err := f.m.workflowCall(ctx, testMatrixOwner, f.identity, rawJSON(workflowCommandArgs("run", f.initial)))
				done <- outcome{i, err}
			}()
			workflowWait104(t, "committed run awaiting real bound registration", func() bool {
				d, err := f.store.read()
				return err == nil && d.Instance.State == "running"
			})
			d := f.read(t)
			if strings.HasPrefix(scenario, "concurrent-") {
				action := strings.TrimPrefix(scenario, "concurrent-")
				if _, err := f.m.workflowCall(context.Background(), testMatrixOwner, f.identity, rawJSON(workflowCommandArgs(action, d.Instance))); err != nil {
					t.Fatal("concurrent command was not committed", err)
				}
				d = f.read(t)
			}
			path := filepath.Join(f.store.dir, "state.json")
			before, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if scenario == "write-failure" {
				if err := os.Chmod(path, 0444); err != nil {
					t.Fatal(err)
				}
				defer os.Chmod(path, 0600)
				if err := f.store.write(d); err == nil {
					t.Fatal("fixture did not deny an actual snapshot write")
				}
			}
			if scenario == "state-busy" {
				lease, err := f.store.lock("state")
				if err != nil {
					t.Fatal(err)
				}
				defer lease.Close()
			}
			bound.mu.Unlock()
			locked = false
			var result outcome
			select {
			case result = <-done:
			case <-time.After(5 * time.Second):
				t.Fatal("rejected bound admission did not return within its bounded settlement")
			}
			after := f.read(t)
			if result.err == nil || f.calls.Load() != 0 || after.Instance.Steps[0].Attempts != 0 {
				t.Fatal("stopped bound specialist was revived", result, f.calls.Load())
			}
			if result.instance.State != after.Instance.State || result.instance.Revision != after.Instance.Revision {
				t.Error("rejected admission returned an uncommitted snapshot", result.instance.State, result.instance.Revision, after.Instance.State, after.Instance.Revision)
			}
			if scenario == "settle" {
				if after.Instance.State != "cancelled" || after.Instance.Revision != d.Instance.Revision+1 || len(after.Requests) != len(d.Requests) {
					t.Error("stopped bound admission did not settle with its original receipts", after.Instance.State, after.Instance.Revision)
				}
			} else {
				current, err := os.ReadFile(path)
				if err != nil || !bytes.Equal(before, current) {
					t.Error("failed settlement overwrote the committed snapshot", err)
				}
				if !strings.Contains(result.err.Error(), "cancellation state was not saved") {
					t.Error("failed settlement hid the persistence outcome", result.err)
				}
				if scenario == "write-failure" && !errors.Is(result.err, os.ErrPermission) {
					t.Error("rejected admission did not report the real snapshot write denial", result.err)
				}
				if scenario == "state-busy" && !strings.Contains(result.err.Error(), "state is busy") {
					t.Error("rejected admission did not report the actual state lease failure", result.err)
				}
			}
			t.Logf("scenario=%s error=%v committedState=%s revision=%d providerRequests=%d", scenario, result.err, after.Instance.State, after.Instance.Revision, f.calls.Load())
		})
	}
}

// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: workboxHostFixture; nativeWorkbox; retainedWorkbox; TestWorkboxPrimaryRestartKeepsInstanceSpecialistAndTaskProjection; TestWorkboxPrimaryCancellationReachesInflightImageWithoutShell; TestWorkboxListPaginatesMetadataWithoutReceiptBodies
// Impact: python -B scripts/code-atlas.py show Core/workbox_host_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/aieyra/aieyra-os/CORE/modules"
	"github.com/aieyra/aieyra-os/tool/workbox"
)

func workboxHostFixture(t *testing.T, m *AgentManager, dir string) *Workspace {
	t.Helper()
	h := NewWorkspaceHost(m.config, "", "")
	t.Cleanup(func() { m.Close(); h.Close() })
	h.mode = HostOS
	w := &Workspace{host: h, manager: m, config: m.config, dir: t.TempDir(), live: map[string]WorkspaceLive{}, state: workspaceState{ID: m.owner, Workdir: dir, Roles: map[string]string{}}}
	m.workspace = w
	if err := w.openWorkboxHost(); err != nil {
		t.Fatal(err)
	}
	return w
}
func nativeWorkbox(t *testing.T, w *Workspace, identity, action string, extra map[string]any) map[string]any {
	t.Helper()
	p := map[string]any{"action": action, "package": identity}
	for k, v := range extra {
		p[k] = v
	}
	r, err := w.workboxesCall(context.Background(), rawJSON(p))
	if err != nil {
		t.Fatal(err)
	}
	out := r.(map[string]any)
	if out["ok"] != true {
		t.Fatal(out)
	}
	return out
}
func retainedWorkbox(t *testing.T, m *AgentManager) string {
	t.Helper()
	p, err := modules.Load(context.Background(), filepath.Join(mustProjectRoot(t), "SDK/examples/workbox-statistics"))
	if err != nil {
		t.Fatal(err)
	}
	var d workbox.Definition
	if err = json.Unmarshal(p.Files["workflow.json"], &d); err != nil {
		t.Fatal(err)
	}
	d.AgentTemplate.Retention = "retained"
	p.Files["workflow.json"] = rawJSON(d)
	dir := t.TempDir()
	for name, raw := range p.Files {
		if name == "manifest.json" {
			continue
		}
		sum := sha256.Sum256(raw)
		p.Manifest.Files[name] = modules.File{SHA256: hex.EncodeToString(sum[:]), Size: int64(len(raw))}
		if err = os.WriteFile(filepath.Join(dir, name), raw, 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err = os.WriteFile(filepath.Join(dir, "manifest.json"), rawJSON(p.Manifest), 0600); err != nil {
		t.Fatal(err)
	}
	r := packageMutation(t, m.toolPackages(), "install", dir, "", p.Manifest.Permissions)
	packageMutation(t, m.toolPackages(), "enable", "", p.Manifest.ID, p.Manifest.Permissions)
	return "mod:" + p.Manifest.ID + "@" + r.Digest
}
func TestWorkboxPrimaryRestartKeepsInstanceSpecialistAndTaskProjection(t *testing.T) {
	var calls atomic.Int32
	m, dir := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		fixtureAnswer(w, "done", "Receipt inspected", nil)
	})
	t.Setenv("AIEYRA_ROOT", mustProjectRoot(t))
	w := workboxHostFixture(t, m, dir)
	installWorkflowSample(t, m, "tool-statistics")
	installWorkflowSample(t, m, "toolbox-report")
	identity := retainedWorkbox(t, m)
	create := map[string]any{"action": "create", "request_id": "durable", "workdir": dir, "input": map[string]any{"values": []int{2, 3, 7}, "workdir": dir, "file": "durable.json"}}
	i := nativeWorkbox(t, w, identity, "call", map[string]any{"command": create})["instance"].(workbox.Instance)
	args := workflowCommandArgs("create_agent", i)
	args["model_id"] = "local-model"
	i = nativeWorkbox(t, w, identity, "call", map[string]any{"owner": i.Owner, "command": args})["instance"].(workbox.Instance)
	r, err := m.Wait(context.Background(), m.owner, i.AgentID, 10000)
	if err != nil || r.State != "completed" || calls.Load() != 1 {
		t.Fatal(r, err, calls.Load())
	}
	if _, err = w.taskSnapshot(i.AgentID, WorkspaceCursor{}); err != nil {
		t.Fatal(err)
	}
	if len(w.localTaskList()) != 2 {
		t.Fatal("specialist missing from task navigation")
	}
	m.Close()
	// A new primary window has a different ephemeral ID, while the same durable
	// specialist and workflow remain owned by the same private user service.
	next, err := newAgentManager(m.config, strings.Repeat("3", 32), nil, filepath.Join(dir, "next-manager"))
	if err != nil {
		t.Fatal(err)
	}
	defer next.Close()
	reopened := workboxHostFixture(t, next, dir)
	rows := nativeWorkbox(t, reopened, identity, "list", nil)["instances"].([]workboxSummary)
	if len(rows) != 1 || rows[0].ID != i.ID || rows[0].AgentID != i.AgentID || rows[0].Owner != i.Owner {
		t.Fatal(rows)
	}
	if calls.Load() != 1 {
		t.Fatal("reopen auto-started model")
	}
	if _, err = next.SendGeneration(next.owner, i.AgentID, "second", "Inspect the saved result again", r.Generation); err != nil {
		t.Fatal(err)
	}
	r, err = next.Wait(context.Background(), next.owner, i.AgentID, 10000)
	if err != nil || r.Generation != 2 || r.State != "completed" || calls.Load() != 2 {
		t.Fatal(r, err)
	}
	if _, err = reopened.taskSnapshot(i.AgentID, WorkspaceCursor{}); err != nil {
		t.Fatal(err)
	}
	if _, err = next.Status("unrelated-owner", i.AgentID); err == nil {
		t.Fatal("helper acquired primary workflow authority")
	}
	if !next.savedWorkflow(context.Background(), next.owner, identity, rawJSON(map[string]any{"action": "status", "id": i.ID})) {
		t.Fatal("old receipt inaccessible to Toolbox")
	}
}

func TestWorkboxPrimaryCancellationReachesInflightImageWithoutShell(t *testing.T) {
	var calls atomic.Int32
	entered, stopped, release := make(chan struct{}), make(chan struct{}), make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		_, _ = io.Copy(io.Discard, r.Body)
		close(entered)
		select {
		case <-r.Context().Done():
			close(stopped)
		case <-release:
		}
	}))
	defer server.Close()
	defer close(release)
	m, dir := matrixTestManager(t, func(http.ResponseWriter, *http.Request) { t.Error("unexpected model") })
	m.config = imageGenTestConfig(t, server.URL, true)
	t.Setenv("AIEYRA_ROOT", mustProjectRoot(t))
	w := workboxHostFixture(t, m, dir)
	identity := installWorkflowSample(t, m, "workbox-images")
	parent := strings.Repeat("4", 32)
	m.jobs[parent] = &agentJob{record: AgentRecord{ID: parent, Parent: m.owner, Depth: 1, State: "completed", Spec: AgentSpec{WorkspaceRole: WorkspaceMatrix}}}
	w.state.Roles[WorkspaceMatrix] = parent
	i := nativeWorkbox(t, w, identity, "call", map[string]any{"command": map[string]any{"action": "create", "request_id": "cancel-inflight", "workdir": dir, "input": map[string]any{"prompt": "one request", "edit_prompt": "no replay", "profile_id": "", "size": "1536x1024"}}})["instance"].(workbox.Instance)
	nativeWorkbox(t, w, identity, "call", map[string]any{"owner": i.Owner, "command": workflowCommandArgs("run", i)})
	select {
	case <-entered:
	case <-time.After(5 * time.Second):
		t.Fatal("provider was not reached")
	}
	if err := m.Cancel(m.owner, parent); err != nil {
		t.Fatal(err)
	}
	select {
	case <-stopped:
	case <-time.After(5 * time.Second):
		current, _ := m.workboxHost.Load().workflowCall(context.Background(), m.workboxHost.Load().owner, identity, rawJSON(map[string]any{"action": "status", "id": i.ID}))
		t.Fatal("parent cancellation did not reach provider", current)
	}
	svc := m.workboxHost.Load()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		current, err := svc.workflowCall(context.Background(), svc.owner, identity, rawJSON(map[string]any{"action": "status", "id": i.ID}))
		if err != nil {
			t.Fatal(err)
		}
		if current.State == "unknown" || current.State == "cancelled" {
			if calls.Load() != 1 || current.Steps[0].Attempts != 1 || current.Steps[2].Attempts != 0 || len(current.Usage) != 1 {
				t.Fatal(current, calls.Load())
			}
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("cancelled workflow did not settle")
}

func TestWorkboxListPaginatesMetadataWithoutReceiptBodies(t *testing.T) {
	m, dir := matrixTestManager(t, func(http.ResponseWriter, *http.Request) { t.Error("unexpected model") })
	t.Setenv("AIEYRA_ROOT", mustProjectRoot(t))
	w := workboxHostFixture(t, m, dir)
	identity := installWorkflowSample(t, m, "workbox-images")
	for n := 0; n < 23; n++ {
		nativeWorkbox(t, w, identity, "call", map[string]any{"command": map[string]any{"action": "create", "request_id": fmt.Sprint("page-", n), "workdir": dir, "input": map[string]any{"prompt": strings.Repeat("x", 2000), "edit_prompt": "edit", "profile_id": "", "size": "1536x1024"}}})
	}
	first := nativeWorkbox(t, w, identity, "list", map[string]any{"limit": 20})
	last := nativeWorkbox(t, w, identity, "list", map[string]any{"offset": 20, "limit": 20})
	if first["total"] != 23 || len(first["instances"].([]workboxSummary)) != 20 || len(last["instances"].([]workboxSummary)) != 3 || last["next_offset"] != 23 {
		t.Fatal(first, last)
	}
	raw := rawJSON(first)
	if strings.Contains(string(raw), "definition") || strings.Contains(string(raw), "edit_prompt") || len(raw) > 20000 {
		t.Fatal("list leaked full receipts", len(raw))
	}
}

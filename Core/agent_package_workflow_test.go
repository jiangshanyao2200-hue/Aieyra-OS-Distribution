// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: standardWorkflowFixture; createStandardWorkflow; TestAgentPackageWorkboxActualPortIsolationAndRestart; TestAgentPackageWorkboxCreationRecoversUnlinkedIdleReceipt; standardImageWorkflow; TestAgentPackageWorkboxCancellationOutlivesSpecialistTurn; TestAgentPackageWorkboxOwnerCancellationStopsActiveSpecialist
// Impact: python -B scripts/code-atlas.py show Core/agent_package_workflow_test.go
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

func standardWorkflowFixture(t *testing.T, handler http.HandlerFunc) (*AgentManager, *Workspace, string, string) {
	t.Helper()
	m, dir := matrixTestManager(t, handler)
	t.Setenv("AIEYRA_ROOT", mustProjectRoot(t))
	w := workboxHostFixture(t, m, dir)
	for _, sample := range []string{"tool-statistics", "toolbox-report", "agent-workflow-manager"} {
		installWorkflowSample(t, m, sample)
	}
	return m, w, dir, installWorkflowSample(t, m, "workbox-specialist")
}

func createStandardWorkflow(t *testing.T, w *Workspace, identity, dir, request string) workbox.Instance {
	t.Helper()
	return nativeWorkbox(t, w, identity, "call", map[string]any{"command": map[string]any{"action": "create", "request_id": request, "workdir": dir, "input": map[string]any{"values": []int{2, 3, 7}, "workdir": dir, "file": request + ".json"}}})["instance"].(workbox.Instance)
}

func TestAgentPackageWorkboxActualPortIsolationAndRestart(t *testing.T) {
	var calls atomic.Int32
	var current workbox.Instance
	m, w, dir, identity := standardWorkflowFixture(t, func(rw http.ResponseWriter, req *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(req.Body).Decode(&body)
		text := string(rawJSON(body))
		if strings.Contains(text, "PRIVATE_PRIMARY_WORKFLOW") || strings.Contains(text, "shared_baseline") || strings.Contains(text, "pac_memory") {
			t.Error("workflow specialist inherited primary private context")
		}
		n := calls.Add(1)
		args := map[string]any{"action": "open", "name": "software_api"}
		if n == 2 {
			args = map[string]any{"action": "call", "name": "software_api", "arguments": map[string]any{"action": "workflow", "operation": "status", "arguments": map[string]any{}}}
		}
		if n == 3 {
			if !strings.Contains(text, current.ID) {
				t.Error("bound status did not reach the model")
			}
			args = map[string]any{"action": "call", "name": "software_api", "arguments": map[string]any{"action": "workflow", "operation": "run", "arguments": map[string]any{"expected_revision": current.Revision, "request_id": "one-run"}}}
		}
		if n > 3 {
			fixtureAnswer(rw, fmt.Sprint("done-", n), "Workflow submitted; wait for independent review.", nil)
			return
		}
		id := fmt.Sprint("tool-", n)
		fixtureAnswer(rw, id, "", []any{map[string]any{"type": "function_call", "id": id, "call_id": id, "name": "toolbox", "arguments": string(rawJSON(args))}})
	})
	w.prompt = "PRIVATE_PRIMARY_WORKFLOW"
	current = createStandardWorkflow(t, w, identity, dir, "standard")
	create := workflowCommandArgs("create_agent", current)
	create["model_id"] = "local-model"
	current = nativeWorkbox(t, w, identity, "call", map[string]any{"command": create})["instance"].(workbox.Instance)
	manager := m.packageHost.Load()
	r, err := manager.Status(manager.owner, current.AgentID)
	if err != nil || r.Instance == nil || r.Instance.Workflow == nil || r.State != "idle" || r.Generation != 0 || r.Spec.WorkflowID != "" || r.Instance.Supervisor != "primary" || calls.Load() != 0 {
		t.Fatal("creation did not produce an idle standard isolated instance", r, err)
	}
	replay := nativeWorkbox(t, w, identity, "call", map[string]any{"command": create})["instance"].(workbox.Instance)
	if replay.AgentID != r.ID || len(manager.List(manager.owner)) != 1 || calls.Load() != 0 {
		t.Fatal("workflow creation repeated the specialist")
	}
	// software_api alone cannot launder revoked workflow tool permissions.
	if _, err := manager.packageAgentCommand(WithToolPermissions(context.Background(), []string{"software_api"}), "primary", agentPackageCommand{Action: "send", ID: r.ID, RequestID: "denied", Message: "run", Generation: 0}); err == nil {
		t.Fatal("scoped send bypassed the supervisor's workflow capabilities")
	}
	r, _ = manager.Status(manager.owner, r.ID)
	if r.Generation != 0 || r.Turns["denied"] != "" {
		t.Fatal("denied send consumed its request")
	}
	if _, err := manager.SendGeneration(manager.owner, r.ID, "start", "Inspect and run your accepted workflow.", 0); err != nil {
		t.Fatal(err)
	}
	r, err = manager.Wait(context.Background(), manager.owner, r.ID, 10000)
	if err != nil || r.State != "completed" || r.ToolTurns != 3 || calls.Load() != 4 {
		t.Fatal("actual bound tool chain failed", r, err, calls.Load())
	}
	svc := m.workboxHost.Load()
	deadline := time.Now().Add(10 * time.Second)
	for {
		current, err = svc.workflowCall(context.Background(), svc.owner, identity, rawJSON(map[string]any{"action": "status", "id": current.ID}))
		if err != nil {
			t.Fatal(err)
		}
		if current.State == "awaiting_review" {
			break
		}
		if current.State != "running" || time.Now().After(deadline) {
			t.Fatal("workflow did not reach review", current)
		}
		time.Sleep(20 * time.Millisecond)
	}
	port := packageRuntimeContext{manager, r}
	for _, operation := range []string{"approve", "create", "create_agent"} {
		if _, err := port.workflow(context.Background(), operation, rawJSON(map[string]any{})); err == nil {
			t.Fatal("specialist approved or spawned work", operation)
		}
	}
	if _, err := port.workflow(context.Background(), "status", rawJSON(map[string]any{"id": "w-" + strings.Repeat("0", 32)})); err == nil {
		t.Fatal("specialist accessed another workflow")
	}
	if _, err := os.Stat(filepath.Join(dir, "standard.json")); !os.IsNotExist(err) {
		t.Fatal("review was bypassed", err)
	}
	if current.Steps[0].Attempts != 1 || !strings.Contains(string(current.Steps[0].Result), `"sum":12`) {
		t.Fatal("actual tool output missing", current)
	}
	m.Close()
	next, err := newAgentManager(m.config, strings.Repeat("7", 32), nil, filepath.Join(dir, "reopened-primary"))
	if err != nil {
		t.Fatal(err)
	}
	defer next.Close()
	reopened := workboxHostFixture(t, next, dir)
	manager, err = next.ensurePackageAgentHost(true)
	if err != nil {
		t.Fatal(err)
	}
	restored, err := manager.Status(manager.owner, r.ID)
	if err != nil || restored.Generation != 1 || restored.Instance.Workflow.ID != current.ID || calls.Load() != 4 {
		t.Fatal("restart lost the binding or replayed the model", restored, err)
	}
	if _, err := reopened.taskSnapshot(r.ID, WorkspaceCursor{}); err != nil {
		t.Fatal("standard specialist absent from common task view", err)
	}
	if _, err := (packageRuntimeContext{manager, restored}).workflow(context.Background(), "status", rawJSON(map[string]any{})); err != nil {
		t.Fatal("reopened bound port failed", err)
	}
}

func TestAgentPackageWorkboxCreationRecoversUnlinkedIdleReceipt(t *testing.T) {
	m, w, dir, identity := standardWorkflowFixture(t, func(http.ResponseWriter, *http.Request) { t.Error("idle recovery called a model") })
	i := createStandardWorkflow(t, w, identity, dir, "unlinked")
	svc := m.workboxHost.Load()
	store, _ := svc.workflowStore(svc.owner, i.ID)
	d, err := store.read()
	if err != nil {
		t.Fatal(err)
	}
	// The Agent write succeeded; the workflow link has not committed yet.
	r, err := svc.createWorkflowPackageAgent(context.Background(), &d, "local-model")
	if err != nil {
		t.Fatal(err)
	}
	manager := m.packageHost.Load()
	if _, err = manager.SendGeneration(manager.owner, r.ID, "too-early", "run", 0); err == nil {
		t.Fatal("unlinked Agent ran")
	}
	packageMutation(t, manager.toolPackages(), "disable", "", "example.specialist-workflow", nil)
	packageMutation(t, manager.toolPackages(), "disable", "", "example.workflow-manager", nil)
	create := workflowCommandArgs("create_agent", i)
	create["model_id"] = "local-model"
	i = nativeWorkbox(t, w, identity, "call", map[string]any{"command": create})["instance"].(workbox.Instance)
	if i.AgentID != r.ID || len(manager.List(manager.owner)) != 1 {
		t.Fatal("recovery created another Agent", i)
	}
	if _, err = manager.SendGeneration(manager.owner, r.ID, "disabled", "run", 0); err == nil {
		t.Fatal("recovery silently reenabled the disabled dependency")
	}
}

func standardImageWorkflow(t *testing.T, m *AgentManager) string {
	t.Helper()
	p, err := modules.Load(context.Background(), filepath.Join(mustProjectRoot(t), "SDK/examples/workbox-images"))
	if err != nil {
		t.Fatal(err)
	}
	p.Manifest.ID = "example.bound-images"
	p.Manifest.Dependencies = append(p.Manifest.Dependencies, modules.Dependency{ID: "example.workflow-manager", Version: "^1.0.0"})
	p.Manifest.Permissions = append(p.Manifest.Permissions, modules.Permission{Capability: "package.invoke", Scope: "example.workflow-manager", Reason: "Bound specialist"})
	var d workbox.Definition
	if err = json.Unmarshal(p.Files["workflow.json"], &d); err != nil {
		t.Fatal(err)
	}
	d.AgentTemplate = &workbox.AgentTemplate{Package: "example.workflow-manager", Retention: "retained"}
	p.Files["workflow.json"] = rawJSON(d)
	dir := t.TempDir()
	for name, raw := range p.Files {
		if name == "manifest.json" {
			continue
		}
		sum := sha256.Sum256(raw)
		p.Manifest.Files[name] = modules.File{SHA256: hex.EncodeToString(sum[:]), Size: int64(len(raw))}
		if err := os.WriteFile(filepath.Join(dir, name), raw, 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(dir, "manifest.json"), rawJSON(p.Manifest), 0600); err != nil {
		t.Fatal(err)
	}
	r := packageMutation(t, m.toolPackages(), "install", dir, "", p.Manifest.Permissions)
	packageMutation(t, m.toolPackages(), "enable", "", p.Manifest.ID, p.Manifest.Permissions)
	return "mod:" + p.Manifest.ID + "@" + r.Digest
}

func TestAgentPackageWorkboxCancellationOutlivesSpecialistTurn(t *testing.T) {
	for _, route := range []string{"agent", "workflow", "primary"} {
		t.Run(route, func(t *testing.T) {
			entered, stopped, release := make(chan struct{}), make(chan struct{}), make(chan struct{})
			var images, calls atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, req *http.Request) {
				_, _ = io.Copy(io.Discard, req.Body)
				if images.Add(1) != 1 {
					t.Error("image operation replayed")
				}
				close(entered)
				select {
				case <-req.Context().Done():
					close(stopped)
				case <-release:
				}
			}))
			defer server.Close()
			defer close(release)
			var current workbox.Instance
			m, w, dir, _ := standardWorkflowFixture(t, func(rw http.ResponseWriter, req *http.Request) {
				_, _ = io.Copy(io.Discard, req.Body)
				n := calls.Add(1)
				if n > 2 {
					fixtureAnswer(rw, "submitted", "Workflow continues in the background.", nil)
					return
				}
				args := map[string]any{"action": "open", "name": "software_api"}
				if n == 2 {
					args = map[string]any{"action": "call", "name": "software_api", "arguments": map[string]any{"action": "workflow", "operation": "run", "arguments": map[string]any{"expected_revision": current.Revision, "request_id": "start-images"}}}
				}
				id := fmt.Sprint("tool-", n)
				fixtureAnswer(rw, id, "", []any{map[string]any{"type": "function_call", "id": id, "call_id": id, "name": "toolbox", "arguments": string(rawJSON(args))}})
			})
			s, err := Load(m.config)
			if err != nil {
				t.Fatal(err)
			}
			s.ProviderConnections = append(s.ProviderConnections, ProviderConnection{ID: "images", Provider: "custom", BaseURL: server.URL, APIKey: "fake-images", RequestTimeout: 20})
			s.APIProfiles = append(s.APIProfiles, APIProfile{ID: "image-model", Name: "image fixture", ConnectionID: "images", Model: "img-model", Adapter: "openai", Protocol: ProtocolChat, BaseURL: server.URL})
			if err := s.Save(); err != nil {
				t.Fatal(err)
			}
			data, err := os.ReadFile(m.config)
			if err != nil {
				t.Fatal(err)
			}
			var settings map[string]any
			if err = json.Unmarshal(data, &settings); err != nil {
				t.Fatal(err)
			}
			settings["image_profiles"] = []string{"image-model"}
			if err = os.WriteFile(m.config, rawJSON(settings), 0600); err != nil {
				t.Fatal(err)
			}
			identity := standardImageWorkflow(t, m)
			current = nativeWorkbox(t, w, identity, "call", map[string]any{"command": map[string]any{"action": "create", "request_id": "bound-image", "workdir": dir, "input": map[string]any{"prompt": "one request", "edit_prompt": "no replay", "profile_id": "", "size": "1536x1024"}}})["instance"].(workbox.Instance)
			create := workflowCommandArgs("create_agent", current)
			create["model_id"] = "local-model"
			current = nativeWorkbox(t, w, identity, "call", map[string]any{"command": create})["instance"].(workbox.Instance)
			manager := m.packageHost.Load()
			if _, err := manager.SendGeneration(manager.owner, current.AgentID, "start", "Run the accepted image workflow.", 0); err != nil {
				t.Fatal(err)
			}
			r, err := manager.Wait(context.Background(), manager.owner, current.AgentID, 10000)
			if err != nil || r.State != "completed" || r.ToolTurns != 2 || calls.Load() != 3 {
				t.Fatal("specialist did not finish before background work", r, err)
			}
			select {
			case <-entered:
			case <-time.After(5 * time.Second):
				t.Fatal("workflow never started the image request")
			}
			switch route {
			case "agent":
				err = manager.CancelGeneration(manager.owner, r.ID, r.Generation)
			case "workflow":
				svc := m.workboxHost.Load()
				current, err = svc.workflowCall(context.Background(), svc.owner, identity, rawJSON(map[string]any{"action": "status", "id": current.ID}))
				if err == nil {
					_, err = svc.workflowCall(context.Background(), svc.owner, identity, rawJSON(workflowCommandArgs("cancel", current)))
				}
			case "primary":
				parent := strings.Repeat("4", 32)
				m.jobs[parent] = &agentJob{record: AgentRecord{ID: parent, Parent: m.owner, State: "completed", Spec: AgentSpec{WorkspaceRole: WorkspaceMatrix}}}
				err = m.Cancel(m.owner, parent)
			}
			if err != nil {
				t.Fatal("cancellation failed", err)
			}
			select {
			case <-stopped:
			case <-time.After(5 * time.Second):
				t.Fatal("cancellation did not reach the actual provider after the specialist finished")
			}
			if images.Load() != 1 {
				t.Fatal("provider operation replayed", images.Load())
			}
		})
	}
}

func TestAgentPackageWorkboxOwnerCancellationStopsActiveSpecialist(t *testing.T) {
	for _, route := range []string{"workflow", "primary"} {
		t.Run(route, func(t *testing.T) {
			entered, release := make(chan struct{}), make(chan struct{})
			defer close(release)
			m, w, dir, identity := standardWorkflowFixture(t, func(rw http.ResponseWriter, r *http.Request) {
				_, _ = io.Copy(io.Discard, r.Body)
				close(entered)
				select {
				case <-r.Context().Done():
				case <-release:
				}
			})
			i := createStandardWorkflow(t, w, identity, dir, "stop-specialist")
			create := workflowCommandArgs("create_agent", i)
			create["model_id"] = "local-model"
			i = nativeWorkbox(t, w, identity, "call", map[string]any{"command": create})["instance"].(workbox.Instance)
			manager := m.packageHost.Load()
			if _, err := manager.SendGeneration(manager.owner, i.AgentID, "active", "Inspect until stopped.", 0); err != nil {
				t.Fatal(err)
			}
			select {
			case <-entered:
			case <-time.After(5 * time.Second):
				t.Fatal("specialist never started")
			}
			if route == "workflow" {
				cancel := workflowCommandArgs("cancel", i)
				for range 2 {
					nativeWorkbox(t, w, identity, "call", map[string]any{"command": cancel})
				}
			} else {
				parent := strings.Repeat("4", 32)
				m.jobs[parent] = &agentJob{record: AgentRecord{ID: parent, Parent: m.owner, State: "completed", Spec: AgentSpec{WorkspaceRole: WorkspaceMatrix}}}
				if err := m.Cancel(m.owner, parent); err != nil {
					t.Fatal(err)
				}
			}
			r, err := manager.Wait(context.Background(), manager.owner, i.AgentID, 10000)
			if err != nil || r.State != "cancelled" || r.Generation != 1 {
				t.Fatal("owner cancellation left specialist running", r, err)
			}
		})
	}
}

// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestMigrationRestoresSessionOwnersWithoutReplaying
// Impact: python -B scripts/code-atlas.py show Core/userdata_sessions_test.go
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

	"github.com/aieyra/aieyra-os/CORE/userdata"
	"github.com/aieyra/aieyra-os/tool/workbox"
)

// Exercise the actual owners, package registry and model history after removing
// the former root. Copying bytes alone cannot prove a session can continue.
func TestMigrationRestoresSessionOwnersWithoutReplaying(t *testing.T) {
	var mu sync.Mutex
	var wires []string
	m, source := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
		var body any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		wire := string(rawJSON(body))
		mu.Lock()
		wires = append(wires, wire)
		mu.Unlock()
		if strings.Contains(wire, "CONTACT_CONTINUE") && !strings.Contains(wire, "function_call_output") {
			fixtureAnswer(w, "migrated-write", "", []any{map[string]any{"type": "function_call", "id": "fc_migration", "call_id": "migration-write", "name": "apply_patch", "arguments": `{"patch":"*** Begin Patch\n*** Add File: after-migration.txt\n+retained contact workspace\n*** End Patch"}`}})
			return
		}
		fixtureAnswer(w, "migrated", "synthetic session response", nil)
	})
	t.Setenv("AIEYRA_ROOT", mustProjectRoot(t))
	work := t.TempDir()
	w := modeWorkspace(t, m.config, work, HostOS)
	session := contextTestAction(t, w, "new", map[string]any{"title": "migration main"})["session_id"]
	contextTestTurn(t, w, "MAIN_ORIGINAL")
	h := w.host
	t.Cleanup(h.Close)
	contactCall := func(host *WorkspaceHost, args map[string]any) any {
		t.Helper()
		v, err := host.conversationCall(context.Background(), rawJSON(args))
		if err != nil {
			t.Fatal(err)
		}
		return v
	}
	contact := contactCall(h, map[string]any{"action": "contact_create", "request_id": "migration-contact", "model_id": "local-model", "name": "迁移联系人", "prompt_text": "CONTACT_PERSONA", "tools": []string{"apply_patch"}}).(map[string]any)
	contactID := contact["id"].(string)
	cm, err := h.conversationManager()
	if err != nil {
		t.Fatal(err)
	}
	finish := func(manager *AgentManager, id string) AgentRecord {
		t.Helper()
		r, err := manager.Wait(context.Background(), manager.owner, id, 10000)
		if err != nil || r.State != "completed" {
			t.Fatalf("session %s: %s %s %v", id, r.State, r.Error, err)
		}
		return r
	}
	send := func(manager *AgentManager, r AgentRecord, request, message string) AgentRecord {
		t.Helper()
		if _, err := manager.SendGeneration(manager.owner, r.ID, request, message, r.Generation); err != nil {
			t.Fatal(err)
		}
		return finish(manager, r.ID)
	}
	contactCall(h, map[string]any{"action": "send", "id": contactID, "request_id": "contact-first", "message": "CONTACT_ORIGINAL", "generation": 0})
	contactRecord := finish(cm, contactID)
	if err := os.WriteFile(filepath.Join(contactRecord.Spec.Workdir, "kept.txt"), []byte("original deliverable"), 0600); err != nil {
		t.Fatal(err)
	}
	task, err := m.Create(context.Background(), m.owner, AgentSpec{RequestID: "migration-task", ModelID: "local-model", Task: "TASK_ORIGINAL", Workdir: contactRecord.Spec.Workdir, Tools: []string{"apply_patch"}, Contract: &AgentContract{Acceptance: []string{"original exists"}, Deliverables: []string{"kept.txt"}}})
	if err != nil {
		t.Fatal(err)
	}
	task = finish(m, task.ID)
	deliveryHash := task.Delivery.Artifacts[0].SHA256
	identity := installWorkflowSample(t, w.manager, "agent-reviewer")
	pm, err := w.manager.ensurePackageAgentHost(true)
	if err != nil {
		t.Fatal(err)
	}
	packaged := newPackageAgent(t, pm, identity, "migration-agent", work)
	packaged = send(pm, packaged, "agent-first", "PACKAGE_ORIGINAL")
	installWorkflowSample(t, w.manager, "tool-statistics")
	installWorkflowSample(t, w.manager, "toolbox-report")
	workflowIdentity := retainedWorkbox(t, w.manager)
	instance := nativeWorkbox(t, w, workflowIdentity, "call", map[string]any{"command": map[string]any{"action": "create", "request_id": "migration-workflow", "workdir": contactRecord.Spec.Workdir, "input": map[string]any{"values": []int{2, 3}, "workdir": contactRecord.Spec.Workdir, "file": "migration.json"}}})["instance"].(workbox.Instance)
	waitWorkflow := func(host *Workspace, want string) workbox.Instance {
		t.Helper()
		for deadline := time.Now().Add(10 * time.Second); time.Now().Before(deadline); time.Sleep(20 * time.Millisecond) {
			i := nativeWorkbox(t, host, workflowIdentity, "call", map[string]any{"owner": instance.Owner, "command": map[string]any{"action": "status", "id": instance.ID}})["instance"].(workbox.Instance)
			if i.State == want {
				return i
			}
			if i.State != "running" {
				t.Fatalf("workflow expected %s: %+v", want, i)
			}
		}
		t.Fatal("workflow did not settle")
		return workbox.Instance{}
	}
	nativeWorkbox(t, w, workflowIdentity, "call", map[string]any{"owner": instance.Owner, "command": workflowCommandArgs("run", instance)})
	instance = waitWorkflow(w, "awaiting_review")
	command := workflowCommandArgs("create_agent", instance)
	command["model_id"] = "local-model"
	instance = nativeWorkbox(t, w, workflowIdentity, "call", map[string]any{"owner": instance.Owner, "command": command})["instance"].(workbox.Instance)
	specialist := finish(w.manager, instance.AgentID)
	w.Close()
	h.Close()
	m.Close()
	mu.Lock()
	count := len(wires)
	mu.Unlock()
	p, err := userdata.Migrate(context.Background(), m.config, filepath.Join(t.TempDir(), "UserData"))
	if err != nil {
		t.Fatal(err)
	}
	if err = os.Rename(source, source+"-retained"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(source + "-retained") })
	reopened := modeWorkspace(t, p.Config, work, HostOS)
	view := contextTestView(t, reopened)
	if view["session_id"] != session || !strings.Contains(string(rawJSON(view)), "MAIN_ORIGINAL") {
		t.Fatalf("main session lost: %s", rawJSON(view))
	}
	nextHost := reopened.host
	defer nextHost.Close()
	contacts := contactCall(nextHost, map[string]any{"action": "contacts"}).([]map[string]any)
	contacts = ordinaryContactViews(contacts)
	if len(contacts) != 1 || contacts[0]["id"] != contactID {
		t.Fatal("contact identity lost", contacts)
	}
	if contacts[0]["workdir"] != p.Relocate(contactRecord.Spec.Workdir) {
		t.Fatal("contact projects the obsolete work directory")
	}
	nextContacts, err := nextHost.conversationManager()
	if err != nil {
		t.Fatal(err)
	}
	nextTasks, err := NewAgentManager(p.Config, testMatrixOwner, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer nextTasks.Close()
	nextPackages, err := reopened.manager.ensurePackageAgentHost(false)
	if err != nil || nextPackages == nil {
		t.Fatal("package owner lost", err)
	}
	rows := nativeWorkbox(t, reopened, workflowIdentity, "list", nil)["instances"].([]workboxSummary)
	if len(rows) != 1 || rows[0].ID != instance.ID || rows[0].Owner != instance.Owner || rows[0].AgentID != specialist.ID {
		t.Fatal("workflow identity lost", rows)
	}
	mu.Lock()
	replayed := len(wires) != count
	mu.Unlock()
	if replayed {
		t.Fatal("opening migrated sessions replayed a request")
	}
	// Continue through the same queued send path as the UI. Direct dispatch can
	// race the reopened runtime and bypass its finishing/owner handoff.
	ordinaryChatTurn(t, reopened, "MAIN_CONTINUE")
	contactRecord = send(nextContacts, contactRecord, "contact-next", "CONTACT_CONTINUE")
	if got, want := nextContacts.jobs[contactID].shell.Workdir(), p.Relocate(contactRecord.Spec.Workdir); got != want {
		t.Errorf("contact execution still uses the former directory: %s; want %s", got, want)
	}
	if data, err := os.ReadFile(filepath.Join(p.Relocate(contactRecord.Spec.Workdir), "after-migration.txt")); err != nil || !strings.Contains(string(data), "retained contact workspace") {
		t.Fatalf("continued contact could not write in the migrated directory: %v", err)
	}
	contactCall(nextHost, map[string]any{"action": "session_create", "contact_id": contactID, "request_id": "after-migration-session"})
	shell := nextContacts.jobs[contactID].shell
	request := shellTestCommand(t, "output")
	request.Workdir = contactRecord.Spec.Workdir
	result := shellDone(t, shell, shell.Execute(context.Background(), ToolCall{ID: "migration-shell", Type: "function", Function: FunctionCall{Name: "exec_command", Arguments: string(rawJSON(request))}}))
	if result.ExitCode == nil || *result.ExitCode != 7 || result.Workdir != p.Relocate(request.Workdir) {
		t.Fatalf("explicit migrated shell directory: %+v", result)
	}
	task = send(nextTasks, task, "task-next", "TASK_CONTINUE")
	if task.Delivery == nil || deliveryHash == "" || task.Delivery.Artifacts[0].SHA256 != deliveryHash {
		t.Fatal("migrated task delivery lost its original artifact")
	}
	packaged = send(nextPackages, packaged, "agent-next", "PACKAGE_CONTINUE")
	specialist = send(reopened.manager, specialist, "workflow-next", "WORKFLOW_CONTINUE")
	instance = nativeWorkbox(t, reopened, workflowIdentity, "call", map[string]any{"owner": instance.Owner, "command": map[string]any{"action": "status", "id": instance.ID}})["instance"].(workbox.Instance)
	approve := workflowCommandArgs("approve", instance)
	approve["step"] = "review"
	instance = nativeWorkbox(t, reopened, workflowIdentity, "call", map[string]any{"owner": instance.Owner, "command": approve})["instance"].(workbox.Instance)
	nativeWorkbox(t, reopened, workflowIdentity, "call", map[string]any{"owner": instance.Owner, "command": workflowCommandArgs("run", instance)})
	instance = waitWorkflow(reopened, "completed")
	if instance.Steps[0].Attempts != 1 || instance.Steps[2].Attempts != 1 {
		t.Fatal("workflow replayed a completed step")
	}
	if data, err := os.ReadFile(filepath.Join(p.Relocate(contactRecord.Spec.Workdir), "migration.json")); err != nil || !json.Valid(data) {
		t.Fatalf("migrated workflow report: %v", err)
	}
	for _, r := range []AgentRecord{contactRecord, task, packaged, specialist} {
		if r.Generation != 2 {
			t.Fatalf("generation lost: %+v", r)
		}
	}
	mu.Lock()
	after := append([]string(nil), wires[count:]...)
	mu.Unlock()
	markers := []string{"MAIN_ORIGINAL", "CONTACT_ORIGINAL", "TASK_ORIGINAL", "PACKAGE_ORIGINAL"}
	for i, marker := range markers {
		found := false
		for _, wire := range after {
			if !strings.Contains(wire, strings.Replace(marker, "ORIGINAL", "CONTINUE", 1)) {
				continue
			}
			found = true
			if !strings.Contains(wire, marker) {
				t.Errorf("%s absent from continuation", marker)
			}
			for j, other := range markers {
				if j != i && strings.Contains(wire, other) {
					t.Errorf("%s leaked into %s", other, marker)
				}
			}
		}
		if !found {
			t.Errorf("missing continuation for %s", marker)
		}
	}
	if !strings.Contains(after[1], "CONTACT_PERSONA") {
		t.Error("contact override lost")
	}
	if _, err = os.Stat(source); !os.IsNotExist(err) {
		t.Fatal("continuation recreated the former root", err)
	}
}

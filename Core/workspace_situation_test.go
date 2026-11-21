// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestMotherOverviewAndPackageAdministration
// Impact: python -B scripts/code-atlas.py show Core/workspace_situation_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestMotherOverviewAndPackageAdministration(t *testing.T) {
	entered, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	var requests atomic.Int32
	m, dir := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		if strings.Contains(string(rawJSON(body)), "MANAGED_TEMPLATE") {
			fixtureAnswer(w, "child", "MANAGED_RESULT", nil)
			return
		}
		once.Do(func() { close(entered) })
		select {
		case <-release:
		case <-r.Context().Done():
			return
		}
		fixtureAnswer(w, "home", "done", nil)
	})
	h, home := openCoreLinkHome(t, m.config, dir)
	defer h.Close()
	defer close(release)
	identity := installWorkflowSample(t, home.manager, "agent-reviewer")
	service, err := home.manager.ensurePackageAgentHost(true)
	if err != nil {
		t.Fatal(err)
	}
	r := newPackageAgent(t, service, identity, "independent", dir)
	private := "PRIVATE_TEMPLATE_MARKER"
	r = changePackageAgent(t, service, r, agentPackageCommand{Action: "configure", Prompt: &private})
	if _, err = home.Send("overview-work", "Observe agents and manage the independent instance."); err != nil {
		t.Fatal(err)
	}
	select {
	case <-entered:
	case <-time.After(10 * time.Second):
		t.Fatal("mother did not start")
	}
	home.mu.Lock()
	actor := home.state.Roles[WorkspaceMatrix]
	archivePath := home.contextArchivePath(home.contextSessionLocked().Archive)
	home.mu.Unlock()
	ctx := context.WithValue(WithToolPermissions(context.Background(), []string{"agents", "apply_patch", "memory"}), conversationLinkCallerKey{}, conversationLinkCaller{ID: actor, Generation: 1})
	call := func(ctx context.Context, p agentPackageCommand) (any, error) {
		return home.manager.Call(ctx, actor, rawJSON(map[string]any{"action": "package", "command": p}))
	}
	if _, err = call(ctx, agentPackageCommand{Action: "status", ID: r.ID}); err != nil {
		t.Fatal("primary cannot discover independent instance", err)
	}
	seen := map[string]bool{}
	cursor := 0
	version := ""
	for {
		out, e := home.manager.Call(ctx, actor, rawJSON(map[string]any{"action": "overview", "cursor": cursor, "limit": 4, "expected_version": version}))
		if e != nil {
			t.Fatal(e)
		}
		page := out.(map[string]any)
		version = page["version"].(string)
		if strings.Contains(string(rawJSON(page)), private) {
			t.Fatal("overview imported private prompts")
		}
		for _, row := range page["entries"].([]map[string]any) {
			key := row["type"].(string) + ":" + row["id"].(string)
			if seen[key] {
				t.Fatal("duplicate page entry", key)
			}
			seen[key] = true
		}
		if page["has_more"] != true {
			break
		}
		cursor = page["next_cursor"].(int)
	}
	packageID, _, found := strings.Cut(strings.TrimPrefix(identity, "mod:"), "@")
	if !found || !seen["instance:"+r.ID] || !seen["contact:"+programContactID("browser")] || !seen["package:"+packageID] {
		t.Fatal("incomplete overview", seen)
	}
	if requests.Load() != 1 {
		t.Fatal("discovery ran an Agent", requests.Load())
	}
	prompt := "MANAGED_TEMPLATE"
	tools := []string{"apply_patch"}
	change := agentPackageCommand{Action: "configure", ID: r.ID, RequestID: "manage-independent", Reason: "调整独立专员职责", ExpectedRevision: &r.Instance.Revision, Prompt: &prompt, Tools: &tools, Title: "Managed specialist"}
	if _, err = call(context.WithValue(ctx, conversationLinkCallerKey{}, conversationLinkCaller{ID: actor, Generation: 2}), change); err == nil {
		t.Fatal("stale mother acquired management")
	}
	out, err := call(ctx, change)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(rawJSON(out)), prompt) {
		t.Fatal("mutation receipt imported private prompt")
	}
	updated, err := service.Status(service.owner, r.ID)
	if err != nil || updated.Spec.Prompt != prompt || updated.Spec.Title != "Managed specialist" {
		t.Fatal(updated.Spec.Title, err)
	}
	if _, err = call(ctx, change); err != nil {
		t.Fatal("idempotent management", err)
	}
	if _, err = home.manager.Call(ctx, actor, rawJSON(map[string]any{"action": "overview", "cursor": 4, "expected_version": version})); err == nil {
		t.Fatal("changed overview accepted stale page")
	}
	send := agentPackageCommand{Action: "send", ID: r.ID, RequestID: "managed-run", Reason: "核验所选专员", Message: "Run the assigned check.", Generation: 0}
	if _, err = call(ctx, send); err != nil {
		t.Fatal(err)
	}
	finished, err := service.Wait(context.Background(), service.owner, r.ID, 10000)
	if err != nil || finished.State != "completed" || finished.Result != "MANAGED_RESULT" {
		t.Fatal(finished.State, finished.Error, err)
	}
	disabled := false
	finished = changePackageAgent(t, service, finished, agentPackageCommand{Action: "configure", Enabled: &disabled})
	enabled := true
	if _, err = call(ctx, agentPackageCommand{Action: "configure", ID: r.ID, RequestID: "reenable", Reason: "test", ExpectedRevision: &finished.Instance.Revision, Enabled: &enabled}); err == nil {
		t.Fatal("reopened a user-disabled instance")
	}
	data, err := os.ReadFile(archivePath)
	if err != nil || !strings.Contains(string(data), `"action":"package.configure"`) {
		t.Fatal("missing persisted audit", err)
	}
	if _, err = (&SessionArchive{Path: archivePath}).read(); err != nil {
		t.Fatal("audit broke recovery", err)
	}
}

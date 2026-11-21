// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestCoreLinkPackageDelegatesWithoutSharingPrivateContextOrPermissions
// Impact: python -B scripts/code-atlas.py show Core/conversation_link_package_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestCoreLinkPackageDelegatesWithoutSharingPrivateContextOrPermissions(t *testing.T) {
	entered, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	defer once.Do(func() { close(release) })
	var rootCalls, childCalls atomic.Int32
	_, workspace, m, dir, identity := packageAgentFixture(t, func(w http.ResponseWriter, req *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(req.Body).Decode(&body)
		data := string(rawJSON(body))
		if strings.Contains(data, "INVITED-CONTACT-PERSONA") {
			call := childCalls.Add(1)
			if strings.Contains(data, "PARENT-PRIVATE") || strings.Contains(data, "shared_baseline") || strings.Contains(data, "package_memory") {
				t.Error("package private context reached delegated contact")
			}
			if call == 1 {
				fixtureAnswer(w, "directory", "", []any{map[string]any{"type": "function_call", "id": "fc_directory", "call_id": "directory", "name": "core_link", "arguments": `{"action":"link_directory"}`}})
			} else {
				fixtureAnswer(w, "child", "CHILD-VERIFIED-RESULT", nil)
			}
			return
		}
		if !strings.Contains(data, `"name":"core_link"`) {
			t.Error("package has no intrinsic core Link")
		}
		if rootCalls.Add(1) == 1 {
			close(entered)
			select {
			case <-release:
			case <-req.Context().Done():
				return
			}
		} else if !strings.Contains(data, "CHILD-VERIFIED-RESULT") || !strings.Contains(data, "PARENT-PRIVATE") {
			t.Error("parent lost own context or collaboration result")
		}
		fixtureAnswer(w, "root", "review complete", nil)
	})
	defer workspace.host.Close()
	contact, err := workspace.host.conversationCall(context.Background(), rawJSON(map[string]any{"action": "contact_create", "request_id": "link-contact", "name": "researcher", "prompt_text": "INVITED-CONTACT-PERSONA", "model_id": "local-model", "workdir": dir, "tools": []string{}}))
	if err != nil {
		t.Fatal(err)
	}
	contactID := contact.(map[string]any)["id"].(string)
	root := newPackageAgent(t, m, identity, "link-root", dir)
	if _, err = m.SendGeneration(m.owner, root.ID, "start", "PARENT-PRIVATE", 0); err != nil {
		t.Fatal(err)
	}
	select {
	case <-entered:
	case <-time.After(10 * time.Second):
		t.Fatal("package did not start")
	}
	ctx := WithToolPermissions(context.Background(), nil)
	ctx = WithAgentManager(ctx, m, root.ID, nil)
	ctx = context.WithValue(ctx, conversationLinkCallerKey{}, conversationLinkCaller{ID: root.ID, Generation: 1})
	if !toolAllowed(ctx, "core_link") || toolAllowed(ctx, "agents") {
		t.Fatal("Link widened package management grant")
	}
	invoke := func(args map[string]any) ToolboxResult {
		return executeAgents(ctx, ToolCall{Function: FunctionCall{Name: "core_link", Arguments: string(rawJSON(args))}})
	}
	if out := invoke(map[string]any{"action": "create", "task": "escape"}); out.OK {
		t.Fatal("intrinsic Link allowed general task creation")
	}
	out := invoke(map[string]any{"action": "link_invite", "contact_id": contactID, "request_id": "invite-once"})
	if !out.OK {
		t.Fatal(out.Error)
	}
	var member map[string]any
	if err = json.Unmarshal(out.Data, &member); err != nil {
		t.Fatal(err)
	}
	id := member["id"].(string)
	if id == contactID {
		t.Fatal("invitation reused the private chat")
	}
	child, err := m.Status(m.owner, id)
	if err != nil || child.Instance != nil || child.Spec.AgentPackage != "" || child.Spec.WorkspaceRole != "" {
		t.Fatal("delegated contact inherited package identity", err)
	}
	out = invoke(map[string]any{"action": "link_send", "id": id, "generation": 0, "request_id": "work-once", "message": "Investigate the assigned fact only"})
	if !out.OK {
		t.Fatal(out.Error)
	}
	child, err = m.Wait(context.Background(), m.owner, id, 10000)
	if err != nil || child.State != "completed" {
		t.Fatal(child.State, child.Error, err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for {
		r, _ := m.Status(m.owner, root.ID)
		if len(r.PendingMessages) > 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("result was not queued to active package")
		}
		time.Sleep(10 * time.Millisecond)
	}
	out = invoke(map[string]any{"action": "link_release", "id": id, "generation": child.Generation})
	if !out.OK {
		t.Fatal(out.Error)
	}
	if _, err = m.SendGeneration(m.owner, id, "after-release", "must not restart", child.Generation); err == nil {
		t.Fatal("archived member restarted")
	}
	out = invoke(map[string]any{"action": "link_result", "id": id, "generation": child.Generation})
	if !out.OK || !strings.Contains(string(out.Data), "CHILD-VERIFIED-RESULT") {
		t.Fatal("archiving lost result", out.Error)
	}
	out = invoke(map[string]any{"action": "link_invite", "contact_id": contactID, "request_id": "invite-once"})
	if !out.OK || !strings.Contains(string(out.Data), `"released":true`) {
		t.Fatal("creation receipt lost archived state", out.Error)
	}
	once.Do(func() { close(release) })
	root, err = m.Wait(context.Background(), m.owner, root.ID, 10000)
	if err != nil || root.State != "completed" || rootCalls.Load() != 2 || childCalls.Load() != 2 {
		t.Fatal(root.State, root.Error, rootCalls.Load(), childCalls.Load(), err)
	}
	canonical, _ := workspace.host.conversationManager()
	private, err := canonical.Status(canonical.owner, contactID)
	if err != nil || private.Generation != 0 {
		t.Fatal("contact private chat was used", err)
	}
	if err = validateConversationLinkRecord(root); err != nil {
		t.Fatal("package result cannot reopen", err)
	}
}

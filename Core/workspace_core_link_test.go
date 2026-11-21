// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: openCoreLinkHome; waitCoreLink; TestCoreLinkHomeDelegatesThroughRealInbox
// Impact: python -B scripts/code-atlas.py show Core/workspace_core_link_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func openCoreLinkHome(t *testing.T, config, dir string) (*WorkspaceHost, *Workspace) {
	t.Helper()
	h := NewWorkspaceHost(config, "", "")
	if err := h.SetMode(HostOS); err != nil {
		t.Fatal(err)
	}
	if err := h.SetModuleOnly(); err != nil {
		t.Fatal(err)
	}
	opened, err := h.Open("", dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(h.Close)
	return h, h.workspaces[opened["session_id"].(string)]
}

func waitCoreLink(t *testing.T, message string, condition func() bool) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for !condition() {
		if time.Now().After(deadline) {
			t.Fatal(message)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestCoreLinkHomeDelegatesThroughRealInbox(t *testing.T) {
	for _, busy := range []bool{true, false} {
		t.Run(map[bool]string{true: "busy", false: "idle"}[busy], func(t *testing.T) {
			entered, release := make(chan struct{}), make(chan struct{})
			childEntered, childRelease := make(chan struct{}), make(chan struct{})
			var once, childOnce sync.Once
			var rootCalls, childCalls atomic.Int32
			var firstTools, firstPrefix string
			m, dir := matrixTestManager(t, func(rw http.ResponseWriter, req *http.Request) {
				var body map[string]any
				_ = json.NewDecoder(req.Body).Decode(&body)
				data := string(rawJSON(body))
				if strings.Contains(data, "INVITED-HOME-RESEARCHER") {
					childCalls.Add(1)
					if strings.Contains(data, "HOME-PRIVATE-INPUT") {
						t.Error("home history leaked to delegate")
					}
					close(childEntered)
					select {
					case <-childRelease:
					case <-req.Context().Done():
						return
					}
					fixtureAnswer(rw, "child", "HOME-MEMBER-RESULT", nil)
					return
				}
				call := rootCalls.Add(1)
				prefix := []any{}
				for _, item := range body["input"].([]any) {
					row, _ := item.(map[string]any)
					if row["role"] != "system" && row["role"] != "developer" {
						break
					}
					prefix = append(prefix, item)
				}
				if call == 1 {
					firstTools, firstPrefix = string(rawJSON(body["tools"])), string(rawJSON(prefix))
					if !strings.Contains(data, `"name":"core_link"`) {
						t.Error("home omitted intrinsic Link")
					}
					close(entered)
					select {
					case <-release:
					case <-req.Context().Done():
						return
					}
				} else {
					if !strings.Contains(data, "HOME-MEMBER-RESULT") || !strings.Contains(data, "HOME-PRIVATE-INPUT") {
						t.Error("home lost own context or member result")
					}
					if call == 2 && (firstTools != string(rawJSON(body["tools"])) || firstPrefix != string(rawJSON(prefix))) {
						t.Error("collaboration rewrote the stable prefix or tool schema")
					}
				}
				fixtureAnswer(rw, "home", "reviewed", nil)
			})
			h, home := openCoreLinkHome(t, m.config, dir)
			defer h.Close()
			defer once.Do(func() { close(release) })
			defer childOnce.Do(func() { close(childRelease) })
			contact, err := h.conversationCall(context.Background(), rawJSON(map[string]any{"action": "contact_create", "request_id": "researcher", "name": "researcher", "prompt_text": "INVITED-HOME-RESEARCHER", "model_id": "local-model", "tools": []string{}, "workdir": dir}))
			if err != nil {
				t.Fatal(err)
			}
			if _, err = home.Send("home-start", "HOME-PRIVATE-INPUT"); err != nil {
				t.Fatal(err)
			}
			select {
			case <-entered:
			case <-time.After(10 * time.Second):
				t.Fatal("home did not start")
			}
			home.mu.Lock()
			actor, scope := home.state.Roles[WorkspaceMatrix], home.coreLinkScopeLocked()
			home.mu.Unlock()
			if actor == scope || scope == home.state.ID {
				t.Fatal("mailbox did not use durable session identity")
			}
			ctx := WithAgentManager(context.Background(), home.manager, actor, nil)
			ctx = context.WithValue(ctx, conversationLinkCallerKey{}, conversationLinkCaller{ID: actor, Generation: 1})
			invoke := func(args map[string]any) ToolboxResult {
				return executeAgents(ctx, ToolCall{Function: FunctionCall{Name: "core_link", Arguments: string(rawJSON(args))}})
			}
			out := invoke(map[string]any{"action": "link_invite", "request_id": "delegate", "contact_id": contact.(map[string]any)["id"]})
			if !out.OK {
				t.Fatal(out.Error)
			}
			var member map[string]any
			_ = json.Unmarshal(out.Data, &member)
			id := member["id"].(string)
			out = invoke(map[string]any{"action": "link_send", "id": id, "generation": 0, "request_id": "work", "message": "investigate only this fact"})
			if !out.OK {
				t.Fatal(out.Error)
			}
			select {
			case <-childEntered:
			case <-time.After(10 * time.Second):
				t.Fatal("child did not start")
			}
			if !busy {
				once.Do(func() { close(release) })
				if _, err = home.manager.Wait(context.Background(), home.state.ID, actor, 10000); err != nil {
					t.Fatal(err)
				}
			}
			shown, displayErr := home.Snapshot(0)
			if displayErr != nil {
				t.Fatal(displayErr)
			}
			projection, ok := shown.(map[string]any)["link"].(map[string]any)
			if !ok || projection["scope"] != scope {
				t.Fatal("home lost its persistent collaboration projection", projection)
			}
			found := false
			for _, row := range projection["members"].([]map[string]any) {
				if row["id"] == id {
					found = row["activity"] != nil && row["state"] == "running"
				}
			}
			if !found || childCalls.Load() != 1 || rootCalls.Load() != 1 {
				t.Fatal("snapshot did not preserve independent execution", found, rootCalls.Load(), childCalls.Load())
			}
			childOnce.Do(func() { close(childRelease) })
			waitCoreLink(t, "result did not enter home queue", func() bool {
				home.mu.Lock()
				defer home.mu.Unlock()
				for _, msg := range home.state.Messages {
					if msg.CoreLink != nil {
						return msg.From == id && msg.Origin == "core_link" && msg.CoreLink.Scope == scope
					}
				}
				return false
			})
			once.Do(func() { close(release) })
			waitCoreLink(t, "home did not consume result", func() bool {
				r, _ := home.manager.Status(home.state.ID, actor)
				return rootCalls.Load() == 2 && r.State == "completed" && len(r.TurnOrigins) == 1
			})
			cm, _ := h.conversationManager()
			if _, err = cm.Status(cm.owner, scope); err == nil {
				t.Fatal("mailbox became a fake conversation executor")
			}
			data, err := os.ReadFile(filepath.Join(home.contextDirectory(), "sessions.json"))
			if err != nil || !strings.Contains(string(data), `"core_link"`) {
				t.Fatal("internal provenance was not committed with the inbox", err)
			}
			if childCalls.Load() != 1 {
				t.Fatal("delegated work replayed")
			}
			postReceipt := func(kind, request string) {
				t.Helper()
				conversationGroupsMu.Lock()
				g, e := cm.readGroup(linkLogID(scope))
				if e == nil {
					_, e = cm.appendGroupMessage(g, groupMessage{From: id, To: scope, Kind: kind, Text: "LATE-HOME-RESULT", Request: request, SenderGeneration: 1, TargetGeneration: g.WorkspaceLink.Generation, ReplyGeneration: g.WorkspaceLink.Generation})
				}
				conversationGroupsMu.Unlock()
				if e != nil {
					t.Fatal(e)
				}
			}
			if busy {
				// An already captured scheduler batch must re-read the durable
				// stop fence before either a result or ordinary message is admitted.
				conversationGroupsMu.Lock()
				stale, e := cm.readGroup(linkLogID(scope))
				conversationGroupsMu.Unlock()
				if e != nil {
					t.Fatal(e)
				}
				home.mu.Lock()
				origin := &conversationLinkOrigin{Scope: scope, From: id, Generation: 1, Kind: "result", TargetGeneration: stale.WorkspaceLink.Generation, ReplyGeneration: stale.WorkspaceLink.Generation}
				_, queuedErr := home.enqueueMessageLocked(id, WorkspaceMatrix, "queued-before-stop", "unconsumed result", "queued", "", nil, origin, "", "core_link")
				stopErr := home.manager.CancelGeneration(home.state.ID, actor, 0)
				_, dispatchErr := home.dispatchLocked(WorkspaceMatrix, "queued-before-stop", "unconsumed result")
				home.mu.Unlock()
				if queuedErr != nil || stopErr != nil || !errors.Is(dispatchErr, errCoreLinkStopped) {
					t.Fatal("direct runtime cancellation failed to fence an already queued result", queuedErr, stopErr, dispatchErr)
				}
				if home.Cancel() != nil {
					t.Fatal("failed to stop mailbox", e)
				}
				for _, kind := range []string{"result", "message"} {
					postReceipt(kind, "late-"+kind)
					msg := groupMessage{From: id, To: scope, Kind: kind, Text: "LATE-HOME-RESULT", Request: "stale-batch-" + kind, SenderGeneration: 1, TargetGeneration: stale.WorkspaceLink.Generation, ReplyGeneration: stale.WorkspaceLink.Generation}
					if err = h.enqueueCoreLink(stale, msg); err != nil {
						t.Fatal("stopped delivery should retire without execution", err)
					}
				}
				cm.scheduleWorkspaceLink(linkLogID(scope))
				waitCoreLink(t, "stopped inbox cursor did not settle", func() bool {
					conversationGroupsMu.Lock()
					defer conversationGroupsMu.Unlock()
					g, e := cm.readGroup(linkLogID(scope))
					return e == nil && g.WorkspaceLink.Cursor == g.Seq
				})
				out = invoke(map[string]any{"action": "link_invite", "request_id": "after-stop", "contact_id": contact.(map[string]any)["id"]})
				if out.OK || rootCalls.Load() != 2 {
					t.Fatal("stopped caller or late result restarted work")
				}
			} else {
				// A member finishing while another session is selected leaves its
				// receipt in the old mailbox, including across a host restart.
				contextTestAction(t, home, "new", map[string]any{"title": "other conversation"})
				postReceipt("result", "late-after-switch")
				cm.deliverWorkspaceLink(linkLogID(scope))
				home.mu.Lock()
				messages := len(home.state.Messages)
				home.mu.Unlock()
				if messages != 0 {
					t.Fatal("receipt crossed to selected unrelated session")
				}
				runtime := home.dir
				h.Close()
				if _, e := os.Stat(runtime); !os.IsNotExist(e) {
					t.Fatal("test did not release ephemeral home runtime", e)
				}
				nextHost, next := openCoreLinkHome(t, m.config, dir)
				defer nextHost.Close()
				if rootCalls.Load() != 2 || childCalls.Load() != 1 {
					t.Fatal("reopen replayed a model or delegated work")
				}
				contextTestAction(t, next, "switch", map[string]any{"id": scope})
				if rootCalls.Load() != 2 {
					t.Fatal("opening mailbox started a model")
				}
				if _, err = next.Send("explicit-resume", "Review any outstanding receipts"); err != nil {
					t.Fatal(err)
				}
				waitCoreLink(t, "pending receipt did not resume at explicit turn", func() bool {
					next.mu.Lock()
					defer next.mu.Unlock()
					for _, msg := range next.state.Messages {
						if msg.ID == "late-after-switch" && msg.State == "completed" && msg.CoreLink != nil {
							return true
						}
					}
					return false
				})
				if childCalls.Load() != 1 {
					t.Fatal("recovery replayed delegated work")
				}
			}
		})
	}
}

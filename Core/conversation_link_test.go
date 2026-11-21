// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestCoreLinkReopenRecoversReceiptWithoutReplayingWork; TestCoreLinkIndependentInviteQueueReceiptsAndPrivateScope; TestCoreLinkCommittedResultRecoveryAndCancellationFence
// Impact: python -B scripts/code-atlas.py show Core/conversation_link_test.go
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
	"sync/atomic"
	"testing"
	"time"
)

func TestCoreLinkReopenRecoversReceiptWithoutReplayingWork(t *testing.T) {
	var calls atomic.Int32
	m, _ := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		data, _ := json.Marshal(body)
		if calls.Add(1) == 2 && !strings.Contains(string(data), "durable-member-result") {
			t.Error("explicit continuation lost recovered result")
		}
		fixtureAnswer(w, "root", "root-result", nil)
	})
	h := NewWorkspaceHost(m.config, "", "")
	defer h.Close()
	v, e := h.conversationCall(context.Background(), rawJSON(map[string]any{"action": "create", "request_id": "root", "model_id": "local-model"}))
	if e != nil {
		t.Fatal(e)
	}
	root := v.(AgentRecord)
	cm, _ := h.conversationManager()
	if _, e = cm.Send(cm.owner, root.ID, "user", "initial work"); e != nil {
		t.Fatal(e)
	}
	root, e = cm.Wait(context.Background(), cm.owner, root.ID, 5000)
	if e != nil || root.State != "completed" {
		t.Fatal(root.State, e)
	}
	spec := root.Spec
	spec.ProfileID, spec.RequestID, spec.Task = root.ID, "member", ""
	member, e := cm.Create(context.WithValue(conversationPermissions(context.Background()), conversationLinkCreateKey{}, conversationLinkBinding{Scope: root.ID, Parent: root.ID}), cm.owner, spec)
	if e != nil {
		t.Fatal(e)
	}
	conversationGroupsMu.Lock()
	_, e = cm.linkRoom(root)
	conversationGroupsMu.Unlock()
	if e != nil {
		t.Fatal(e)
	}
	// Crash boundary: the worker's terminal record committed, but the final
	// addressed receipt had not been appended when the process ended.
	cm.mu.Lock()
	j := cm.jobs[member.ID]
	j.record.Generation, j.record.State, j.record.Result = 1, "completed", "durable-member-result"
	j.record.Turns = map[string]string{"delegated": "work"}
	j.record.TurnGenerations = map[string]int{"delegated": 1}
	rememberLinkOrigin(&j.record, "delegated", conversationLinkOrigin{Scope: root.ID, From: root.ID, Generation: 1, Kind: "message", Hops: 1})
	e = cm.saveLocked(j)
	cm.mu.Unlock()
	if e != nil {
		t.Fatal(e)
	}
	h.Close()
	h2 := NewWorkspaceHost(m.config, "", "")
	defer h2.Close()
	cm, e = h2.conversationManager()
	if e != nil {
		t.Fatal(e)
	}
	root, _ = cm.Status(cm.owner, root.ID)
	view, e := cm.conversationLinkView(root)
	if e != nil || len(view["messages"].([]groupMessage)) != 1 || calls.Load() != 1 {
		t.Fatal("reopen did not settle one receipt without running", view, calls.Load(), e)
	}
	if _, e = h2.conversationCall(context.Background(), rawJSON(map[string]any{"action": "member_avatar", "id": root.ID, "member_id": member.ID})); e != nil {
		t.Fatal("invited member avatar unavailable", e)
	}
	if _, e = h2.conversationCall(context.Background(), rawJSON(map[string]any{"action": "member_avatar", "id": root.ID, "member_id": "unrelated-session"})); e == nil {
		t.Fatal("conversation avatar read escaped membership")
	}
	memberView, e := h2.conversationCall(context.Background(), rawJSON(map[string]any{"action": "snapshot", "id": member.ID}))
	if e != nil || memberView.(map[string]any)["read_only"] != true {
		t.Fatal("invited view offered direct user routing", memberView, e)
	}
	cm.recoverLinkReceipts()
	if _, e = cm.Send(cm.owner, root.ID, "resume", "review the result"); e != nil {
		t.Fatal(e)
	}
	root, e = cm.Wait(context.Background(), cm.owner, root.ID, 5000)
	if e != nil || root.State != "completed" || calls.Load() != 2 || len(root.TurnOrigins) != 1 {
		t.Fatal(root.State, calls.Load(), len(root.TurnOrigins), e)
	}
	// Projection starts at a committed archive boundary. The real runtime
	// release must come from a running caller, covered by the team journey.
	conversationGroupsMu.Lock()
	g, archiveErr := cm.readGroup(linkLogID(root.ID))
	if archiveErr == nil {
		g.LinkReleased = map[string]int{member.ID: 1}
		archiveErr = cm.writeGroup(g)
	}
	conversationGroupsMu.Unlock()
	if archiveErr != nil {
		t.Fatal("persist archived member boundary", archiveErr)
	}
	assertArchivedAuthor := func(manager *AgentManager, host *WorkspaceHost) {
		t.Helper()
		view, err := manager.conversationLinkView(root)
		if err != nil {
			t.Fatal(err)
		}
		for _, row := range view["members"].([]map[string]any) {
			if row["id"] == member.ID {
				t.Fatal("archived author returned as a live seat", row)
			}
		}
		authors := view["authors"].([]map[string]any)
		contact, err := manager.contactOf(member)
		if err != nil {
			t.Fatal(err)
		}
		identity := manager.contactView(contact, nil)
		if len(authors) != 1 || authors[0]["id"] != member.ID || authors[0]["name"] != identity["name"] || authors[0]["role"] != identity["role"] || authors[0]["ring"] != identity["ring"] || authors[0]["activity"] != nil || authors[0]["live"] != nil {
			t.Fatal("archived Brief lost its identity or exposed live work", authors)
		}
		if _, err = host.conversationCall(context.Background(), rawJSON(map[string]any{"action": "member_avatar", "id": root.ID, "member_id": member.ID})); err != nil {
			t.Fatal("archived author avatar unavailable", err)
		}
		if _, err = host.conversationCall(context.Background(), rawJSON(map[string]any{"action": "member_avatar", "id": root.ID, "member_id": "unrelated-session"})); err == nil {
			t.Fatal("archived avatar read escaped the current message scope")
		}
	}
	assertArchivedAuthor(cm, h2)
	h2.Close()
	h3 := NewWorkspaceHost(m.config, "", "")
	defer h3.Close()
	cm, e = h3.conversationManager()
	if e != nil {
		t.Fatal(e)
	}
	assertArchivedAuthor(cm, h3)
	if calls.Load() != 2 {
		t.Fatal("archive author lookup replayed model work", calls.Load())
	}
	// Deleting the lead retires its independent members and the private Link
	// log, while the contact and replacement conversation stay usable.
	if _, e = cm.deleteContactSession(context.Background(), root.ID, "replacement"); e != nil {
		t.Fatal(e)
	}
	for _, id := range []string{root.ID, member.ID} {
		if _, e = cm.Status(cm.owner, id); e == nil {
			t.Fatal("deleted collaboration instance survived", id)
		}
	}
	if _, e = os.Stat(filepath.Join(cm.groupDir(), linkLogID(root.ID)+".jsonl")); !os.IsNotExist(e) {
		t.Fatal("deleted collaboration log survived", e)
	}
	if _, _, e = cm.liveContact(root.ID); e != nil {
		t.Fatal("contact lost with session", e)
	}
}

func TestCoreLinkIndependentInviteQueueReceiptsAndPrivateScope(t *testing.T) {
	rootStarted, rootRelease := make(chan struct{}), make(chan struct{})
	childStarted, childRelease := make(chan struct{}), make(chan struct{})
	var rootOnce, childOnce sync.Once
	defer rootOnce.Do(func() { close(rootRelease) })
	defer childOnce.Do(func() { close(childRelease) })
	var rootCalls, childCalls atomic.Int32
	m, _ := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		b, _ := json.Marshal(body)
		text := string(b)
		if strings.Contains(text, "member-persona") {
			if strings.Contains(text, "PRIVATE-OLD-CHAT") || strings.Contains(text, "ROOT-SECRET") {
				t.Error("private context crossed instance boundary")
			}
			if childCalls.Add(1) == 1 {
				close(childStarted)
				select {
				case <-childRelease:
				case <-r.Context().Done():
					return
				}
			}
			fixtureAnswer(w, "member", "member-result", nil)
			return
		}
		if rootCalls.Add(1) == 1 {
			close(rootStarted)
			select {
			case <-rootRelease:
			case <-r.Context().Done():
				return
			}
		} else if !strings.Contains(text, "member-result") {
			t.Error("completion missing from addressed inbox")
		}
		fixtureAnswer(w, "root", "root-done", nil)
	})
	h := NewWorkspaceHost(m.config, "", "")
	defer h.Close()
	call := func(p map[string]any) any {
		t.Helper()
		v, e := h.conversationCall(context.Background(), rawJSON(p))
		if e != nil {
			t.Fatal(e)
		}
		return v
	}
	childContact := call(map[string]any{"action": "contact_create", "request_id": "child", "model_id": "local-model", "name": "member", "prompt_text": "member-persona"}).(map[string]any)["id"].(string)
	root := call(map[string]any{"action": "create", "request_id": "root", "model_id": "local-model", "prompt": "root-persona"}).(AgentRecord)
	cm, _ := h.conversationManager()
	// This unrelated private instance is never adopted when its contact is invited.
	cm.mu.Lock()
	private := cm.jobs[childContact]
	private.record.Turns["private"] = "PRIVATE-OLD-CHAT"
	_ = cm.saveLocked(private)
	cm.mu.Unlock()
	if _, e := cm.Send(cm.owner, root.ID, "root-input", "ROOT-SECRET"); e != nil {
		t.Fatal(e)
	}
	select {
	case <-rootStarted:
	case <-time.After(5 * time.Second):
		t.Fatal("root did not start")
	}
	ctx := context.WithValue(context.Background(), conversationLinkCallerKey{}, conversationLinkCaller{ID: root.ID, Generation: 1})
	link := func(p map[string]any) (any, error) { return cm.Call(ctx, root.ID, rawJSON(p)) }
	created, e := link(map[string]any{"action": "link_invite", "request_id": "invite-1", "contact_id": childContact})
	if e != nil {
		t.Fatal(e)
	}
	child := created.(map[string]any)["id"].(string)
	if child == childContact {
		t.Fatal("borrowed private instance")
	}
	if _, e = h.conversationCall(context.Background(), rawJSON(map[string]any{"action": "send", "id": child, "request_id": "user-bypass", "message": "bypass lead"})); e == nil {
		t.Fatal("user bypassed single conversation lead")
	}
	again, e := link(map[string]any{"action": "link_invite", "request_id": "invite-1", "contact_id": childContact})
	if e != nil || again.(map[string]any)["id"] != child {
		t.Fatal("duplicate invitation", e)
	}
	if _, e = link(map[string]any{"action": "link_send", "id": childContact, "generation": 0, "request_id": "cross", "message": "cross-scope"}); e == nil {
		t.Fatal("cross scope send admitted")
	}
	msg := map[string]any{"action": "link_send", "id": child, "generation": 0, "request_id": "work", "message": "necessary-facts-only", "brief": "Authored public summary"}
	accepted, e := link(msg)
	if e != nil {
		t.Fatal(e)
	}
	select {
	case <-childStarted:
	case <-time.After(5 * time.Second):
		t.Fatal("invited member did not start")
	}
	if _, e = link(msg); e != nil {
		t.Fatal("accepted request replay", e)
	}
	projection, err := cm.conversationLinkView(root)
	if err != nil || projection == nil {
		t.Fatal("missing public Link projection", err)
	}
	logged := projection["messages"].([]groupMessage)
	if len(logged) != 1 || logged[0].Brief != "Authored public summary" || logged[0].Text != "necessary-facts-only" {
		t.Fatal("Brief must retain the independent original", logged)
	}
	msg["brief"] = "conflicting summary"
	if _, e = link(msg); e == nil {
		t.Fatal("same request accepted a changed Brief")
	}
	msg["brief"] = "Authored public summary"
	msg["message"] = "different"
	if _, e = link(msg); e == nil {
		t.Fatal("request conflict accepted")
	}
	if _, e = cm.Call(context.Background(), root.ID, rawJSON(map[string]any{"action": "link_directory"})); e == nil {
		t.Fatal("unbound caller admitted")
	}
	if _, e = link(map[string]any{"action": "contact_delete", "id": childContact}); e == nil {
		t.Fatal("collaborator acquired mother controls")
	}
	childOnce.Do(func() { close(childRelease) })
	deadline := time.Now().Add(5 * time.Second)
	for {
		r, _ := cm.Status(cm.owner, root.ID)
		if len(r.PendingMessages) > 0 {
			if r.PendingMessages[0].From == "user" || r.PendingMessages[0].Origin != "core_link" {
				t.Fatal("internal reply masqueraded as user")
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("completion was not queued", accepted)
		}
		time.Sleep(10 * time.Millisecond)
	}
	rootOnce.Do(func() { close(rootRelease) })
	r, e := cm.Wait(context.Background(), cm.owner, root.ID, 5000)
	if e != nil || r.State != "completed" {
		t.Fatal(r.State, r.Error, e)
	}
	if rootCalls.Load() != 2 || childCalls.Load() != 1 {
		t.Fatal(rootCalls.Load(), childCalls.Load())
	}
	rows, e := cm.listContacts()
	if e != nil {
		t.Fatal(e)
	}
	for _, row := range rows {
		for _, v := range row["sessions"].([]map[string]any) {
			if v["id"] == child {
				t.Fatal("invited instance leaked into private session list")
			}
		}
	}
	conversationGroupsMu.Lock()
	groups, e := cm.listGroups()
	conversationGroupsMu.Unlock()
	if e != nil || len(groups) != 0 {
		t.Fatal("core Link created a visible group", e)
	}
	view, e := cm.conversationSnapshot(r, 0, 0)
	if e != nil {
		t.Fatal(e)
	}
	for _, row := range view.(map[string]any)["messages"].([]map[string]any) {
		if row["from"] == "user" && strings.Contains(row["text"].(string), "Core Link") {
			t.Fatal("internal reply displayed as user")
		}
	}
	// Persisted receipts survive reopening without restarting any model call.
	h.Close()
	h2 := NewWorkspaceHost(m.config, "", "")
	defer h2.Close()
	restored, e := h2.conversationManager()
	if e != nil {
		t.Fatal(e)
	}
	saved, e := restored.Status(restored.owner, child)
	if e != nil || saved.Link == nil || len(saved.TurnOrigins) != 1 || childCalls.Load() != 1 {
		t.Fatal("link identity/receipt lost", e)
	}
}

func TestCoreLinkCommittedResultRecoveryAndCancellationFence(t *testing.T) {
	var calls atomic.Int32
	m, _ := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) { calls.Add(1); fixtureAnswer(w, "done", "done", nil) })
	h := NewWorkspaceHost(m.config, "", "")
	defer h.Close()
	v, e := h.conversationCall(context.Background(), rawJSON(map[string]any{"action": "create", "request_id": "root", "model_id": "local-model"}))
	if e != nil {
		t.Fatal(e)
	}
	r := v.(AgentRecord)
	cm, _ := h.conversationManager()
	if _, e = cm.Send(cm.owner, r.ID, "one", "user task"); e != nil {
		t.Fatal(e)
	}
	r, e = cm.Wait(context.Background(), cm.owner, r.ID, 5000)
	if e != nil {
		t.Fatal(e)
	}
	spec := r.Spec
	spec.ProfileID = r.ID
	spec.RequestID = "invited"
	spec.Task = ""
	member, e := cm.Create(context.WithValue(conversationPermissions(context.Background()), conversationLinkCreateKey{}, conversationLinkBinding{Scope: r.ID, Parent: r.ID}), cm.owner, spec)
	if e != nil {
		t.Fatal(e)
	}
	conversationGroupsMu.Lock()
	g, e := cm.linkRoom(r)
	if e != nil {
		conversationGroupsMu.Unlock()
		t.Fatal(e)
	}
	// The append committed, but the receiving turn was already sealed. There
	// is no accepted inbox receipt yet, exactly the crash/race recovery case.
	_, e = cm.appendGroupMessage(g, groupMessage{From: member.ID, To: r.ID, Kind: "result", Text: "committed result", Request: "committed-result", TargetGeneration: 1, SenderGeneration: 1, ReplyGeneration: 1})
	conversationGroupsMu.Unlock()
	if e != nil {
		t.Fatal(e)
	}
	cm.settleLink(r)
	r, e = cm.Wait(context.Background(), cm.owner, r.ID, 5000)
	if e != nil || r.Generation != 2 || r.State != "completed" {
		t.Fatal(r.Generation, r.State, e)
	}
	if r.TurnOrigins["committed-result"].Kind != "result" {
		t.Fatal("recovered origin lost")
	}
	cm.settleLink(r)
	if calls.Load() != 2 {
		t.Fatal("committed message replayed", calls.Load())
	}
	if e = cm.Cancel(cm.owner, r.ID); e != nil {
		t.Fatal(e)
	}
	conversationGroupsMu.Lock()
	_, e = cm.appendGroupMessage(g, groupMessage{From: member.ID, To: r.ID, Kind: "result", Text: "cancelled task result", Request: "late-result", TargetGeneration: 2, SenderGeneration: 1, ReplyGeneration: 2})
	conversationGroupsMu.Unlock()
	if e != nil {
		t.Fatal(e)
	}
	cm.settleLink(r)
	if calls.Load() != 2 {
		t.Fatal("cancelled conversation restarted")
	}
	if _, e = cm.Send(cm.owner, r.ID, "new-user", "new unrelated task"); e != nil {
		t.Fatal(e)
	}
	r, e = cm.Wait(context.Background(), cm.owner, r.ID, 5000)
	if e != nil {
		t.Fatal(e)
	}
	cm.settleLink(r)
	current, e := cm.Status(cm.owner, r.ID)
	if e != nil || calls.Load() != 3 || current.Generation != 3 {
		t.Fatal("late result crossed cancellation fence", calls.Load(), current.Generation, e)
	}
	if _, ok := current.TurnOrigins["late-result"]; ok {
		t.Fatal("cancelled result admitted into new task")
	}
}

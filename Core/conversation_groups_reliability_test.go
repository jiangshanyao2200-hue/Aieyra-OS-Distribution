// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestGroupSnapshotReaderDoesNotBlockCommit; groupFixture; newGroupFixture; call; must; group; settle; checkSeqs; TestGroupLogIsTheCommitPoint; TestGroupPostIsIdempotent; TestGroupSettleAfterInterruptedReleasePostsOnce; TestGroupBacklogPagesWithoutDropping; TestGroupHistoryPagesBackAndHostCountsAsActive; TestContactUpdateRollsBackOnFailure; TestContactThinkingChoice; TestGroupLongResultIsShownAndReleased; TestGroupRetryAfterManyMessagesPostsOnce; TestGroupDeliveryCheckpointLossRecovers; TestGroupLivePreservesAttentionAndRunState; TestGroupPendingPublicationIsNotIdle; TestGroupLivePreservesFullCurrentStream
// Impact: python -B scripts/code-atlas.py show Core/conversation_groups_reliability_test.go
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
	"testing"
	"time"

	"github.com/aieyra/aieyra-os/CORE/internal/privatefile"
)

func TestGroupSnapshotReaderDoesNotBlockCommit(t *testing.T) {
	f := newGroupFixture(t, nil)
	id := f.group()
	g, err := f.m.readGroup(id)
	if err != nil {
		t.Fatal(err)
	}
	reader, err := privatefile.OpenSnapshot(filepath.Join(f.m.groupDir(), id+".json"))
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	original := g.Name
	g.Name = "new committed name"
	if err = f.m.writeGroup(g); err != nil {
		t.Fatal("active reader blocked group commit", err)
	}
	raw, err := io.ReadAll(reader)
	if err != nil {
		t.Fatal(err)
	}
	var old conversationGroup
	if err = json.Unmarshal(raw, &old); err != nil || old.Name != original {
		t.Fatal("old reader lost its complete snapshot", err, old.Name)
	}
	current, err := f.m.readGroup(id)
	if err != nil || current.Name != g.Name {
		t.Fatal("new reader missed committed group", err, current)
	}
	// Admission reads while holding the AgentManager lock, outside the group
	// writer lock. Exercise that actual concurrent read/replace contract too.
	errors := make(chan error, 1)
	go func() {
		for i := 0; i < 64; i++ {
			if _, e := f.m.readGroup(id); e != nil {
				errors <- e
				return
			}
		}
		errors <- nil
	}()
	for i := 0; i < 64; i++ {
		g.Name = fmt.Sprint(i)
		if err = f.m.writeGroup(g); err != nil {
			break
		}
	}
	readErr := <-errors
	if err != nil || readErr != nil {
		t.Fatalf("concurrent group access: writer=%v reader=%v", err, readErr)
	}
}

type groupFixture struct {
	t    *testing.T
	h    *WorkspaceHost
	m    *AgentManager
	mu   sync.Mutex
	body map[string][]string
}

// newGroupFixture answers every member with [PASS] unless reply says otherwise,
// and records each member's request bodies by persona marker.
func newGroupFixture(t *testing.T, reply func(who string, n int) string) *groupFixture {
	f := &groupFixture{t: t, body: map[string][]string{}}
	m, _ := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		raw, _ := json.Marshal(body)
		who := "host"
		if strings.Contains(string(raw), "persona-jia") {
			who = "jia"
		}
		f.mu.Lock()
		f.body[who] = append(f.body[who], string(raw))
		n := len(f.body[who])
		f.mu.Unlock()
		text := groupPass
		if reply != nil {
			text = reply(who, n)
		}
		fixtureAnswer(w, fmt.Sprintf("%s%d", who, n), text, nil)
	})
	f.h = NewWorkspaceHost(m.config, "", " ")
	t.Cleanup(f.h.Close)
	cm, err := f.h.conversationManager()
	if err != nil {
		t.Fatal(err)
	}
	f.m = cm
	return f
}

func (f *groupFixture) call(p map[string]any) (any, error) {
	return f.h.conversationCall(context.Background(), rawJSON(p))
}

func (f *groupFixture) must(p map[string]any) map[string]any {
	f.t.Helper()
	v, err := f.call(p)
	if err != nil {
		f.t.Fatal(p["action"], err)
	}
	return v.(map[string]any)
}

func (f *groupFixture) group(members ...string) string {
	jia := f.must(map[string]any{"action": "contact_create", "request_id": "c-jia", "model_id": "local-model", "name": "甲", "prompt_text": "persona-jia"})["id"].(string)
	return f.must(map[string]any{"action": "group_create", "request_id": "g", "name": "讨论", "members": append([]string{jia}, members...)})["id"].(string)
}

func (f *groupFixture) settle(id string) []groupMessage {
	f.t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for {
		v := f.must(map[string]any{"action": "group", "id": id})
		idle := true
		for _, member := range v["members"].([]map[string]any) {
			idle = idle && member["state"] == "idle"
		}
		if idle {
			return v["messages"].([]groupMessage)
		}
		if time.Now().After(deadline) {
			f.t.Fatalf("group did not settle: %+v", v)
		}
		time.Sleep(40 * time.Millisecond)
	}
}

func checkSeqs(t *testing.T, msgs []groupMessage) {
	t.Helper()
	for i, msg := range msgs {
		if i > 0 && msg.Seq != msgs[i-1].Seq+1 {
			t.Fatalf("seq not consecutive at %d: %+v", i, msgs)
		}
	}
}

// The message file is the commit point: a line whose metadata write was lost
// is adopted, never reused, and a torn tail is replaced by the next message.
func TestGroupLogIsTheCommitPoint(t *testing.T) {
	f := newGroupFixture(t, nil)
	id := f.group()
	conversationGroupsMu.Lock()
	g, err := f.m.readGroup(id)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 3; i++ {
		if _, err = f.m.appendGroupMessage(g, groupMessage{From: "system", Name: "系统", Kind: "system", Text: fmt.Sprint("line ", i)}); err != nil {
			t.Fatal(err)
		}
	}
	// Metadata falls behind the file, as after a failed write, and the process restarts.
	g.Seq = 1
	if err = f.m.writeGroup(g); err != nil {
		t.Fatal(err)
	}
	path := f.m.groupLogPath(id)
	delete(groupLogs, path)
	file, _ := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0600)
	_, _ = file.WriteString(`{"seq":5,"from":"sys`)
	_ = file.Close()
	g, _ = f.m.readGroup(id)
	msg, err := f.m.appendGroupMessage(g, groupMessage{From: "system", Name: "系统", Kind: "system", Text: "after restart"})
	conversationGroupsMu.Unlock()
	if err != nil || msg.Seq != 5 {
		t.Fatalf("next seq %d err %v, want 5", msg.Seq, err)
	}
	msgs := f.settle(id)
	if len(msgs) != 5 || msgs[4].Text != "after restart" {
		t.Fatalf("messages after recovery: %+v", msgs)
	}
	checkSeqs(t, msgs)
	data, _ := os.ReadFile(path)
	if strings.Contains(string(data), `"from":"sys{`) || strings.Count(string(data), "\n") != 5 {
		t.Fatalf("torn tail left in file: %q", data)
	}
}

// The same request id never posts twice; other text under it is a conflict.
func TestGroupPostIsIdempotent(t *testing.T) {
	f := newGroupFixture(t, nil)
	id := f.group()
	for i := 0; i < 2; i++ {
		f.must(map[string]any{"action": "group_post", "id": id, "text": "大家好", "request_id": "r1"})
	}
	if _, err := f.call(map[string]any{"action": "group_post", "id": id, "text": "别的话", "request_id": "r1"}); err == nil || !strings.Contains(err.Error(), "conflict") {
		t.Fatalf("conflicting retry accepted: %v", err)
	}
	users := 0
	for _, msg := range f.settle(id) {
		if msg.From == "user" {
			users++
		}
	}
	if users != 1 {
		t.Fatalf("user messages = %d, want 1", users)
	}
	f.mu.Lock()
	hostCalls := len(f.body["host"])
	f.mu.Unlock()
	if hostCalls != 1 {
		t.Fatalf("host answered %d times, want 1", hostCalls)
	}
}

// A settle interrupted after publishing (wait not yet released) publishes nothing again.
func TestGroupSettleAfterInterruptedReleasePostsOnce(t *testing.T) {
	f := newGroupFixture(t, func(who string, n int) string { return "收到，我来看看。" })
	id := f.group()
	f.must(map[string]any{"action": "group_post", "id": id, "text": "@甲 看一下", "request_id": "r1"})
	before := f.settle(id)
	conversationGroupsMu.Lock()
	g, _ := f.m.readGroup(id)
	r, _ := f.m.Status(f.m.owner, g.Members[0].Session)
	g.Members[0].Await = r.Generation
	err := f.m.writeGroup(g)
	conversationGroupsMu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	after := f.settle(id)
	if len(after) != len(before) {
		t.Fatalf("result posted again: before %d after %d: %+v", len(before), len(after), after)
	}
}

// A backlog larger than one request goes out in pages; every message arrives.
func TestGroupBacklogPagesWithoutDropping(t *testing.T) {
	f := newGroupFixture(t, nil)
	id := f.group()
	conversationGroupsMu.Lock()
	g, _ := f.m.readGroup(id)
	for i := 0; i < 8; i++ {
		text := fmt.Sprintf("marker-%d ", i) + strings.Repeat("长", 3300)
		if _, err := f.m.groupPost(g, "eyra", text, "chat", "", 0, ""); err != nil {
			conversationGroupsMu.Unlock()
			t.Fatal(err)
		}
	}
	conversationGroupsMu.Unlock()
	f.must(map[string]any{"action": "group_post", "id": id, "text": "@甲 上面这些都看看", "request_id": "r1"})
	f.settle(id)
	f.mu.Lock()
	all := strings.Join(f.body["jia"], "\n")
	pages := len(f.body["jia"])
	f.mu.Unlock()
	if pages < 2 {
		t.Fatalf("backlog sent in %d request, want pages", pages)
	}
	for i := 0; i < 8; i++ {
		if !strings.Contains(all, fmt.Sprintf("marker-%d ", i)) {
			t.Fatalf("marker-%d never delivered", i)
		}
	}
	if !strings.Contains(all, "上面这些都看看") {
		t.Fatal("the mention itself was never delivered")
	}
}

// History reads back through pages with before; the list counts a working host.
func TestGroupHistoryPagesBackAndHostCountsAsActive(t *testing.T) {
	f := newGroupFixture(t, nil)
	id := f.group()
	conversationGroupsMu.Lock()
	g, _ := f.m.readGroup(id)
	for i := 0; i < 250; i++ {
		_, _ = f.m.appendGroupMessage(g, groupMessage{From: "system", Name: "系统", Kind: "system", Text: fmt.Sprint("h", i)})
	}
	conversationGroupsMu.Unlock()
	v := f.must(map[string]any{"action": "group", "id": id})
	latest := v["messages"].([]groupMessage)
	if len(latest) != groupViewPage || v["has_older"] != true {
		t.Fatalf("latest page %d older %v", len(latest), v["has_older"])
	}
	older := f.must(map[string]any{"action": "group", "id": id, "before": latest[0].Seq})
	page := older["messages"].([]groupMessage)
	if len(page) != int(latest[0].Seq-1) || page[len(page)-1].Seq != latest[0].Seq-1 || older["has_older"] != false {
		t.Fatalf("older page %d last %d older %v", len(page), page[len(page)-1].Seq, older["has_older"])
	}
	checkSeqs(t, append(page, latest...))

	conversationGroupsMu.Lock()
	g, _ = f.m.readGroup(id)
	host := g.Host.Session
	conversationGroupsMu.Unlock()
	f.m.mu.Lock()
	f.m.jobs[host].record.State = "running"
	f.m.mu.Unlock()
	rows, err := f.call(map[string]any{"action": "groups"})
	f.m.mu.Lock()
	f.m.jobs[host].record.State = "completed"
	f.m.mu.Unlock()
	if err != nil || rows.([]map[string]any)[0]["active"] != true {
		t.Fatalf("working host not active: %v %v", rows, err)
	}
}

// A profile save that fails part-way leaves the prompt as it was.
func TestContactUpdateRollsBackOnFailure(t *testing.T) {
	f := newGroupFixture(t, nil)
	c := f.must(map[string]any{"action": "contact_create", "request_id": "c1", "model_id": "local-model", "name": "甲", "prompt_text": "original persona"})
	id := c["id"].(string)
	detail := f.must(map[string]any{"action": "contact", "id": id})
	// Block the avatar write by putting a directory where the file goes.
	// New contacts now have an initialized built-in avatar at this path.
	if err := os.Remove(filepath.Join(f.m.contactDir(), id+".avatar")); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(f.m.contactDir(), id+".avatar", "x"), 0700); err != nil {
		t.Fatal(err)
	}
	png := "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
	if _, err := f.call(map[string]any{"action": "contact_update", "id": id, "prompt_text": "edited persona", "prompt_hash": detail["prompt_hash"], "avatar": png}); err == nil {
		t.Fatal("save with a failing avatar write succeeded")
	}
	if got := f.must(map[string]any{"action": "contact", "id": id})["prompt"]; got != "original persona" {
		t.Fatalf("prompt after rejected save = %q", got)
	}
}

// An agent's own thinking choice is laid over its model for its sessions only,
// survives a new session, is cleared by a model change, and rejects other keys.
func TestContactThinkingChoice(t *testing.T) {
	f := newGroupFixture(t, nil)
	c := f.must(map[string]any{"action": "contact_create", "request_id": "c1", "model_id": "local-model", "name": "甲", "model_parameters": map[string]any{"reasoning_effort": "minimal"}})
	id := c["id"].(string)
	effort := func(sessionID string) string {
		t.Helper()
		f.m.mu.Lock()
		spec := f.m.jobs[sessionID].record.Spec
		f.m.mu.Unlock()
		s, err := f.m.specSettings(spec)
		if err != nil {
			t.Fatal(err)
		}
		return s.ReasoningEffort
	}
	if got := effort(id); got != "minimal" {
		t.Fatalf("effort = %q", got)
	}
	if pool, _ := f.m.settings("local-model"); pool.ReasoningEffort == "minimal" {
		t.Fatal("agent choice leaked into the model pool")
	}
	s := f.must(map[string]any{"action": "session_create", "contact_id": id, "request_id": "s2"})
	if got := effort(s["id"].(string)); got != "minimal" {
		t.Fatalf("new session effort = %q", got)
	}
	if _, err := f.call(map[string]any{"action": "contact_update", "id": id, "model_parameters": map[string]any{"temperature": 2}}); err == nil {
		t.Fatal("non-thinking parameter accepted")
	}
	f.must(map[string]any{"action": "contact_update", "id": id, "model_parameters": map[string]any{"reasoning_effort": "low"}})
	if got := effort(id); got != "low" {
		t.Fatalf("updated effort = %q", got)
	}
	if raw, _ := json.Marshal(f.must(map[string]any{"action": "contact", "id": id})["model_parameters"]); !strings.Contains(string(raw), "low") {
		t.Fatalf("detail model_parameters = %s", raw)
	}
	f.must(map[string]any{"action": "contact_update", "id": id, "model_parameters": nil})
	pool, err := f.m.settings("local-model")
	if err != nil {
		t.Fatal(err)
	}
	if got := effort(id); got != pool.ReasoningEffort {
		t.Fatalf("null effort = %q, model pool default = %q", got, pool.ReasoningEffort)
	}
	if raw, _ := json.Marshal(f.must(map[string]any{"action": "contact", "id": id})["model_parameters"]); strings.Contains(string(raw), "reasoning_effort") {
		t.Fatalf("cleared contact still has a thinking override: %s", raw)
	}
}

// A result longer than one group message is shown from its start, says how long
// it is and where the whole text is, and the member's wait is released.
func TestGroupLongResultIsShownAndReleased(t *testing.T) {
	long := strings.Repeat("长", 7200)
	f := newGroupFixture(t, func(who string, n int) string {
		if who == "jia" {
			return long
		}
		return groupPass
	})
	id := f.group()
	f.must(map[string]any{"action": "group_post", "id": id, "text": "@甲 写一份长报告", "request_id": "r1"})
	var got groupMessage
	for _, msg := range f.settle(id) {
		if strings.HasPrefix(msg.Text, "长长") {
			got = msg
		}
	}
	if got.Seq == 0 || len(got.Text) > groupMessageLimit || !strings.Contains(got.Text, "7200 字") || !strings.Contains(got.Text, "甲 的私聊") {
		t.Fatalf("long result = %d bytes: %q", len(got.Text), got.Text[max(0, len(got.Text)-120):])
	}
	conversationGroupsMu.Lock()
	g, _ := f.m.readGroup(id)
	conversationGroupsMu.Unlock()
	if g.Members[0].Await != 0 {
		t.Fatal("wait not released")
	}
}

// A request id stays recognised however many messages follow, also after the index is rebuilt.
func TestGroupRetryAfterManyMessagesPostsOnce(t *testing.T) {
	f := newGroupFixture(t, nil)
	id := f.group()
	conversationGroupsMu.Lock()
	defer conversationGroupsMu.Unlock()
	g, _ := f.m.readGroup(id)
	if _, err := f.m.groupPost(g, "eyra", "原请求", "chat", "", 0, "keep"); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 520; i++ {
		if _, err := f.m.appendGroupMessage(g, groupMessage{From: "system", Name: "系统", Kind: "system", Text: fmt.Sprint(i)}); err != nil {
			t.Fatal(err)
		}
	}
	before := g.Seq
	if _, err := f.m.groupPost(g, "eyra", "原请求", "chat", "", 0, "keep"); err != nil {
		t.Fatal(err)
	}
	if _, err := f.m.groupPost(g, "eyra", "别的话", "chat", "", 0, "keep"); err == nil {
		t.Fatal("conflicting retry accepted")
	}
	delete(groupLogs, f.m.groupLogPath(id))
	if _, err := f.m.groupPost(g, "eyra", "原请求", "chat", "", 0, "keep"); err != nil {
		t.Fatal(err)
	}
	if g.Seq != before {
		t.Fatalf("retry wrote again: seq %d -> %d", before, g.Seq)
	}
}

// A turn the agent accepted is picked up again after the checkpoint behind it
// was lost: the reply appears once and the model is asked once.
func TestGroupDeliveryCheckpointLossRecovers(t *testing.T) {
	f := newGroupFixture(t, func(who string, n int) string { return "收到。" })
	id := f.group()
	f.settle(id)
	conversationGroupsMu.Lock()
	g, _ := f.m.readGroup(id)
	member := &g.Members[0]
	msg, err := f.m.appendGroupMessage(g, groupMessage{From: "user", Name: "你", Kind: "chat", Text: "@甲 在吗", Mentions: []string{member.Contact}})
	if err != nil {
		conversationGroupsMu.Unlock()
		t.Fatal(err)
	}
	r, _ := f.m.Status(f.m.owner, member.Session)
	request := fmt.Sprintf("group:%s:%d:%s", g.ID, msg.Seq, member.Contact)
	member.Sending, member.SendingUpto, member.Task = request, msg.Seq, msg.Text
	err = f.m.writeGroup(g)
	if err == nil {
		_, err = f.m.SendGeneration(f.m.owner, member.Session, request, "群聊 @甲 在吗", r.Generation)
	}
	conversationGroupsMu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(10 * time.Second)
	for {
		replies := 0
		for _, m := range f.settle(id) {
			if m.From == member.Contact && m.Text == "收到。" {
				replies++
			}
		}
		if replies == 1 {
			break
		}
		if replies > 1 || time.Now().After(deadline) {
			t.Fatalf("replies = %d", replies)
		}
		time.Sleep(50 * time.Millisecond)
	}
	f.mu.Lock()
	calls := len(f.body["jia"])
	f.mu.Unlock()
	if calls != 1 {
		t.Fatalf("model asked %d times, want 1", calls)
	}
}

// A model may finish between groupReconcile's status read and groupLive's.
// Keep the watcher behind the group lock to observe that exact commit boundary.
func TestGroupLivePreservesAttentionAndRunState(t *testing.T) {
	f := newGroupFixture(t, nil)
	id := f.group()
	g, err := f.m.readGroup(id)
	if err != nil {
		t.Fatal(err)
	}
	member := g.Members[0]
	for _, state := range []string{"failed", "timed_out", "interrupted", "persistence_failed", "waiting_user", "queued", "cancelling"} {
		t.Run(state, func(t *testing.T) {
			f.m.mu.Lock()
			job := f.m.jobs[member.Session]
			job.record.State, job.record.Error, job.record.Updated = state, "visible failure", "2026-11-07T00:00:00Z"
			f.m.mu.Unlock()
			live := f.m.groupLive(member, "甲", true)
			if live["state"] != state || live["updated"] != "2026-11-07T00:00:00Z" {
				t.Fatalf("lost current member status: %#v", live)
			}
			if state == "failed" && live["error"] != "visible failure" {
				t.Fatalf("failure reason missing: %#v", live)
			}
		})
	}
	f.m.mu.Lock()
	f.m.jobs[member.Session].record.State = "idle"
	f.m.mu.Unlock()
}

func TestGroupPendingPublicationIsNotIdle(t *testing.T) {
	gate := make(chan struct{})
	var release sync.Once
	defer release.Do(func() { close(gate) })
	t.Cleanup(func() { release.Do(func() { close(gate) }) })
	f := newGroupFixture(t, func(who string, n int) string { <-gate; return "完整结果只发布一次。" })
	id := f.group()
	f.must(map[string]any{"action": "group_post", "id": id, "text": "@甲 看一下", "request_id": "pending-publication"})
	conversationGroupsMu.Lock()
	defer conversationGroupsMu.Unlock()
	g, err := f.m.readGroup(id)
	if err != nil {
		t.Fatal(err)
	}
	member := g.Members[0]
	if member.Await == 0 {
		t.Fatal("fixture has no pending publication")
	}
	release.Do(func() { close(gate) })
	r, err := f.m.Wait(context.Background(), f.m.owner, member.Session, 5000)
	if err != nil || r.State != "completed" {
		t.Fatalf("model did not complete: %+v %v", r, err)
	}
	live := f.m.groupLive(member, "甲", true)
	if live["state"] == "idle" {
		t.Fatal("unpublished completed result was projected as idle")
	}
	groups, err := f.m.listGroups()
	if err != nil || len(groups) != 1 || groups[0]["active"] != true {
		t.Fatalf("pending group disappeared from active list: %+v %v", groups, err)
	}
	if err = f.m.groupSettle(g, member.Contact); err != nil {
		t.Fatal(err)
	}
	before, err := f.m.groupMessages(g, 0)
	if err != nil || len(before) != 3 {
		t.Fatalf("publication missing: %+v %v", before, err)
	}
	if f.m.groupLive(g.Members[0], "甲", true)["state"] != "idle" {
		t.Fatal("published member did not become idle")
	}
	// Simulate the interrupted release without altering the committed result.
	g.Members[0].Await = r.Generation
	if err = f.m.writeGroup(g); err != nil {
		t.Fatal(err)
	}
	if err = f.m.groupSettle(g, member.Contact); err != nil {
		t.Fatal(err)
	}
	after, err := f.m.groupMessages(g, 0)
	if err != nil || len(after) != 3 || after[2].Request != before[2].Request {
		t.Fatalf("duplicate publication: %+v %v", after, err)
	}
}

func TestGroupLivePreservesFullCurrentStream(t *testing.T) {
	f := newGroupFixture(t, nil)
	g, err := f.m.readGroup(f.group())
	if err != nil {
		t.Fatal(err)
	}
	member := g.Members[0]
	f.m.mu.Lock()
	job := f.m.jobs[member.Session]
	job.record.State, job.record.Generation = "running", 7
	f.m.mu.Unlock()
	defer func() { f.m.mu.Lock(); job.record.State = "idle"; f.m.mu.Unlock() }()
	text := strings.Repeat("连续流式正文核对，", 80) + "正文末词96"
	thought := strings.Repeat("完整思考过程核对，", 60) + "思考末词97"
	projection := f.m.streamProjection
	projection.mu.Lock()
	projection.live[member.Session] = WorkspaceLive{Generation: 7, Phase: "body", Text: text, Thought: thought, BodyID: "request7", BodyAt: 100, ReasoningStartedAt: 50}
	projection.mu.Unlock()
	live := f.m.groupLive(member, "甲", true)
	if live["text"] != text || live["thought"] != thought || live["phase"] != "body" {
		t.Fatalf("group stream lost current content: body=%d/%d thought=%d/%d phase=%v", len([]rune(fmt.Sprint(live["text"]))), len([]rune(text)), len([]rune(fmt.Sprint(live["thought"]))), len([]rune(thought)), live["phase"])
	}
	stream, ok := live["live"].(WorkspaceLive)
	if !ok || stream.BodyID != "request7" || stream.BodyAt != 100 || stream.ReasoningStartedAt != 50 || stream.Text != text || stream.Thought != thought {
		t.Fatal("group projection lost stream identity", stream)
	}
	f.m.mu.Lock()
	job.record.Generation = 8
	f.m.mu.Unlock()
	stale := f.m.groupLive(member, "甲", true)
	if _, exists := stale["text"]; exists {
		t.Fatal("old generation leaked its body into the new group turn")
	}
	if _, exists := stale["thought"]; exists {
		t.Fatal("old generation leaked its thought into the new group turn")
	}
	if _, exists := stale["live"]; exists {
		t.Fatal("old generation leaked its stream identity into the new group turn")
	}
}

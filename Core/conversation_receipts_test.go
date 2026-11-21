// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: receiptConversationFixture; receiptConversationSession; receiptConversationRead; TestConversationReceiptIsReadOnlyAndNeverInitializesService; TestConversationReceiptOwnSessionAndActualLinkMembership; TestConversationReceiptGroupUsesGroupIDAndRealMemberSession; TestConversationReceiptLoadedArchiveKeepsOldGenerationWithoutRuntime; receiptWorkspaceFixture; TestWorkspaceReceiptScopesEpochViewAndOriginalGeneration; TestWorkspaceReceiptMemberUsesOnlySelectedContextRoom
// Impact: python -B scripts/code-atlas.py show Core/conversation_receipts_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func receiptConversationFixture(t *testing.T) (*WorkspaceHost, *AgentManager) {
	t.Helper()
	m := &AgentManager{owner: conversationOwner, config: t.TempDir(), dir: t.TempDir(), jobs: map[string]*agentJob{}}
	return &WorkspaceHost{config: m.config, conversations: m}, m
}

func receiptConversationSession(t *testing.T, m *AgentManager, id, input string) (*agentJob, string) {
	t.Helper()
	a := &SessionArchive{ephemeral: true}
	receiptMeta(t, a, id, 2)
	call := receiptIntent(t, a, "shared-invocation", "same-call", input)
	receiptAppend(t, a, "tool_progress", ToolReceipt{Key: call, ToolName: "read_file", Output: `{"ok":true,"result":"` + input + `"}`})
	j := &agentJob{record: AgentRecord{ID: id, Parent: m.owner, Generation: 8, State: "idle", Spec: AgentSpec{Kind: "conversation"}}, archive: a}
	m.jobs[id] = j
	return j, call
}

func receiptConversationRead(t *testing.T, h *WorkspaceHost, p conversationReceiptRequest) map[string]any {
	t.Helper()
	r, err := h.conversationCall(context.Background(), rawJSON(p))
	if err != nil {
		t.Fatal(err)
	}
	return r.(map[string]any)
}

func TestConversationReceiptIsReadOnlyAndNeverInitializesService(t *testing.T) {
	config := t.TempDir()
	h := &WorkspaceHost{config: config}
	for _, action := range []string{"receipt", "group_receipt"} {
		r, err := h.conversationCall(context.Background(), rawJSON(conversationReceiptRequest{Action: action, ID: strings.Repeat("a", 32), GroupID: strings.Repeat("b", 32), MemberID: strings.Repeat("c", 32), CallID: "original:call"}))
		if err != nil || r.(map[string]any)["unavailable"] != true {
			t.Fatal(r, err)
		}
	}
	files, err := os.ReadDir(config)
	if err != nil || len(files) != 0 || h.conversations != nil {
		t.Fatal("read initialised private services or files", files, err)
	}
}

func TestConversationReceiptOwnSessionAndActualLinkMembership(t *testing.T) {
	h, m := receiptConversationFixture(t)
	aID, bID, cID := strings.Repeat("a", 32), strings.Repeat("b", 32), strings.Repeat("c", 32)
	a, call := receiptConversationSession(t, m, aID, "A-original")
	b, _ := receiptConversationSession(t, m, bID, "B-private")
	c, _ := receiptConversationSession(t, m, cID, "C-invited")
	p := conversationReceiptRequest{Action: "receipt", ID: aID, CallID: call, ReceiptGeneration: 2}
	r := receiptConversationRead(t, h, p)
	if r["input"] != "A-original" || r["receipt_generation"] != 2 || r["source"].(toolReceiptSource).SessionID != aID {
		t.Fatal(r)
	}
	if b.receiptHistory != nil || c.receiptHistory != nil {
		t.Fatal("read indexed another session")
	}
	p.MemberID = bID
	if _, err := h.conversationCall(context.Background(), rawJSON(p)); err == nil {
		t.Fatal("unrelated private session exposed")
	}
	if _, err := os.Stat(m.groupDir()); !os.IsNotExist(err) {
		t.Fatal("read created a Link room", err)
	}
	c.record.Link = &conversationLinkBinding{Scope: aID, Parent: aID}
	g := &conversationGroup{ID: linkLogID(aID), LinkScope: aID, Host: groupMember{Session: aID, Contact: groupHost}}
	if err := m.writeGroup(g); err != nil {
		t.Fatal(err)
	}
	p.MemberID = cID
	r = receiptConversationRead(t, h, p)
	if r["input"] != "C-invited" || r["source"].(toolReceiptSource).AgentID != cID {
		t.Fatal("actual member original lost", r)
	}
	g.LinkReleased = map[string]int{cID: 8}
	if err := m.writeGroup(g); err != nil {
		t.Fatal(err)
	}
	if _, err := h.conversationCall(context.Background(), rawJSON(p)); err == nil {
		t.Fatal("released member still readable")
	}
	for _, job := range []*agentJob{a, b, c} {
		if job.shell != nil || job.done != nil || job.cancel != nil || job.record.Generation != 8 || job.record.State != "idle" {
			t.Fatal("receipt restored execution")
		}
	}
	if len(m.jobs) != 3 || b.receiptHistory != nil {
		t.Fatal("receipt created jobs or scanned unrelated session")
	}
}

func TestConversationReceiptGroupUsesGroupIDAndRealMemberSession(t *testing.T) {
	h, m := receiptConversationFixture(t)
	aID, bID, cID := strings.Repeat("1", 32), strings.Repeat("2", 32), strings.Repeat("3", 32)
	a, call := receiptConversationSession(t, m, aID, "group-host")
	b, _ := receiptConversationSession(t, m, bID, "group-member")
	c, _ := receiptConversationSession(t, m, cID, "other-group-private")
	gID, other := strings.Repeat("4", 32), strings.Repeat("5", 32)
	a.record.Spec.GroupID, b.record.Spec.GroupID, c.record.Spec.GroupID = gID, gID, other
	g := &conversationGroup{ID: gID, Host: groupMember{Session: aID}, Members: []groupMember{{Contact: "member", Session: bID}}}
	if err := m.writeGroup(g); err != nil {
		t.Fatal(err)
	}
	p := conversationReceiptRequest{Action: "group_receipt", GroupID: gID, MemberID: bID, CallID: call, ReceiptGeneration: 2}
	r := receiptConversationRead(t, h, p)
	if r["input"] != "group-member" || r["source"].(toolReceiptSource).SessionID != bID {
		t.Fatal(r)
	}
	p.MemberID = cID
	if _, err := h.conversationCall(context.Background(), rawJSON(p)); err == nil {
		t.Fatal("other group member exposed")
	}
	p.MemberID = "member"
	if _, err := h.conversationCall(context.Background(), rawJSON(p)); err == nil {
		t.Fatal("contact key substituted for session identity")
	}
	p.MemberID, p.ID, p.GroupID = bID, gID, ""
	if _, err := h.conversationCall(context.Background(), rawJSON(p)); err == nil {
		t.Fatal("legacy id field accepted as group_id")
	}
	p.ID, p.GroupID = "", gID
	b.record.DeletionPending = true
	if _, err := h.conversationCall(context.Background(), rawJSON(p)); err == nil {
		t.Fatal("deleting group member exposed")
	}
	if a.receiptHistory != nil || c.receiptHistory != nil {
		t.Fatal("group receipt scanned foreign archives")
	}
}

func TestConversationReceiptLoadedArchiveKeepsOldGenerationWithoutRuntime(t *testing.T) {
	h, m := receiptConversationFixture(t)
	id := strings.Repeat("6", 32)
	job, call := receiptConversationSession(t, m, id, "durable-original")
	p := conversationReceiptRequest{Action: "receipt", ID: id, CallID: call, ReceiptGeneration: 2}
	first := receiptConversationRead(t, h, p)
	if err := os.MkdirAll(filepath.Join(m.dir, "sessions"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(m.dir, "sessions", id+".jsonl"), job.archive.memory, 0600); err != nil {
		t.Fatal(err)
	}
	loaded := &agentJob{record: copyRecord(job.record)}
	m2 := &AgentManager{owner: m.owner, config: m.config, dir: m.dir, jobs: map[string]*agentJob{id: loaded}}
	h2 := &WorkspaceHost{conversations: m2}
	p.ReceiptVersion = first["receipt_version"].(string)
	r := receiptConversationRead(t, h2, p)
	if r["input"] != "durable-original" || r["receipt_generation"] != 2 || r["receipt_version"] != p.ReceiptVersion {
		t.Fatal("reopen changed original identity", r)
	}
	p.ReceiptGeneration = 8
	if wrong := receiptConversationRead(t, h2, p); wrong["unavailable"] != true {
		t.Fatal("current generation substituted for archived one", wrong)
	}
	if loaded.archive != nil || loaded.shell != nil || loaded.done != nil || loaded.cancel != nil || loaded.record.Generation != 8 || loaded.record.State != "idle" {
		t.Fatal("archive read restored execution")
	}
}

func receiptWorkspaceFixture(t *testing.T) (*Workspace, string, string, string) {
	t.Helper()
	root, actor, session, archive := strings.Repeat("7", 32), strings.Repeat("8", 32), strings.Repeat("9", 32), strings.Repeat("a", 32)
	m := &AgentManager{owner: root, config: t.TempDir(), dir: t.TempDir(), jobs: map[string]*agentJob{}}
	m.jobs[actor] = &agentJob{record: AgentRecord{ID: actor, Parent: root, Generation: 9, Spec: AgentSpec{WorkspaceRole: WorkspaceMatrix}}}
	w := &Workspace{config: m.config, contextRoot: t.TempDir(), manager: m, epoch: "receipt-core-epoch", state: workspaceState{ID: root, Roles: map[string]string{WorkspaceMatrix: actor}}, contextBook: &eyraContextBook{Active: session, Sessions: []eyraContextSession{{ID: session, Archive: archive}}}}
	m.workspace = w
	return w, actor, session, archive
}

func TestWorkspaceReceiptScopesEpochViewAndOriginalGeneration(t *testing.T) {
	w, actor, session, archive := receiptWorkspaceFixture(t)
	original := strings.Repeat("b", 32)
	a := &SessionArchive{ephemeral: true}
	receiptMeta(t, a, original, 2)
	call := receiptIntent(t, a, "old-invocation", "old-call", "archived exact input")
	path := w.contextArchivePath(archive)
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, a.memory, 0600); err != nil {
		t.Fatal(err)
	}
	p := toolReceiptRequest{TaskID: w.state.ID, Agent: actor, ID: call, Generation: 9, CoreEpoch: w.epoch, ReceiptGeneration: 2, AllHistory: true}
	r, err := w.historyReceipt(rawJSON(p))
	if err != nil {
		t.Fatal(err)
	}
	body := r.(map[string]any)
	identity := body["source"].(toolReceiptSource)
	if body["input"] != "archived exact input" || identity.SessionID != session || identity.AgentID != original || identity.Generation != 2 {
		t.Fatal(body)
	}
	for _, modify := range []func(*toolReceiptRequest){
		func(p *toolReceiptRequest) { p.CoreEpoch = "old-core" },
		func(p *toolReceiptRequest) { p.Generation = 8 },
		func(p *toolReceiptRequest) { p.Agent = strings.Repeat("c", 32) },
		func(p *toolReceiptRequest) { p.TaskID = strings.Repeat("d", 32) },
	} {
		wrong := p
		modify(&wrong)
		if _, err := w.historyReceipt(rawJSON(wrong)); err == nil {
			t.Fatal("foreign or stale view accepted", wrong)
		}
	}
	view, err := w.receiptView(p)
	if err != nil {
		t.Fatal(err)
	}
	w.contextBook.Active = "different-session"
	if err = w.checkReceiptView(p, view); err == nil {
		t.Fatal("selected context changed during read")
	}
	if len(w.manager.jobs) != 1 || w.manager.jobs[actor].shell != nil || w.manager.jobs[actor].archive != nil {
		t.Fatal("history restored runtime")
	}
}

func TestWorkspaceReceiptMemberUsesOnlySelectedContextRoom(t *testing.T) {
	w, actor, session, _ := receiptWorkspaceFixture(t)
	_, service := receiptConversationFixture(t)
	memberID, foreignID := strings.Repeat("e", 32), strings.Repeat("f", 32)
	member, call := receiptConversationSession(t, service, memberID, "selected-room-original")
	foreign, _ := receiptConversationSession(t, service, foreignID, "foreign-room-original")
	member.record.Link = &conversationLinkBinding{Scope: session, Parent: session}
	foreign.record.Link = &conversationLinkBinding{Scope: strings.Repeat("0", 32), Parent: strings.Repeat("0", 32)}
	g := &conversationGroup{ID: linkLogID(session), LinkScope: session, Host: groupMember{Session: session}, WorkspaceLink: &workspaceLinkMailbox{Actor: actor, ActorGeneration: 9, Generation: 9}}
	if err := service.writeGroup(g); err != nil {
		t.Fatal(err)
	}
	w.manager.linkRootService.Store(service)
	p := toolReceiptRequest{TaskID: w.state.ID, Agent: actor, Generation: 9, CoreEpoch: w.epoch, MemberID: memberID, ID: call, ReceiptGeneration: 2}
	r, err := w.historyReceipt(rawJSON(p))
	if err != nil || r.(map[string]any)["input"] != "selected-room-original" {
		t.Fatal(r, err)
	}
	p.MemberID = foreignID
	if _, err = w.historyReceipt(rawJSON(p)); err == nil {
		t.Fatal("foreign context member exposed")
	}
	if foreign.receiptHistory != nil {
		t.Fatal("foreign member archive was indexed")
	}
	p.MemberID = memberID
	g.LinkReleased = map[string]int{memberID: 8}
	if err := service.writeGroup(g); err != nil {
		t.Fatal(err)
	}
	if _, err = w.historyReceipt(rawJSON(p)); err == nil {
		t.Fatal("released home member exposed")
	}
	if member.shell != nil || foreign.shell != nil || len(service.jobs) != 2 {
		t.Fatal("member read restored execution")
	}
}

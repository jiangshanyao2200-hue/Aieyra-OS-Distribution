// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestMotherDelegatesToCodingHostAndReceivesTheRealResult; TestCodingMemberLinkProjectsOnlyPublicBriefs; TestProgramResultReadMatchesOnlyCompletedMemberGeneration; TestCodingGatewayFailureBriefKeepsPrivateErrorOut
// Impact: python -B scripts/code-atlas.py show Core/program_coding_delegation_test.go
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

// The mother hands programming to Coding's managed group. The work runs in that group's Cota host
// session, never in a private session or an identity switch; the real result returns to the mother
// mailbox, and a repeated request does not run Cota twice.
func TestMotherDelegatesToCodingHostAndReceivesTheRealResult(t *testing.T) {
	useTestStage(t, ReleaseStage{Toolbox: true, TeamCollaboration: true})
	entered, release := make(chan struct{}), make(chan struct{})
	codingEntered, codingRelease := make(chan struct{}), make(chan struct{})
	var once, codingOnce sync.Once
	var codingCalls, motherCalls atomic.Int32
	m, dir := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		data := string(rawJSON(body))
		if strings.Contains(data, "CODING-TASK-ORDER") {
			codingCalls.Add(1)
			if strings.Contains(data, "MOTHER-PRIVATE-HISTORY") {
				t.Error("coding delegation leaked the mother's history")
			}
			close(codingEntered)
			select {
			case <-codingRelease:
			case <-r.Context().Done():
				return
			}
			fixtureAnswer(w, "coding", "简报：解析器已经改好。\nCODING-RESULT-RECEIPT", nil)
			return
		}
		if motherCalls.Add(1) == 1 {
			close(entered)
			select {
			case <-release:
			case <-r.Context().Done():
				return
			}
		} else if !strings.Contains(data, "CODING-RESULT-RECEIPT") {
			t.Error("mother did not receive the real coding result")
		}
		fixtureAnswer(w, "mother", "reviewed", nil)
	})
	s, err := Load(m.config)
	if err != nil {
		t.Fatal(err)
	}
	s.ExecutionProfile = "local-model"
	if err = s.Save(); err != nil {
		t.Fatal(err)
	}
	h, home := openCoreLinkHome(t, m.config, dir)
	t.Cleanup(func() { once.Do(func() { close(release) }) })
	t.Cleanup(func() { codingOnce.Do(func() { close(codingRelease) }) })
	if _, err = home.Send("start", "MOTHER-PRIVATE-HISTORY"); err != nil {
		t.Fatal(err)
	}
	select {
	case <-entered:
	case <-time.After(10 * time.Second):
		t.Fatal("mother did not start")
	}
	home.mu.Lock()
	actor, scope := home.state.Roles[WorkspaceMatrix], home.coreLinkScopeLocked()
	home.mu.Unlock()
	ctx := context.WithValue(context.Background(), conversationLinkCallerKey{}, conversationLinkCaller{ID: actor, Generation: 1})
	args := map[string]any{"action": "program_send", "program": "coding", "request_id": "coding-delegation", "reason": "实现需求", "message": "CODING-TASK-ORDER implement the parser.", "brief": "Cota，麻烦你完善解析器。"}
	if _, err = home.manager.Call(ctx, actor, rawJSON(args)); err != nil {
		t.Fatal(err)
	}
	opened, err := h.conversationCall(context.Background(), rawJSON(map[string]any{"action": "program", "program": "coding"}))
	if err != nil {
		t.Fatal(err)
	}
	host := opened.(map[string]any)["binding"].(map[string]any)["host_session_id"].(string)
	cm, _ := h.conversationManager()
	select {
	case <-codingEntered:
	case <-time.After(10 * time.Second):
		t.Fatal("coding did not start")
	}
	running, err := cm.Status(cm.owner, host)
	if err != nil || !activeAgent(running.State) {
		t.Fatal("coding not active before wait", running.State, err)
	}
	waitArgs := rawJSON(map[string]any{"action": "program_result", "program": "coding", "generation": running.Generation, "timeout_ms": 20})
	pending, err := home.manager.Call(ctx, actor, waitArgs)
	if err != nil || !activeAgent(pending.(map[string]any)["state"].(string)) || pending.(map[string]any)["result"] != "" {
		t.Fatal("program_result did not retain the active generation on timeout", pending, err)
	}
	if _, err = home.motherProgramCall(ctx, AgentRecord{}, "unrelated-mother", waitArgs); err == nil {
		t.Fatal("another scope could wait on the delegation")
	}
	codingOnce.Do(func() { close(codingRelease) })
	waitArgs = rawJSON(map[string]any{"action": "program_result", "program": "coding", "generation": running.Generation, "timeout_ms": 10000})
	result, err := home.manager.Call(ctx, actor, waitArgs)
	if err != nil || result.(map[string]any)["state"] != "completed" || !strings.Contains(string(rawJSON(result)), "CODING-RESULT-RECEIPT") {
		t.Fatal("program_result lost the Coding reply", result, err)
	}
	finished, err := cm.Wait(context.Background(), cm.owner, host, 10000)
	if err != nil || finished.State != "completed" || codingCalls.Load() != 1 {
		t.Fatal("coding execution", finished.State, finished.Error, err)
	}
	if finished.Spec.GroupID != codingScopeID() {
		t.Fatal("delegation ran outside the managed Coding group", finished.Spec.GroupID)
	}
	immediate := rawJSON(map[string]any{"action": "program_result", "program": "coding", "generation": finished.Generation})
	if _, err = home.motherProgramCall(ctx, AgentRecord{}, "unrelated-mother", immediate); err == nil {
		t.Fatal("another scope could read a completed program delegation")
	}
	if len(finished.TurnOrigins) != 1 {
		t.Fatal("delegation origin missing", finished.TurnOrigins)
	}
	for _, origin := range finished.TurnOrigins {
		if origin.From != scope || origin.Scope != scope || origin.Kind != "message" {
			t.Fatal(origin)
		}
	}
	if _, err = home.manager.Call(ctx, actor, rawJSON(args)); err != nil || codingCalls.Load() != 1 {
		t.Fatal("repeated delegation was not idempotent", err)
	}
	waitCoreLink(t, "coding result not committed to mother mailbox", func() bool {
		conversationGroupsMu.Lock()
		defer conversationGroupsMu.Unlock()
		g, e := cm.readGroup(linkLogID(scope))
		if e != nil {
			return false
		}
		msgs, e := cm.groupRange(g, 0, 100)
		if e != nil {
			return false
		}
		for _, msg := range msgs {
			if msg.Kind == "result" && msg.From == host && msg.Brief == "解析器已经改好。" && strings.Contains(msg.Text, "CODING-RESULT-RECEIPT") {
				return true
			}
		}
		return false
	})
	page, err := h.conversationCall(context.Background(), rawJSON(map[string]any{"action": "chat_page", "id": codingScopeID(), "kind": "group"}))
	if err != nil {
		t.Fatal(err)
	}
	entries := page.(map[string]any)["entries"].([]map[string]any)
	if len(entries) != 2 || entries[0]["kind"] != "brief" || entries[0]["sender_id"] != "eyra" || entries[0]["text"] != "Cota，麻烦你完善解析器。" || entries[1]["kind"] != "brief" || entries[1]["sender_id"] != groupHost || entries[1]["text"] != "解析器已经改好。" {
		t.Fatal("Coding chat must contain only the two public briefs", entries)
	}
	result, err = home.manager.Call(ctx, actor, immediate)
	if err != nil || !strings.Contains(string(rawJSON(result)), "CODING-RESULT-RECEIPT") {
		t.Fatal("program_result lost the Coding reply", result, err)
	}
	once.Do(func() { close(release) })
	waitCoreLink(t, "coding result not consumed by mother", func() bool { return motherCalls.Load() >= 2 })
}

func TestCodingMemberLinkProjectsOnlyPublicBriefs(t *testing.T) {
	m, _ := matrixTestManager(t, nil)
	g := &conversationGroup{
		ID: codingScopeID(), Name: "Coding", ManagedProgram: "coding",
		Host:    groupMember{Contact: groupHost, Session: "cota-session"},
		Members: []groupMember{{Contact: "vaya", Session: "vaya-session"}},
	}
	if err := m.writeGroup(g); err != nil {
		t.Fatal(err)
	}
	room := &conversationGroup{LinkScope: g.ID}
	assignment := groupMessage{From: g.Host.Session, To: "vaya-session", Kind: "message", Request: "assign", SenderGeneration: 4, Text: "PRIVATE TASK", Brief: "请核对文件。"}
	result := groupMessage{From: "vaya-session", To: g.Host.Session, Kind: "result", Request: "result", SenderGeneration: 2, Text: "PRIVATE REVIEW", Brief: "PRIVATE REVIEW"}
	outbound := groupMessage{From: g.Host.Session, To: "other-session", Kind: "message", Request: "external", SenderGeneration: 4, Text: "OTHER PRIVATE TASK", Brief: "External"}
	conversationGroupsMu.Lock()
	defer conversationGroupsMu.Unlock()
	for _, msg := range []groupMessage{assignment, result, result, outbound} {
		if err := m.recordCodingLinkBrief(room, msg, 9); err != nil {
			t.Fatal(err)
		}
	}
	messages, err := m.groupRange(g, 0, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(messages) != 2 {
		t.Fatal("expected one record per managed-member handoff", messages)
	}
	if got := messages[0]; got.From != groupHost || got.SenderGeneration != 4 || got.Kind != "brief" || got.Brief != "请核对文件。" || got.Text != "" {
		t.Fatal("assignment did not preserve public identity", got)
	}
	if got := messages[1]; got.From != "vaya" || got.SenderGeneration != 2 || got.Kind != "brief" || got.Brief != "已回报这项工作的结果。" || got.Text != "" {
		t.Fatal("result exposed private text or lost its sender", got)
	}
}

func TestProgramResultReadMatchesOnlyCompletedMemberGeneration(t *testing.T) {
	msg := workspaceMessage{From: "cota", To: WorkspaceMatrix, CoreLink: &conversationLinkOrigin{Kind: "result", Generation: 7}}
	for _, call := range []ToolCall{
		{ID: "read", Function: FunctionCall{Name: "agents", Arguments: `{"action":"program_result"}`}},
		{ID: "read", Function: FunctionCall{Name: "core_link", Arguments: `{"action":"program_result"}`}},
		{ID: "read", Function: FunctionCall{Name: "toolbox", Arguments: `{"action":"call","name":"agents","arguments":{"action":"program_result"}}`}},
	} {
		history := []Message{
			{Role: RoleAssistant, ToolCalls: []ToolCall{call}},
			{Role: RoleTool, ToolCallID: "read", Content: `{"ok":true,"data":{"id":"cota","generation":7,"state":"running"}}`},
		}
		if programResultRead(history, msg) {
			t.Fatal("an in-progress read retired the future result", call.Function.Name)
		}
		history[1].Content = `{"ok":true,"data":{"id":"cota","generation":7,"state":"completed"}}`
		if !programResultRead(history, msg) {
			t.Fatal("the completed result was not recognized", call.Function.Name)
		}
		other := msg
		other.CoreLink = &conversationLinkOrigin{Kind: "result", Generation: 8}
		if programResultRead(history, other) {
			t.Fatal("a different generation was treated as read", call.Function.Name)
		}
		repair := msg
		repair.Repair = &motherRepairEvent{}
		if programResultRead(history, repair) {
			t.Fatal("the result read retired a failure recovery event", call.Function.Name)
		}
	}
}

func TestCodingGatewayFailureBriefKeepsPrivateErrorOut(t *testing.T) {
	record := AgentRecord{State: "failed", Error: "private upstream data"}
	record.Failure = classifyAgentFailure(&APIError{StatusCode: 504, Message: record.Error}, "")
	if brief := codingResultBrief(record); brief != "上游网关等待超时，这次编程任务未完成。" {
		t.Fatal(brief)
	}
	if record.Failure.Code != "provider_unavailable" || !record.Failure.Retryable {
		t.Fatal(record.Failure)
	}
}

// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestBuiltinCotaReportDefaultAndExplicitRestriction; TestConversationReportsKeepSessionOwnershipAndCloseRevision
// Impact: python -B scripts/code-atlas.py show Core/conversation_reports_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"net/http"
	"slices"
	"strings"
	"testing"
)

func TestBuiltinCotaReportDefaultAndExplicitRestriction(t *testing.T) {
	m, _ := matrixTestManager(t, func(http.ResponseWriter, *http.Request) { t.Error("unexpected model call") })
	h := NewWorkspaceHost(m.config, "", "")
	defer h.Close()
	cm, err := h.conversationManager()
	if err != nil {
		t.Fatal(err)
	}
	c, _, err := cm.liveContact(builtinContactID("cota"))
	if err != nil {
		t.Fatal(err)
	}
	selected := cm.builtinTools(c)
	if !slices.Contains(selected, "report") {
		t.Fatal("Cota lacks report default", selected)
	}
	defs := conversationToolDefinitions(context.Background(), Defaults(), selected)
	count := 0
	for _, d := range defs {
		if d.Name == "report" {
			count++
		}
	}
	if count != 1 {
		t.Fatal("report schema missing or duplicated", count)
	}
	s, err := Load(m.config)
	if err != nil {
		t.Fatal(err)
	}
	s.ExecutionTools = []string{"terminal"}
	if err = s.Save(); err != nil {
		t.Fatal(err)
	}
	selected = cm.builtinTools(c)
	if slices.Contains(selected, "report") {
		t.Fatal("explicit tool restriction overwritten", selected)
	}
	if toolAllowed(WithToolPermissions(context.Background(), selected), "report") {
		t.Fatal("restricted report remained callable")
	}
}

func TestConversationReportsKeepSessionOwnershipAndCloseRevision(t *testing.T) {
	h, m := receiptConversationFixture(t)
	a, b := strings.Repeat("a", 32), strings.Repeat("b", 32)
	receiptConversationSession(t, m, a, "first")
	receiptConversationSession(t, m, b, "second")
	w, err := m.conversationReportScope(a)
	if err != nil {
		t.Fatal(err)
	}
	result, err := w.report(rawJSON(map[string]any{"title": "Report", "format": "md", "content": "original content"}))
	if err != nil {
		t.Fatal(err)
	}
	doc := result.(map[string]any)["document"].(WorkspaceDocument)
	call := func(id, action string, revision int) (any, error) {
		return h.conversationCall(context.Background(), rawJSON(map[string]any{"action": action, "id": id, "document_id": doc.ID, "operation": "close", "expected_revision": revision}))
	}
	if _, err = call(b, "document_read", 0); err == nil {
		t.Fatal("foreign document was readable")
	}
	if _, err = call(a, "document_state", 0); err != nil {
		t.Fatal(err)
	}
	if _, err = call(a, "document_state", 0); err == nil {
		t.Fatal("stale close revision was accepted")
	}
	read, err := call(a, "document_read", 0)
	if err != nil || read.(map[string]any)["content"] != "original content" {
		t.Fatal("closing changed original", read, err)
	}
	docs, err := m.conversationReports(a)
	if err != nil || len(docs) != 1 || !docs[0].Dismissed {
		t.Fatal("close state was not durable", docs, err)
	}
}

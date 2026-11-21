// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestSendReceiptIsReadOnlyAndRetainsExactContentAcrossContextsAndReopen; TestSendReceiptMatchesRetiredContentHashWithoutRevivingWork; TestCodingContactsRejectNewStandaloneSessionsAndKeepExistingRecords
// Impact: python -B scripts/code-atlas.py show Core/workspace_send_receipt_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"net/http"
	"os"
	"strings"
	"testing"
)

func TestSendReceiptIsReadOnlyAndRetainsExactContentAcrossContextsAndReopen(t *testing.T) {
	m, dir := matrixTestManager(t, func(http.ResponseWriter, *http.Request) { t.Error("receipt query reached model") })
	w := modeWorkspace(t, m.config, dir, HostOS)
	a := composerAsset(t, w.config, "receipt.txt", []byte("owned receipt attachment"))
	attachments := []ComposerAttachment{a}
	if _, err := w.enqueueAttachments("user", WorkspaceMatrix, "original-request", "original\r\n原文", "context", "", attachments); err != nil {
		t.Fatal(err)
	}
	check := func(w *Workspace, text string, files []ComposerAttachment, accepted bool) {
		t.Helper()
		value, err := w.sendReceipt(rawJSON(map[string]any{"request_id": "original-request", "message": text, "attachments": files}))
		if err != nil {
			t.Fatal(err)
		}
		row := value.(map[string]any)
		if row["accepted"] != accepted || row["request_id"] != "original-request" {
			t.Fatal(row)
		}
	}
	check(w, "original\r\n原文", attachments, true)
	check(w, "changed", attachments, false)
	check(w, "original\r\n原文", nil, false)
	if err := os.Remove(a.Asset); err != nil {
		t.Fatal(err)
	}
	check(w, "original\r\n原文", attachments, true)
	w.mu.Lock()
	w.state.Messages[len(w.state.Messages)-1].State = "completed"
	w.mu.Unlock()
	contextTestAction(t, w, "new", map[string]any{"title": "another conversation"})
	check(w, "original\r\n原文", attachments, true)
	w.Close()
	reopened := modeWorkspace(t, m.config, dir, HostOS)
	check(reopened, "original\r\n原文", attachments, true)
	if _, err := reopened.sendReceipt(rawJSON(map[string]any{"request_id": "", "message": "body"})); err == nil {
		t.Fatal("invalid identity accepted")
	}
	if _, err := reopened.sendReceipt(rawJSON(map[string]any{"request_id": "valid", "message": strings.Repeat("x", 65537)})); err == nil {
		t.Fatal("oversized input accepted")
	}
}

func TestSendReceiptMatchesRetiredContentHashWithoutRevivingWork(t *testing.T) {
	w := &Workspace{retiredMessages: map[string]workspaceRetiredMessage{"retired": {Message: workspaceMessage{ID: "retired", From: "user", To: WorkspaceMatrix}, TextHash: attachmentMessageHash("original", nil)}}}
	for _, test := range []struct {
		id, text string
		accepted bool
	}{{"retired", "original", true}, {"retired", "changed", false}, {"unknown", "original", false}} {
		value, err := w.sendReceipt(rawJSON(map[string]any{"request_id": test.id, "message": test.text}))
		if err != nil || value.(map[string]any)["accepted"] != test.accepted {
			t.Fatal(value, err)
		}
	}
	if len(w.state.Messages) != 0 {
		t.Fatal("query revived a message")
	}
}

func TestCodingContactsRejectNewStandaloneSessionsAndKeepExistingRecords(t *testing.T) {
	m, _ := matrixTestManager(t, func(http.ResponseWriter, *http.Request) { t.Error("contact operation reached model") })
	h := NewWorkspaceHost(m.config, "", "")
	defer h.Close()
	cm, err := h.conversationManager()
	if err != nil {
		t.Fatal(err)
	}
	for _, role := range []string{"cota", "vaya"} {
		c, _, err := cm.liveContact(builtinContactID(role))
		if err != nil {
			t.Fatal(err)
		}
		old, err := cm.newBuiltinSession(context.Background(), c, "previous-"+role)
		if err != nil {
			t.Fatal(err)
		}
		payload := rawJSON(map[string]any{"action": "session_create", "contact_id": c.ID, "request_id": "new-" + role})
		fresh, err := h.conversationCall(context.Background(), payload)
		if err != nil {
			t.Fatal(err)
		}
		id := fresh.(map[string]any)["id"].(string)
		record, err := cm.Status(cm.owner, id)
		if err != nil || id == old["id"] || record.Spec.GroupID != "" {
			t.Fatal("new private session must be independent", err)
		}
		repeat, err := h.conversationCall(context.Background(), payload)
		if err != nil || repeat.(map[string]any)["id"] != id {
			t.Fatal("creation receipt changed", err)
		}
		_, err = h.conversationCall(context.Background(), rawJSON(map[string]any{"action": "status", "id": old["id"]}))
		if err != nil {
			t.Fatal("previous record lost", err)
		}
	}
}

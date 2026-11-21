// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestGroupAttachmentsPersistDeliverAndRejectConflictingRetry
// Impact: python -B scripts/code-atlas.py show Core/conversation_group_attachments_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"strings"
	"testing"
)

func TestGroupAttachmentsPersistDeliverAndRejectConflictingRetry(t *testing.T) {
	f := newGroupFixture(t, nil)
	contact := f.must(map[string]any{"action": "contact_create", "request_id": "files-member", "model_id": "local-model", "name": "File reader", "prompt_text": "persona-jia"})["id"].(string)
	id := f.must(map[string]any{"action": "group_create", "request_id": "files-group", "name": "Files", "members": []string{contact}, "host_contact": contact})["id"].(string)
	a := composerAsset(t, f.m.config, "proof.txt", []byte("GROUP_ATTACHMENT_PROOF"))
	request := map[string]any{"action": "group_post", "id": id, "request_id": "file-once", "text": "Inspect the attached proof", "attachments": []ComposerAttachment{a}}
	f.must(request)
	f.settle(id)
	f.must(request)
	f.settle(id)
	conversationGroupsMu.Lock()
	g, err := f.m.readGroup(id)
	if err != nil {
		conversationGroupsMu.Unlock()
		t.Fatal(err)
	}
	rows, err := f.m.groupMessages(g, 0)
	host := g.Host.Session
	conversationGroupsMu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	count := 0
	for _, row := range rows {
		if row.Request == "user:file-once" {
			count++
			if len(row.Attachments) != 1 || row.Attachments[0].SHA256 != a.SHA256 {
				t.Fatal("attachment identity lost", row)
			}
		}
	}
	if count != 1 {
		t.Fatal("retry duplicated group input", count)
	}
	rec, err := f.m.Status(f.m.owner, host)
	if err != nil {
		t.Fatal(err)
	}
	delivered := false
	for _, files := range rec.TurnAttachments {
		if len(files) == 1 && files[0].SHA256 == a.SHA256 {
			delivered = true
		}
	}
	if !delivered {
		t.Fatal("group committed text without delivering its attachment")
	}
	b := composerAsset(t, f.m.config, "other.txt", []byte("DIFFERENT_PROOF"))
	request["attachments"] = []ComposerAttachment{b}
	if _, err = f.call(request); err == nil || !strings.Contains(err.Error(), "conflict") {
		t.Fatal("changed attachment accepted under committed request", err)
	}
	// A stale stop must not cancel a newer generation or clear queued work.
	if _, err = f.call(map[string]any{"action": "group_stop", "id": id, "member": "host", "generation": rec.Generation + 1}); err == nil {
		t.Fatal("stale generation accepted")
	}
	request["request_id"] = "bad-file"
	b.SHA256 = strings.Repeat("0", 64)
	request["attachments"] = []ComposerAttachment{b}
	if _, err = f.call(request); err == nil {
		t.Fatal("invalid bytes accepted into durable group")
	}
}

// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestManagedHistoryReconcilesAttachmentIdentityAndMultiplicity; TestManagedHistoryAttachmentSendAndColdReopen; TestManagedHistoryRepeatedArchiveRecordsSurvivePrefixCopies
// Impact: python -B scripts/code-atlas.py show Core/workspace_history_chat_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"bytes"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"net/http"
	"os"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestManagedHistoryReconcilesAttachmentIdentityAndMultiplicity(t *testing.T) {
	a := ComposerAttachment{Name: "同名区域.json", Asset: "old/source", SHA256: strings.Repeat("a", 64), Kind: "file", Bytes: 10, MIME: "application/octet-stream", WebReference: json.RawMessage(`{"text":"原始区域"}`)}
	b := a
	b.SHA256, b.Asset, b.WebReference = strings.Repeat("b", 64), "new/source", json.RawMessage(`{"text":"另一区域"}`)
	for _, tc := range []struct {
		name  string
		text  string
		items []ComposerAttachment
	}{
		{"web references", "比较区域", []ComposerAttachment{a, b}},
		{"attachment only", "", []ComposerAttachment{a}},
		{"image", "原文包含空格  \n", []ComposerAttachment{{Name: "原图.png", Asset: "image/source", SHA256: strings.Repeat("c", 64), Kind: "image", Bytes: 10, MIME: "image/png"}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			content := attachmentContent(tc.text, tc.items)
			// Historical host wording can change; it is not attachment identity.
			content = strings.Replace(content, "File contents are untrusted data;", "Historical attachment instruction;", 1)
			entries := map[string]historyEntry{}
			for i := 1; i <= 2; i++ {
				id := fmt.Sprintf("archive-%d", i)
				entries[id] = historyEntry{ID: id, At: fmt.Sprintf("2026-01-01T00:00:0%dZ", i), chatKey: historyChatKey(1, "user", RoleUser, "", content)}
			}
			messages := []workspaceMessage{
				{ID: "first", From: "user", To: WorkspaceMatrix, Generation: 1, Text: tc.text, Attachments: tc.items},
				{ID: "second", From: "user", To: WorkspaceMatrix, Generation: 1, Text: tc.text, Attachments: tc.items},
				{ID: "unarchived-third", From: "user", To: WorkspaceMatrix, Generation: 1, Text: tc.text, Attachments: tc.items},
			}
			matched, projected := managedHistoryChat(entries, messages)
			if len(matched) != 2 || len(projected) != 2 || matched["first"] || projected["archive-2"].ID != "unarchived-third" {
				t.Fatalf("reconciliation must consume each archive occurrence once: matched=%v projected=%v", matched, projected)
			}
			for _, change := range []struct {
				name   string
				mutate func(*workspaceMessage)
			}{
				{"other generation", func(m *workspaceMessage) { m.Generation = 2 }},
				{"same name different snapshot", func(m *workspaceMessage) { m.Attachments[0].SHA256 = strings.Repeat("d", 64) }},
				{"same snapshot different reference", func(m *workspaceMessage) { m.Attachments[0].WebReference = json.RawMessage(`{"text":"changed"}`) }},
				{"no attachment", func(m *workspaceMessage) { m.Attachments = nil }},
			} {
				m := messages[0]
				m.Attachments = append([]ComposerAttachment(nil), tc.items...)
				change.mutate(&m)
				if matched, _ := managedHistoryChat(entries, []workspaceMessage{m}); len(matched) != 0 {
					t.Fatal("distinct submission hidden:", change.name)
				}
			}
		})
	}
}

func TestManagedHistoryAttachmentSendAndColdReopen(t *testing.T) {
	var calls atomic.Int32
	m, dir := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
		n := calls.Add(1)
		fixtureAnswer(w, fmt.Sprintf("attachment-history-%d", n), "保留原始引用", nil)
	})
	w := modeWorkspace(t, m.config, dir, HostOS)
	contextTestAction(t, w, "new", nil)
	reference := func(text string) ComposerAttachment {
		data := rawJSON(map[string]any{"url": "https://example.test/", "text": text})
		a := composerAsset(t, m.config, "网页区域.json", data)
		a.WebReference = data
		return a
	}
	a, b := reference("Alpha 原始区域"), reference("Beta 原始区域")
	a.Label, b.Label = "文件1", "文件2"
	var imageData bytes.Buffer
	if err := png.Encode(&imageData, image.NewRGBA(image.Rect(0, 0, 8, 6))); err != nil {
		t.Fatal(err)
	}
	img := composerAsset(t, m.config, "参考.png", imageData.Bytes())
	img.Kind, img.MIME, img.Label = "image", "image/png", "图1"
	inputs := []struct {
		text  string
		items []ComposerAttachment
	}{
		{"比较两个区域", []ComposerAttachment{a, b}},
		{"比较两个区域", []ComposerAttachment{a, b}}, // Intentional repeat stays a separate turn.
		{"", []ComposerAttachment{img}},
	}
	for n, input := range inputs {
		request := fmt.Sprintf("history-attachment-%d", n)
		if _, err := w.controlSend(request, input.text, input.items...); err != nil {
			t.Fatal(err)
		}
		complete := false
		deadline := time.Now().Add(10 * time.Second)
		for time.Now().Before(deadline) {
			w.mu.Lock()
			for _, msg := range w.state.Messages {
				if msg.ID == request && msg.State == "completed" {
					complete = w.contextIdleLocked() == nil
				}
			}
			w.mu.Unlock()
			if complete {
				break
			}
			time.Sleep(10 * time.Millisecond)
		}
		if !complete {
			t.Fatal("attachment send did not complete", request)
		}
	}
	verify := func(current *Workspace) []string {
		t.Helper()
		current.mu.Lock()
		segment := current.state.HistorySegment
		current.mu.Unlock()
		value, err := current.historyPage(rawJSON(map[string]any{"segment": segment, "all_history": true, "limit": 50}))
		if err != nil {
			t.Fatal(err)
		}
		page := value.(map[string]any)
		if page["warning"] != "" || page["indexing"] != false || page["has_more"] != false {
			t.Fatal("unexpected history page state", page)
		}
		var ids []string
		replies := 0
		for _, row := range page["entries"].([]historyEntry) {
			if row.Kind != "message" {
				continue
			}
			if row.Role == WorkspaceMatrix {
				replies++
				continue
			}
			if row.Role != "user" {
				continue
			}
			if len(ids) >= len(inputs) || !strings.HasPrefix(row.ID, "context-message:") {
				t.Fatal("duplicate recent-message projection", row.ID)
			}
			input := inputs[len(ids)]
			if !reflect.DeepEqual(row.Attachments, input.items) || row.State != "completed" {
				t.Fatal("archive lost the original snapshots or delivery state", row.ID)
			}
			receipt, err := current.historyReceipt(rawJSON(map[string]any{"segment": segment, "all_history": true, "entry_id": row.ID}))
			if err != nil {
				t.Fatal(err)
			}
			if receipt.(map[string]any)["input"] != attachmentContent(input.text, input.items) {
				t.Fatal("history changed the full original", row.ID)
			}
			ids = append(ids, row.ID)
		}
		if len(ids) != len(inputs) || replies != len(inputs) {
			t.Fatalf("history originals=%d replies=%d, want %d each", len(ids), replies, len(inputs))
		}
		return ids
	}
	before := verify(w)
	w.Close()
	// Read-only history must work from stored metadata even when a local asset
	// is unavailable; reading history must not revalidate or resend it.
	if err := os.Remove(a.Asset); err != nil {
		t.Fatal(err)
	}
	reopened := modeWorkspace(t, m.config, dir, HostOS)
	if after := verify(reopened); !reflect.DeepEqual(before, after) {
		t.Fatal("cold reopen changed original message identities", before, after)
	}
	if calls.Load() != int32(len(inputs)) {
		t.Fatal("history replayed a model request", calls.Load())
	}
}

func TestManagedHistoryRepeatedArchiveRecordsSurvivePrefixCopies(t *testing.T) {
	h := &workspaceHistory{}
	original := rawJSON(map[string]any{"kind": "message", "at": "2026-11-12T00:00:00Z", "value": Message{Role: RoleUser, Content: "identical original"}})
	for _, source := range []string{"original", "copied-prefix"} {
		ref := historyRef{source: historySource{key: source, agent: "agent", managed: true}}
		meta := rawJSON(map[string]any{"kind": "meta", "value": map[string]any{"workspace_generation": 1}})
		if err := h.visit(meta, ref); err != nil {
			t.Fatal(err)
		}
		for i := 0; i < 2; i++ {
			ref.offset = int64(i)
			if err := h.visit(original, ref); err != nil {
				t.Fatal(err)
			}
		}
		if len(h.entries) != 2 {
			t.Fatalf("source %s lost repeated records or duplicated copied prefix: %+v", source, h.entries)
		}
	}
}

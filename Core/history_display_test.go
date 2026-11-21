// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestHistoryRestoresImageReferencesFromSavedUserRows; TestHistoryDisplayProjectsHostWrappers; TestHistoryRecognizesLegacyAttachmentObservation
// Impact: python -B scripts/code-atlas.py show Core/history_display_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"reflect"
	"strings"
	"testing"
)

func TestHistoryRestoresImageReferencesFromSavedUserRows(t *testing.T) {
	image := ComposerAttachment{Name: "参考图.png", Asset: "C:/owned/runtime/attachments/reference.png", SHA256: strings.Repeat("a", 64), Bytes: 200, Kind: "image", MIME: "image/png"}
	content := attachmentContent("请编辑这张图", []ComposerAttachment{image}) + "\n[附图 1 张]"
	rows := projectMemoryRows([]memoryHistoryRow{{Session: "old/matrix", Role: RoleUser, Content: content, At: 1}})
	if len(rows) != 1 || len(rows[0].Attachments) != 1 || !reflect.DeepEqual(rows[0].Attachments[0], image) || strings.Contains(rows[0].Text, "\"asset\"") {
		t.Fatalf("history image reference was lost or leaked into prose: %+v", rows)
	}
	assistant := projectMemoryRows([]memoryHistoryRow{{Session: "old/matrix", Role: RoleAssistant, Content: content}})
	if len(assistant[0].Attachments) != 0 {
		t.Fatal("assistant prose was treated as user attachments")
	}
	bad := strings.Replace(content, strings.Repeat("a", 64), "invalid", 1)
	if len(historyImageAttachments(bad)) != 0 || len(historyImageAttachments(content[:len(content)-2])) != 0 {
		t.Fatal("incomplete snapshot metadata was made previewable")
	}
}

func TestHistoryDisplayProjectsHostWrappers(t *testing.T) {
	att := attachmentContent("看看这两个", []ComposerAttachment{{Name: "a.csv", Asset: "x", SHA256: "00", Bytes: 1, Kind: "file"}, {Name: "图.png", Kind: "image"}})
	if got, ok := historyUserDisplay(att); !ok || got != "看看这两个\n附件：a.csv、图.png" {
		t.Fatalf("attachment display: %q %v", got, ok)
	}
	for _, text := range []string{"普通的话", "[User attachments: 不是宿主格式]", "x\n\n[User attachments: immutable local snapshots.]\nnot json"} {
		if got, ok := historyUserDisplay(text); ok || got != text {
			t.Fatalf("user text must stay unchanged: %q => %q", text, got)
		}
	}
	if got := historySupplementText(RoleAssistant, "", "我先记下这两行。\n→ 调用 apply_patch：{\"patch\":\"x\"}"); got != "我先记下这两行。" {
		t.Fatalf("assistant tool lines: %q", got)
	}
	if got := historySupplementText(RoleUser, "", att); got != "看看这两个\n附件：a.csv、图.png" {
		t.Fatalf("memory attachment row: %q", got)
	}
	m := workspaceMessage{ID: "changes_1", From: WorkspaceMatrix, To: WorkspaceProject, Reference: true, State: "context", Text: `{"state":"ok","files":[{"path":"a.txt"},{"path":"b.txt","new_path":"c.txt"}],"instruction":"Eyra recorded these file changes."}`}
	if got, ok := changesDisplay(m); !ok || got != "Eyra 记录了文件变更：a.txt、b.txt → c.txt" {
		t.Fatalf("changes display: %q %v", got, ok)
	}
	m.ID = "other"
	if _, ok := changesDisplay(m); ok {
		t.Fatal("only change notes are projected")
	}
}

func TestHistoryRecognizesLegacyAttachmentObservation(t *testing.T) {
	items := []ComposerAttachment{{Name: "original.json", Kind: "file", SHA256: strings.Repeat("a", 64)}}
	original := attachmentContent("original body", items)
	legacy := original + "\r\nUse view_image with an image asset path if you need to inspect it; no visual observation has happened yet."
	if historyChatKey(1, "user", RoleUser, "", legacy) != historyChatKey(1, "user", RoleUser, "", "original body", items...) {
		t.Fatal("legacy host note broke original attachment identity")
	}
	if _, _, ok := historyAttachmentManifest(legacy + " user-authored suffix"); ok {
		t.Fatal("unrecognized original suffix must not be hidden")
	}
}

// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestWorkspaceSendOriginalHashMatchesReceiptAfterRedactionAndReopen; TestSendReceiptRetiredRedactedOriginalUsesPreservedHash
// Impact: python -B scripts/code-atlas.py show Core/workspace_send_original_hash_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"bytes"
	"context"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestWorkspaceSendOriginalHashMatchesReceiptAfterRedactionAndReopen(t *testing.T) {
	w, dir := testWorkspace(t, func(http.ResponseWriter, *http.Request) { t.Error("receipt check reached model") })
	w.cancel()
	<-w.done // Exercise the public queue without dispatching this fixture's input.
	original := "  原文\r\nfake-key-only\n"
	redacted := w.manager.redact(original)
	if redacted == original {
		t.Fatal("fixture did not redact its synthetic credential")
	}
	args := rawJSON(map[string]any{"request_id": "legacy-send-original", "message": original})
	value, err := w.Call(context.Background(), "workspace.send", args)
	if err != nil {
		t.Fatal(err)
	}
	message := value.(workspaceMessage)
	if message.MessageHash != attachmentMessageHash(original, nil) || message.Text != redacted {
		t.Fatal("legacy send lost original identity or retained unredacted text")
	}
	check := func(w *Workspace, state string) {
		t.Helper()
		before := rawJSON(w.state)
		for _, test := range []struct {
			text     string
			accepted bool
		}{{original, true}, {redacted, false}, {strings.ReplaceAll(original, "\r\n", "\n"), false}} {
			value, err := w.Call(context.Background(), "workspace.send_receipt", rawJSON(map[string]any{"request_id": message.ID, "message": test.text}))
			if err != nil || value.(map[string]any)["accepted"] != test.accepted {
				t.Fatal("receipt did not preserve exact original bytes", err)
			}
		}
		if !bytes.Equal(before, rawJSON(w.state)) {
			t.Fatal("receipt query changed the accepted request")
		}
		for _, action := range []string{"workspace.send", "matrix.send", "workspace.task_send"} {
			if _, err := w.Call(context.Background(), action, args); err != nil {
				t.Fatal("identical retry lost its receipt", action, err)
			}
		}
		if _, err := w.Call(context.Background(), "workspace.send", rawJSON(map[string]any{"request_id": message.ID, "message": redacted})); err == nil {
			t.Fatal("different original with the same redacted body reused the request")
		}
		if len(w.state.Messages) != 1 || w.state.Messages[0].State != state || w.state.Messages[0].MessageHash != message.MessageHash || len(w.manager.List(w.state.ID)) != 0 {
			t.Fatal("receipt or retry duplicated or revived work")
		}
		data, err := os.ReadFile(filepath.Join(w.dir, "workspace.json"))
		if err != nil {
			t.Fatal(err)
		}
		events, _, _ := w.feed.read(0)
		if bytes.Contains(data, []byte("fake-key-only")) || bytes.Contains(rawJSON(events), []byte("fake-key-only")) {
			t.Fatal("original credential escaped into queue state or events")
		}
	}
	check(w, "queued")
	w.Close()
	reopened, err := NewWorkspace(w.config, w.state.ID, dir, "", nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(reopened.Close)
	reopened.cancel()
	<-reopened.done
	check(reopened, "interrupted")
}

func TestSendReceiptRetiredRedactedOriginalUsesPreservedHash(t *testing.T) {
	for _, withAttachment := range []bool{false, true} {
		name := "text"
		var attachments []ComposerAttachment
		if withAttachment {
			name = "attachment"
			attachments = []ComposerAttachment{{Name: "receipt.txt", SHA256: strings.Repeat("a", 64), Bytes: 4, Kind: "file"}}
		}
		t.Run(name, func(t *testing.T) {
			original, redacted := "  原文\r\nsynthetic-secret\n", "  原文\r\n[redacted]\n"
			w := &Workspace{host: &WorkspaceHost{mode: HostOS}, state: workspaceState{Messages: chatFixture(workspaceChatTurns + 1)}}
			w.state.Messages[0].Text = redacted
			w.state.Messages[0].Attachments = attachments
			w.state.Messages[0].MessageHash = attachmentMessageHash(original, attachments)
			w.retainChatLocked()
			old := w.retiredMessages["u1"]
			if old.Message.Text != "" || len(old.Message.Attachments) != 0 || old.Message.MessageHash == old.TextHash {
				t.Fatal("fixture did not retire a redacted original")
			}
			before, retired := rawJSON(w.state), rawJSON(w.retiredMessages)
			for _, test := range []struct {
				text     string
				files    []ComposerAttachment
				accepted bool
			}{{original, attachments, true}, {redacted, attachments, false}, {original + "changed", attachments, false}} {
				value, err := w.sendReceipt(rawJSON(map[string]any{"request_id": "u1", "message": test.text, "attachments": test.files}))
				if err != nil || value.(map[string]any)["accepted"] != test.accepted {
					t.Fatal("retired receipt confused original and redacted identity", err)
				}
			}
			if withAttachment {
				value, err := w.sendReceipt(rawJSON(map[string]any{"request_id": "u1", "message": original}))
				if err != nil || value.(map[string]any)["accepted"] != false {
					t.Fatal("retired receipt ignored its attachment identity", err)
				}
			}
			if !bytes.Equal(before, rawJSON(w.state)) || !bytes.Equal(retired, rawJSON(w.retiredMessages)) {
				t.Fatal("retired receipt query changed or revived work")
			}
		})
	}
}

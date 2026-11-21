// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestWorkspaceControlOriginalMessageHashSurvivesRecovery; TestWorkspaceControlHumanCancellationAndExpiryFinalizeOnce; TestWorkspaceControlReconcileRequiresFinishedMatchingGeneration; TestWorkspaceControlHashKeepsRedactedMessagesDistinct; TestLinkNoticeQueuesWithOriginAndStaysIdempotent
// Impact: python -B scripts/code-atlas.py show Core/workspace_control_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"
)

func TestWorkspaceControlOriginalMessageHashSurvivesRecovery(t *testing.T) {
	w, dir := testWorkspace(t, func(http.ResponseWriter, *http.Request) { t.Error("receipt check must not call model") })
	w.mu.Lock()
	w.greeting.State = "connecting"
	w.mu.Unlock()
	text := "  新验收消息\n保留精确 UTF-8 字节。\n"
	want := fmt.Sprintf("%x", sha256.Sum256([]byte(text)))
	first, err := w.controlSend("control-hash", text)
	if err != nil || first.MessageHash != want {
		t.Fatal("original hash missing", err)
	}
	status, err := w.controlStatus(first.ID)
	if err != nil || status.(map[string]any)["message_hash"] != want || status.(map[string]any)["state"] != "running" || status.(map[string]any)["phase"] != "queued" {
		t.Fatal("queued Control receipt invalid", status, err)
	}
	if _, err = w.controlSend(first.ID, text); err != nil || len(w.state.Messages) != 1 {
		t.Fatal("identical request duplicated", err)
	}
	if _, err = w.controlSend(first.ID, text+"changed"); err == nil {
		t.Fatal("conflicting original message accepted")
	}
	w.Close()
	restored, err := NewWorkspace(w.config, w.state.ID, dir, "", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer restored.Close()
	status, err = restored.controlStatus(first.ID)
	if err != nil || status.(map[string]any)["message_hash"] != want || status.(map[string]any)["state"] != "interrupted" {
		t.Fatal("recovered receipt changed identity or replayed", status, err)
	}
	if _, err = restored.controlSend(first.ID, text); err != nil || len(restored.state.Messages) != 1 {
		t.Fatal("recovered duplicate changed receipt", err)
	}
}

func TestWorkspaceControlHumanCancellationAndExpiryFinalizeOnce(t *testing.T) {
	for _, mode := range []string{"control_cancel", "agent_cancel", "expiry"} {
		t.Run(mode, func(t *testing.T) {
			var requests atomic.Int32
			w, _ := testWorkspace(t, func(res http.ResponseWriter, req *http.Request) {
				switch n := int(requests.Add(1)); n {
				case 1:
					humanToolAnswer(res, n, "open", nil)
				case 2:
					humanToolAnswer(res, n, "call", humanTestQuestion())
				default:
					t.Error("cancelled or expired human task called the model again")
					fixtureAnswer(res, "unexpected", "unexpected inference", nil)
				}
			})
			message, err := w.controlSend("human-control", "Ask for report format")
			if err != nil {
				t.Fatal(err)
			}
			var record AgentRecord
			deadline := time.Now().Add(10 * time.Second)
			for time.Now().Before(deadline) {
				for _, candidate := range w.manager.List(w.state.ID) {
					record = candidate
				}
				if record.State == "waiting_user" {
					break
				}
				time.Sleep(10 * time.Millisecond)
			}
			if record.State != "waiting_user" || len(record.HumanRequests) != 1 {
				t.Fatalf("human pause missing: %+v", record)
			}
			if _, err = w.manager.Wait(context.Background(), w.state.ID, record.ID, 1000); err != nil {
				t.Fatal(err)
			}
			before, err := w.controlStatus(message.ID)
			if err != nil || before.(map[string]any)["state"] != "running" {
				t.Fatal("pending question prematurely finalized", before, err)
			}
			want := "cancelled"
			switch mode {
			case "control_cancel":
				_, err = w.controlCancel(message.ID)
			case "agent_cancel":
				err = w.manager.CancelGeneration(w.state.ID, record.ID, record.Generation)
			case "expiry":
				w.manager.mu.Lock()
				w.manager.jobs[record.ID].record.HumanRequests[0].ExpiresAt = time.Now().Add(-time.Second).UTC().Format(time.RFC3339Nano)
				w.manager.mu.Unlock()
				want = "timed_out"
			}
			if err != nil {
				t.Fatal(err)
			}
			for i := 0; i < 3; i++ {
				status, e := w.controlStatus(message.ID)
				if e != nil || status.(map[string]any)["state"] != want {
					t.Fatal("terminal human task retained running receipt", status, e)
				}
			}
			w.mu.Lock()
			outputs := 0
			for _, out := range w.state.Messages {
				if out.From == WorkspaceMatrix && out.State == want && out.Generation == record.Generation {
					outputs++
				}
			}
			w.mu.Unlock()
			if outputs != 1 {
				t.Fatalf("terminal output count: %d", outputs)
			}
			p := humanTestReply(record)
			p.SessionID = w.state.ID
			if _, err = w.manager.ReplyHuman(w.state.ID, p); err == nil || requests.Load() != 2 {
				t.Fatal("late answer replayed inference", err, requests.Load())
			}
			w.Close()
			data, err := os.ReadFile(filepath.Join(w.dir, "workspace.json"))
			var saved workspaceState
			if err != nil || json.Unmarshal(data, &saved) != nil || saved.Messages[0].State != want {
				t.Fatal("terminal receipt was not durable", err)
			}
		})
	}
}

func TestWorkspaceControlReconcileRequiresFinishedMatchingGeneration(t *testing.T) {
	w, _ := testWorkspace(t, func(http.ResponseWriter, *http.Request) { t.Error("receipt query called model") })
	w.mu.Lock()
	w.state.Roles[WorkspaceMatrix] = "receipt-only"
	w.state.Messages = []workspaceMessage{
		{ID: "old", From: "user", To: WorkspaceMatrix, State: "delivered", Generation: 1},
		{ID: "current", From: "user", To: WorkspaceMatrix, State: "delivered", Generation: 2},
	}
	w.manager.mu.Lock()
	done := make(chan struct{})
	w.manager.jobs["receipt-only"] = &agentJob{done: done, record: AgentRecord{ID: "receipt-only", Parent: w.state.ID, State: "cancelled", Generation: 2}}
	w.manager.mu.Unlock()
	w.mu.Unlock()
	status, err := w.controlStatus("current")
	if err != nil || status.(map[string]any)["state"] != "running" {
		t.Fatal("in-flight final callback was bypassed", status, err)
	}
	close(done)
	status, err = w.controlStatus("current")
	if err != nil || status.(map[string]any)["state"] != "cancelled" {
		t.Fatal(status, err)
	}
	status, err = w.controlStatus("old")
	if err != nil || status.(map[string]any)["state"] != "running" {
		t.Fatal("new generation overwrote old receipt", status, err)
	}
}

func TestWorkspaceControlHashKeepsRedactedMessagesDistinct(t *testing.T) {
	w, _ := testWorkspace(t, func(http.ResponseWriter, *http.Request) { t.Error("receipt check must not call model") })
	w.mu.Lock()
	w.greeting.State = "connecting"
	w.mu.Unlock()
	one := fmt.Sprintf("%x", sha256.Sum256([]byte("first original secret")))
	two := fmt.Sprintf("%x", sha256.Sum256([]byte("different original secret")))
	if _, err := w.enqueueStateWithHash("user", WorkspaceMatrix, "redacted", "[redacted]", "queued", one); err != nil {
		t.Fatal(err)
	}
	if _, err := w.enqueueStateWithHash("user", WorkspaceMatrix, "redacted", "[redacted]", "queued", two); err == nil {
		t.Fatal("different original messages with identical redaction reused one request")
	}
	if got := workspaceMessageHash(workspaceMessage{Text: "legacy"}); got != fmt.Sprintf("%x", sha256.Sum256([]byte("legacy"))) {
		t.Fatal("legacy receipt omitted safe text hash")
	}
}

func TestLinkNoticeQueuesWithOriginAndStaysIdempotent(t *testing.T) {
	w, _ := testWorkspace(t, func(http.ResponseWriter, *http.Request) { t.Error("queueing must not call model") })
	w.mu.Lock()
	w.greeting.State = "connecting"
	if w.host == nil {
		w.host = &WorkspaceHost{}
	}
	w.host.mode = HostOS
	w.mu.Unlock()
	if _, err := w.linkNotice("other-1", "x", "Link"); err == nil {
		t.Fatal("notice id without the link prefix must be refused")
	}
	if _, err := w.linkNotice("link-a", "x", " "); err == nil {
		t.Fatal("notice without a display line must be refused")
	}
	first, err := w.linkNotice("link-a", "[Link office notice] read inbox", "Link · 同事 找你")
	if err != nil || first.Origin != "link" || first.From != "user" || first.To != WorkspaceMatrix || first.DisplayText != "Link · 同事 找你" || first.State != "queued" {
		t.Fatal("notice not queued for Eyra", first, err)
	}
	if _, err = w.linkNotice("link-a", "[Link office notice] read inbox", "Link · 同事 找你"); err != nil || len(w.state.Messages) != 1 {
		t.Fatal("the same notice must not queue twice", err, len(w.state.Messages))
	}
}

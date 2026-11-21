// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: composerRPC; TestComposerHTTPRejectionAndAcceptedReplay; TestComposerRejectionNeverMasksOwnerOrGenerationErrors; TestComposerNotAdmittedHTTPReceiptAndAcceptedReplay; TestComposerNotAdmittedDisabledRoleStillReplaysAcceptedInput; TestComposerNotAdmittedNeverLabelsOtherErrorsAsRejected
// Impact: python -B scripts/code-atlas.py show Core/workspace_send_recovery_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func composerRPC(t *testing.T, c *MatrixControl, action string, args any) (int, map[string]any) {
	t.Helper()
	req, err := http.NewRequest("POST", c.address+"/v1/rpc", bytes.NewReader(rawJSON(map[string]any{"action": action, "arguments": args})))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Content-Type", "application/json")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var body map[string]any
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	return res.StatusCode, body
}

func TestComposerHTTPRejectionAndAcceptedReplay(t *testing.T) {
	for _, kind := range []string{"primary", "child", "split"} {
		t.Run(kind, func(t *testing.T) {
			w := collaborationFixture(t, func(rw http.ResponseWriter, req *http.Request) {
				fixtureAnswer(rw, "recovery-answer", "received", nil)
			}, func(_ context.Context, child *Workspace, action string) (workspaceMembership, error) {
				return confirmedStation(child, action), nil
			})
			c, err := NewMatrixControl(w.manager)
			if err != nil {
				t.Fatal(err)
			}
			defer c.Close()
			target, taskID, generation := w, w.state.ID, 1
			var child AgentRecord
			if kind == "child" {
				child, err = w.manager.Create(context.Background(), w.state.ID, AgentSpec{RequestID: "child-start", Task: "start", ModelID: "local-model", Workdir: w.state.Workdir})
				if err != nil {
					t.Fatal(err)
				}
				child, err = w.manager.Wait(context.Background(), w.state.ID, child.ID, 6000)
				if err != nil || child.State != "completed" {
					t.Fatal(child.State, err)
				}
				taskID, generation = child.ID, child.Generation
			} else if kind == "split" {
				target = createTestSplit(t, w, "split-start", "start")
				r := waitSplitRecord(t, target)
				taskID, generation = target.state.ID, r.Generation
			}
			a := composerAsset(t, w.config, "receipt.txt", []byte("immutable recovery evidence"))
			bad := a
			bad.Bytes++
			args := map[string]any{"task_id": taskID, "request_id": "rejected", "generation": generation, "message": "keep\r\n\tbody", "attachments": []ComposerAttachment{bad}}
			code, body := composerRPC(t, c, "workspace.task_send", args)
			receipt, ok := body["send_rejection"].(map[string]any)
			if code != 400 || !ok || receipt["code"] != "attachment_rejected" || receipt["task_id"] != taskID || receipt["request_id"] != "rejected" {
				t.Fatal("missing precise pre-acceptance receipt", code, body)
			}
			if kind == "child" {
				r, err := w.manager.Status(w.state.ID, taskID)
				if err != nil || r.Generation != child.Generation || len(r.Turns) != len(child.Turns) {
					t.Fatal("rejection changed child turn", err)
				}
				if _, exists := r.Turns["rejected"]; exists {
					t.Fatal("rejected turn persisted")
				}
			} else {
				target.mu.Lock()
				for _, message := range target.state.Messages {
					if message.ID == "rejected" {
						t.Error("rejected message persisted")
					}
				}
				target.mu.Unlock()
			}
			args["request_id"], args["attachments"] = "accepted", []ComposerAttachment{a}
			if code, body = composerRPC(t, c, "workspace.task_send", args); code != 200 {
				t.Fatal("valid request refused", code, body)
			}
			var accepted AgentRecord
			deadline := time.Now().Add(8 * time.Second)
			for time.Now().Before(deadline) {
				if kind == "child" {
					accepted, err = w.manager.Wait(context.Background(), w.state.ID, taskID, 6000)
					if err != nil {
						t.Fatal(err)
					}
				} else {
					accepted = waitSplitRecord(t, target)
				}
				if _, exists := accepted.Turns["accepted"]; exists && accepted.State == "completed" {
					break
				}
				time.Sleep(10 * time.Millisecond)
			}
			if _, exists := accepted.Turns["accepted"]; !exists || accepted.State != "completed" {
				t.Fatal("accepted message did not complete", accepted.State)
			}
			if err := os.Remove(a.Asset); err != nil {
				t.Fatal(err)
			}
			// The original generation is now stale, and the snapshot is gone.
			// Receipt identity must win over both checks on a retry.
			if code, body = composerRPC(t, c, "workspace.task_send", args); code != 200 {
				t.Fatal("accepted retry revalidated snapshot", code, body)
			}
			var after AgentRecord
			if kind == "child" {
				after, err = w.manager.Status(w.state.ID, taskID)
			} else {
				after = waitSplitRecord(t, target)
			}
			if err != nil || after.Generation != accepted.Generation || len(after.Turns) != len(accepted.Turns) {
				t.Fatal("accepted retry created a new turn", err)
			}
			args["message"] = "changed accepted request"
			if code, body = composerRPC(t, c, "workspace.task_send", args); code != 400 || body["send_rejection"] != nil {
				t.Fatal("conflict incorrectly permits revision", code, body)
			}
			args["request_id"], args["generation"] = "unaccepted", 0
			if kind == "child" {
				if code, body = composerRPC(t, c, "workspace.task_send", args); code != 400 || body["send_rejection"] != nil {
					t.Fatal("generation failure incorrectly permits revision", code, body)
				}
			}
			args["task_id"] = "unknown-task"
			if code, body = composerRPC(t, c, "workspace.task_send", args); code != 400 || body["send_rejection"] != nil {
				t.Fatal("ownership failure incorrectly permits revision", code, body)
			}
			if code, body = composerRPC(t, c, "workspace.task_status", map[string]any{"task_id": taskID, "request_id": "not-found"}); code != 400 || body["send_rejection"] != nil {
				t.Fatal("status failure incorrectly permits revision", code, body)
			}
		})
	}
}

func TestComposerRejectionNeverMasksOwnerOrGenerationErrors(t *testing.T) {
	m, dir := matrixTestManager(t, func(rw http.ResponseWriter, req *http.Request) { fixtureAnswer(rw, "done", "done", nil) })
	r, err := m.Create(context.Background(), testMatrixOwner, AgentSpec{RequestID: "start", Task: "start", ModelID: "local-model", Workdir: dir})
	if err != nil {
		t.Fatal(err)
	}
	r, err = m.Wait(context.Background(), testMatrixOwner, r.ID, 6000)
	if err != nil {
		t.Fatal(err)
	}
	a := composerAsset(t, m.config, "corrupted.txt", []byte("original"))
	if err := os.WriteFile(a.Asset, []byte("corrupt!"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, row := range []struct {
		owner      string
		generation int
	}{{"foreign", r.Generation}, {testMatrixOwner, r.Generation + 1}} {
		_, err := m.sendGenerationAttachments(row.owner, r.ID, "new", "body", attachmentMessageHash("body", []ComposerAttachment{a}), row.generation, []ComposerAttachment{a})
		var rejected *composerSendRejection
		if err == nil || errors.As(err, &rejected) {
			t.Fatal("ownership/generation failure mislabeled", err)
		}
	}
}

func TestComposerNotAdmittedHTTPReceiptAndAcceptedReplay(t *testing.T) {
	for _, tc := range []struct {
		name    string
		prepare func(*testing.T, *Workspace)
	}{
		{"model", func(_ *testing.T, w *Workspace) { w.state.Models[WorkspaceMatrix] = "missing-model" }},
		{"message limit", func(_ *testing.T, w *Workspace) {
			for len(w.state.Messages) < 10000 {
				w.state.Messages = append(w.state.Messages, workspaceMessage{ID: fmt.Sprintf("previous:%d", len(w.state.Messages)), From: "user", To: WorkspaceMatrix, Text: "previous", State: "queued"})
			}
		}},
		{"context initialization", func(t *testing.T, w *Workspace) {
			w.contextRoot = filepath.Join(t.TempDir(), "blocked-context")
			if err := os.WriteFile(w.contextRoot, []byte("keep original"), 0600); err != nil {
				t.Fatal(err)
			}
			w.coreLinkRegistered.Store(true)
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			w, _ := testWorkspace(t, func(http.ResponseWriter, *http.Request) { t.Error("rejection or replay reached a model") })
			w.cancel()
			<-w.done // Keep accepted input queued without dispatching the fixture.
			if _, err := w.controlSend("accepted-before-rejection", "original"); err != nil {
				t.Fatal(err)
			}
			tc.prepare(t, w)
			before := rawJSON(w.state.Messages)
			c, err := NewMatrixControl(w.manager)
			if err != nil {
				t.Fatal(err)
			}
			defer c.Close()
			for _, action := range []string{"workspace.task_send", "workspace.send", "matrix.send"} {
				request := "new:" + action
				args := map[string]any{"task_id": w.state.ID, "request_id": request, "message": "keep\r\noriginal"}
				code, body := composerRPC(t, c, action, args)
				receipt, ok := body["send_rejection"].(map[string]any)
				if code != 400 || !ok || receipt["code"] != "not_admitted" || receipt["task_id"] != w.state.ID || receipt["request_id"] != request {
					t.Fatal("fresh unaccepted input lost its precise rejection", code, body)
				}
				args["request_id"], args["message"] = "accepted-before-rejection", "original"
				if code, body = composerRPC(t, c, action, args); code != 200 {
					t.Fatal("accepted replay repeated admission", code, body)
				}
			}
			if !bytes.Equal(before, rawJSON(w.state.Messages)) || len(w.manager.List(w.state.ID)) != 0 {
				t.Fatal("rejection or replay altered the queue or dispatched work")
			}
		})
	}
}

func TestComposerNotAdmittedDisabledRoleStillReplaysAcceptedInput(t *testing.T) {
	m, dir := matrixTestManager(t, func(http.ResponseWriter, *http.Request) { t.Error("disabled role reached a model") })
	w := modeWorkspace(t, m.config, dir, HostOS)
	w.cancel()
	<-w.done
	if _, err := w.controlSend("accepted-role", "original"); err != nil {
		t.Fatal(err)
	}
	changeOfficialPackage(t, w.manager, "disable", "aieyra.eyra", "disable-composer-role")
	c, err := NewMatrixControl(w.manager)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	args := map[string]any{"task_id": w.state.ID, "request_id": "new-role", "message": "original"}
	code, body := composerRPC(t, c, "workspace.task_send", args)
	receipt, ok := body["send_rejection"].(map[string]any)
	if code != 400 || !ok || receipt["code"] != "not_admitted" || receipt["task_id"] != w.state.ID || receipt["request_id"] != "new-role" {
		t.Fatal("disabled role lost its unaccepted input receipt", code, body)
	}
	args["request_id"] = "accepted-role"
	if code, body = composerRPC(t, c, "workspace.task_send", args); code != 200 || len(w.state.Messages) != 1 {
		t.Fatal("accepted replay was blocked or duplicated by disabled role", code, body)
	}
}

func TestComposerNotAdmittedNeverLabelsOtherErrorsAsRejected(t *testing.T) {
	for _, kind := range []string{"closed", "conflict", "invalid id", "save failure"} {
		t.Run(kind, func(t *testing.T) {
			w, _ := testWorkspace(t, func(http.ResponseWriter, *http.Request) { t.Error("failed input reached a model") })
			w.cancel()
			<-w.done
			if _, err := w.controlSend("existing", "original"); err != nil {
				t.Fatal(err)
			}
			before := rawJSON(w.state.Messages)
			args := map[string]any{"task_id": w.state.ID, "request_id": "new", "message": "new input"}
			switch kind {
			case "closed":
				w.closed = true
			case "conflict":
				args["request_id"] = "existing"
			case "invalid id":
				args["request_id"] = ""
			case "save failure":
				file := filepath.Join(w.dir, "workspace.json")
				if err := os.Remove(file); err != nil {
					t.Fatal(err)
				}
				if err := os.Mkdir(file, 0700); err != nil {
					t.Fatal(err)
				}
			}
			c, err := NewMatrixControl(w.manager)
			if err != nil {
				t.Fatal(err)
			}
			defer c.Close()
			code, body := composerRPC(t, c, "workspace.task_send", args)
			if code != 400 || body["send_rejection"] != nil || !bytes.Equal(before, rawJSON(w.state.Messages)) {
				t.Fatal("non-admission boundary invented rejection or changed input", code, body)
			}
		})
	}
}

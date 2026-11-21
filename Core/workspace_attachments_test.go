// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: composerAsset; TestComposerSnapshotValidationAndImageCapabilities; TestComposerPrimaryChildAndSplitLoopback; TestComposerRequestIdentitySurvivesRetirementAndMissingSnapshot; TestComposerAgentCreateAndContinuationIdentity; TestComposerSteeringDrainValidatesBeforeAcknowledging; TestComposerUserImageWireOnceAndCorruptionNotice; TestBrowserReferenceIsBoundToImmutableSnapshot
// Impact: python -B scripts/code-atlas.py show Core/workspace_attachments_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func composerAsset(t *testing.T, config, name string, data []byte) ComposerAttachment {
	t.Helper()
	hash := fmt.Sprintf("%x", sha256.Sum256(data))
	asset := filepath.Join(filepath.Dir(config), "runtime", "attachments", hash)
	if err := os.MkdirAll(filepath.Dir(asset), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(asset, data, 0600); err != nil {
		t.Fatal(err)
	}
	return ComposerAttachment{Name: name, Asset: asset, SHA256: hash, Bytes: len(data), Kind: "file", MIME: "application/octet-stream"}
}

func TestComposerSnapshotValidationAndImageCapabilities(t *testing.T) {
	config := filepath.Join(t.TempDir(), "config.json")
	a := composerAsset(t, config, "sample.txt", []byte("immutable source"))
	if images, err := prepareComposerAttachments(config, []ComposerAttachment{a}, Defaults()); err != nil || len(images) != 0 {
		t.Fatal(images, err)
	}
	for _, change := range []func(*ComposerAttachment){
		func(a *ComposerAttachment) { a.Asset = filepath.Join(t.TempDir(), a.SHA256) },
		func(a *ComposerAttachment) { a.SHA256 = strings.ToUpper(a.SHA256) },
		func(a *ComposerAttachment) { a.Name = "../sample.txt" },
		func(a *ComposerAttachment) { a.Bytes++ },
		func(a *ComposerAttachment) { a.MIME = "text/html" },
	} {
		bad := a
		change(&bad)
		if _, err := prepareComposerAttachments(config, []ComposerAttachment{bad}, Defaults()); err == nil {
			t.Fatal("invalid snapshot accepted", bad)
		}
	}
	if err := os.WriteFile(a.Asset, bytes.Repeat([]byte("x"), a.Bytes), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := prepareComposerAttachments(config, []ComposerAttachment{a}, Defaults()); err == nil {
		t.Fatal("same-length corruption accepted")
	}
	var data bytes.Buffer
	if err := png.Encode(&data, image.NewRGBA(image.Rect(0, 0, 32, 24))); err != nil {
		t.Fatal(err)
	}
	a = composerAsset(t, config, "sample.png", data.Bytes())
	if _, err := prepareComposerAttachments(config, []ComposerAttachment{a}, Defaults()); err == nil {
		t.Fatal("image disguised as file")
	}
	a.Kind, a.MIME = "image", "image/png"
	images, err := prepareComposerAttachments(config, []ComposerAttachment{a}, goImageSettings("mimo-v2.6-flash"))
	if err != nil || len(images) != 1 || images[0].Width != 32 || images[0].Height != 24 {
		t.Fatal(images, err)
	}
	unsupported := goImageSettings("unverified")
	if images, err := prepareComposerAttachments(config, []ComposerAttachment{a}, unsupported); err != nil || len(images) != 0 {
		t.Fatal("unverified image channel must carry references without visual input", images, err)
	}
}

func TestComposerPrimaryChildAndSplitLoopback(t *testing.T) {
	var mu sync.Mutex
	var wires []string
	w := collaborationFixture(t, func(rw http.ResponseWriter, req *http.Request) {
		var body any
		if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		mu.Lock()
		wires = append(wires, string(rawJSON(body)))
		mu.Unlock()
		fixtureAnswer(rw, "attachment-answer", "received", nil)
	}, func(_ context.Context, child *Workspace, action string) (workspaceMembership, error) {
		return confirmedStation(child, action), nil
	})
	a := composerAsset(t, w.config, "attachment-proof.txt", []byte("file contents remain local"))
	args := func(id, request string, generation int) json.RawMessage {
		return rawJSON(map[string]any{"task_id": id, "request_id": request, "message": "", "generation": generation, "attachments": []ComposerAttachment{a}})
	}
	if _, err := w.Call(context.Background(), "workspace.task_send", args(w.state.ID, "primary-attachment", 1)); err != nil {
		t.Fatal(err)
	}
	if r := waitSplitRecord(t, w); r.State != "completed" {
		t.Fatal(r.State, r.Error)
	}
	child, err := w.manager.Create(context.Background(), w.state.ID, AgentSpec{RequestID: "child-first", Task: "child start", ModelID: "local-model", Workdir: w.state.Workdir})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = w.manager.Wait(context.Background(), w.state.ID, child.ID, 6000); err != nil {
		t.Fatal(err)
	}
	if _, err = w.Call(context.Background(), "workspace.task_send", args(child.ID, "child-attachment", child.Generation)); err != nil {
		t.Fatal(err)
	}
	child, err = w.manager.Wait(context.Background(), w.state.ID, child.ID, 6000)
	if err != nil || child.State != "completed" || len(child.TurnAttachments["child-attachment"]) != 1 {
		t.Fatal(child.State, err)
	}
	snapshot, err := w.taskSnapshot(child.ID, WorkspaceCursor{})
	if err != nil || !strings.Contains(string(rawJSON(snapshot)), a.Name) {
		t.Fatal("child snapshot lost attachment", err)
	}
	split := createTestSplit(t, w, "split-first", "independent split start")
	r := waitSplitRecord(t, split)
	if r.State != "completed" {
		t.Fatal(r.State, r.Error)
	}
	if _, err = w.Call(context.Background(), "workspace.task_send", args(split.state.ID, "split-attachment", r.Generation)); err != nil {
		t.Fatal(err)
	}
	// The same primary agent is continued asynchronously by the workspace pump.
	for i := 0; i < 100; i++ {
		r = waitSplitRecord(t, split)
		if _, ok := r.Turns["split-attachment"]; ok {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if r.State != "completed" || len(r.TurnAttachments["split-attachment"]) != 1 {
		t.Fatal("split attachment not delivered", r.State)
	}
	mu.Lock()
	defer mu.Unlock()
	count := 0
	for _, wire := range wires {
		var request struct {
			Input []struct {
				Role    string `json:"role"`
				Content any    `json:"content"`
			} `json:"input"`
		}
		if err := json.Unmarshal([]byte(wire), &request); err != nil {
			t.Fatal(err)
		}
		for _, input := range request.Input {
			content, ok := input.Content.(string)
			// Memory maintenance may quote a prior manifest inside its source.
			// Count only the actual top-level attachment-only user submissions.
			if !ok || input.Role != "user" || !strings.HasPrefix(strings.TrimSpace(content), "[User attachments:") {
				continue
			}
			count++
			if strings.Count(content, a.SHA256) != 2 || strings.Count(content, a.Name) != 1 || strings.Contains(content, "file contents remain local") {
				t.Fatal("file manifest or snapshot boundary violated")
			}
		}
	}
	if count != 3 {
		t.Fatal("primary/child/split manifest count", count)
	}
}

func TestComposerRequestIdentitySurvivesRetirementAndMissingSnapshot(t *testing.T) {
	m, dir := matrixTestManager(t, func(http.ResponseWriter, *http.Request) { t.Error("receipt replay reached model") })
	w := modeWorkspace(t, m.config, dir, HostOS)
	a := composerAsset(t, w.config, "private.txt", []byte("private file"))
	attachments := []ComposerAttachment{a}
	if _, err := w.enqueueAttachments("user", WorkspaceMatrix, "live", "body", "context", "", attachments); err != nil {
		t.Fatal(err)
	}
	if _, err := w.Send("live", "body"); err == nil {
		t.Fatal("text API removed accepted attachments")
	}
	changed := a
	changed.Name = "renamed.txt"
	if _, err := w.enqueueAttachments("user", WorkspaceMatrix, "live", "body", "context", "", []ComposerAttachment{changed}); err == nil {
		t.Fatal("request accepted changed attachment")
	}
	w.mu.Lock()
	w.state.Messages = chatFixture(51)
	w.state.Messages[0].Attachments = attachments
	w.retainChatLocked()
	retired := w.retiredMessages["u1"]
	w.mu.Unlock()
	if retired.Message.Text != "" || len(retired.Message.Attachments) != 0 {
		t.Fatal("retired receipt retained private data")
	}
	if err := os.Remove(a.Asset); err != nil {
		t.Fatal(err)
	}
	if got, err := w.enqueueAttachments("user", WorkspaceMatrix, "u1", "private u1", "queued", "", attachments); err != nil || got.State != "completed" {
		t.Fatal("accepted retired retry lost receipt", got, err)
	}
	if _, err := w.Send("u1", "private u1"); err == nil {
		t.Fatal("retired id ignored attachment identity")
	}
}

func TestComposerAgentCreateAndContinuationIdentity(t *testing.T) {
	m, dir := matrixTestManager(t, func(rw http.ResponseWriter, req *http.Request) { fixtureAnswer(rw, "done", "done", nil) })
	a := composerAsset(t, m.config, "start.txt", []byte("initial asset"))
	spec := AgentSpec{RequestID: "create", Task: "first", ModelID: "local-model", Workdir: dir, Attachments: []ComposerAttachment{a}}
	r, err := m.Create(context.Background(), testMatrixOwner, spec)
	if err != nil {
		t.Fatal(err)
	}
	r, err = m.Wait(context.Background(), testMatrixOwner, r.ID, 6000)
	if err != nil || r.State != "completed" {
		t.Fatal(r.State, err)
	}
	if err = os.Remove(a.Asset); err != nil {
		t.Fatal(err)
	}
	if retry, err := m.Create(context.Background(), testMatrixOwner, spec); err != nil || retry.ID != r.ID {
		t.Fatal("accepted create revalidated missing asset", err)
	}
	if _, err = m.Send(testMatrixOwner, r.ID, "create", "first"); err == nil {
		t.Fatal("plain send removed original attachment")
	}
	a = composerAsset(t, m.config, "continue.txt", []byte("continuation asset"))
	attachments := []ComposerAttachment{a}
	hash := attachmentMessageHash("", attachments)
	if _, err = m.sendGenerationAttachments("not-owner", r.ID, "next", "", hash, r.Generation, attachments); err == nil {
		t.Fatal("cross-owner send accepted")
	}
	if _, err = m.sendGenerationAttachments(testMatrixOwner, r.ID, "next", "", hash, r.Generation+1, attachments); err == nil {
		t.Fatal("stale generation accepted")
	}
	r, err = m.Send(testMatrixOwner, r.ID, "plain", "plain legacy turn")
	if err != nil {
		t.Fatal(err)
	}
	r, err = m.Wait(context.Background(), testMatrixOwner, r.ID, 6000)
	if err != nil {
		t.Fatal(err)
	}
	m.mu.Lock()
	delete(m.jobs[r.ID].record.TurnHashes, "plain")
	m.mu.Unlock()
	if _, err = m.sendGenerationAttachments(testMatrixOwner, r.ID, "plain", "plain legacy turn", attachmentMessageHash("plain legacy turn", attachments), r.Generation, attachments); err == nil {
		t.Fatal("legacy id accepted new attachment")
	}
	r, err = m.sendGenerationAttachments(testMatrixOwner, r.ID, "next", "", hash, r.Generation, attachments)
	if err != nil {
		t.Fatal(err)
	}
	r, err = m.Wait(context.Background(), testMatrixOwner, r.ID, 6000)
	if err != nil || r.State != "completed" {
		t.Fatal(r.State, err)
	}
	if err = os.Remove(a.Asset); err != nil {
		t.Fatal(err)
	}
	if _, err = m.sendGenerationAttachments(testMatrixOwner, r.ID, "next", "", hash, r.Generation-1, attachments); err != nil {
		t.Fatal("accepted continuation retry lost receipt", err)
	}
}

func TestComposerSteeringDrainValidatesBeforeAcknowledging(t *testing.T) {
	w, _ := testWorkspace(t, func(http.ResponseWriter, *http.Request) { t.Error("context-only message reached model") })
	a := composerAsset(t, w.config, "steering.txt", []byte("steering"))
	if _, err := w.enqueueAttachments("user", WorkspaceMatrix, "steering", "extra context", "context", "", []ComposerAttachment{a}); err != nil {
		t.Fatal(err)
	}
	archive := &SessionArchive{ephemeral: true}
	if err := os.WriteFile(a.Asset, []byte("modified"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := w.drain(WorkspaceMatrix, archive, nil); err == nil {
		t.Fatal("corrupt steering accepted")
	}
	w.mu.Lock()
	state := w.state.Messages[0].State
	w.mu.Unlock()
	if state != "context" {
		t.Fatal("failed attachment acknowledged", state)
	}
	if err := os.WriteFile(a.Asset, []byte("steering"), 0600); err != nil {
		t.Fatal(err)
	}
	added, err := w.drain(WorkspaceMatrix, archive, nil)
	if err != nil || len(added) != 1 || !strings.Contains(added[0].Content, a.SHA256) {
		t.Fatal(added, err)
	}
	again, err := w.drain(WorkspaceMatrix, archive, added)
	if err != nil || len(again) != 0 {
		t.Fatal("steering replayed", again, err)
	}
}

func TestComposerUserImageWireOnceAndCorruptionNotice(t *testing.T) {
	config := filepath.Join(t.TempDir(), "config.json")
	var data bytes.Buffer
	if err := png.Encode(&data, image.NewRGBA(image.Rect(0, 0, 8, 6))); err != nil {
		t.Fatal(err)
	}
	a := composerAsset(t, config, "user.png", data.Bytes())
	a.Kind, a.MIME = "image", "image/png"
	images, err := prepareComposerAttachments(config, []ComposerAttachment{a}, Defaults())
	if err != nil {
		t.Fatal(err)
	}
	msgs := []Message{{Role: RoleUser, Content: "UNIQUE_USER_BODY", Images: images}}
	wire := func(chat bool, unsupported bool) []byte {
		s := Defaults()
		if chat {
			s = goImageSettings("mimo-v2.6-flash")
		}
		if unsupported {
			s.Model = "unverified"
			s.Adapter = "openai"
			s.BaseURL = "https://invalid.example/v1"
		}
		var v any = BuildResponsesRequest(s, msgs, false, nil)
		if chat {
			v = BuildRequest(s, msgs, false)
		}
		b, e := json.Marshal(v)
		if e != nil {
			t.Fatal(e)
		}
		return b
	}
	for _, chat := range []bool{false, true} {
		b := wire(chat, false)
		if bytes.Count(b, []byte("UNIQUE_USER_BODY")) != 1 || bytes.Count(b, []byte("data:image/png;base64,")) != 1 {
			t.Fatal("user content duplicated or image omitted", string(b))
		}
		b = wire(chat, true)
		if bytes.Contains(b, []byte("data:image")) || !bytes.Contains(b, []byte("omitted")) {
			t.Fatal("unsupported historical image not explained", string(b))
		}
	}
	if err = os.WriteFile(a.Asset, bytes.Repeat([]byte("x"), a.Bytes), 0600); err != nil {
		t.Fatal(err)
	}
	for _, chat := range []bool{false, true} {
		b := wire(chat, false)
		if bytes.Contains(b, []byte("data:image")) || !bytes.Contains(b, []byte("hash mismatch")) {
			t.Fatal("corrupt image not explained", string(b))
		}
	}
}

func TestBrowserReferenceIsBoundToImmutableSnapshot(t *testing.T) {
	config := filepath.Join(t.TempDir(), "config.json")
	data := []byte(`{"id":"r1","url":"https://example.test/","text":"当时的段落 <hello>"}`)
	a := composerAsset(t, config, "网页区域.json", data)
	a.WebReference = append(json.RawMessage(nil), data...)
	if _, err := prepareComposerAttachments(config, []ComposerAttachment{a}, Defaults()); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(attachmentContent("解释这个区域", []ComposerAttachment{a}), "当时的段落") {
		t.Fatal("reference missing from model context")
	}
	a.WebReference = json.RawMessage(`{"id":"r1","url":"https://example.test/","text":"替换后的段落"}`)
	if _, err := prepareComposerAttachments(config, []ComposerAttachment{a}, Defaults()); err == nil {
		t.Fatal("mismatched reference accepted")
	}
	a.WebReference = json.RawMessage(`null`)
	if _, err := prepareComposerAttachments(config, []ComposerAttachment{a}, Defaults()); err == nil {
		t.Fatal("invalid reference accepted")
	}
}

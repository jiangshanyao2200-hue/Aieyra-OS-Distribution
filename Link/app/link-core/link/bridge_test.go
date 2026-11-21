// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Link/app/link-core/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: realCore; TestBridgeRealToolOfflineReceiptRecoveryAndOneExecutor; TestBridgeMissingSubmissionReceiptNeverReplays
// Impact: python -B scripts/code-atlas.py show Link/app/link-core/link/bridge_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package link

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"bufio"
	"bytes"
	"os/exec"
)

func realCore(t *testing.T, respond ...func(int, any) []any) (string, string, *atomic.Int32) {
	t.Helper()
	executable := os.Getenv("AIEYRA_TEST_OS_HOST")
	if executable == "" {
		t.Skip("Actual OS integration requires AIEYRA_TEST_OS_HOST; standalone unit tests do not launch a model")
	}
	dir := t.TempDir()
	project := filepath.Join(dir, "project")
	if err := os.Mkdir(project, 0700); err != nil {
		t.Fatal(err)
	}
	var calls atomic.Int32
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request any
		_ = json.NewDecoder(r.Body).Decode(&request)
		var output []any
		n := int(calls.Add(1))
		if len(respond) > 0 {
			output = respond[0](n, request)
		} else if n == 1 {
			args, _ := json.Marshal(map[string]string{"patch": "*** Begin Patch\n*** Add File: linked.txt\n+real-core\n*** End Patch"})
			output = []any{map[string]any{"type": "function_call", "id": "fc_link", "call_id": "link_patch", "name": "apply_patch", "arguments": string(args)}}
		} else {
			output = []any{map[string]any{"type": "message", "id": "msg_link", "role": "assistant", "status": "completed", "content": []any{map[string]string{"type": "output_text", "text": "LINK_TOOL_VERIFIED"}}}}
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"id": "fixture-link", "status": "completed", "output": output, "usage": map[string]int{"input_tokens": 30, "output_tokens": 10}})
	}))
	t.Cleanup(provider.Close)
	cmd := exec.Command(executable, dir, project, provider.URL)
	var diagnostic bytes.Buffer
	cmd.Stderr = &diagnostic
	input, err := cmd.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	output, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err = cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = input.Close()
		done := make(chan error, 1)
		go func() { done <- cmd.Wait() }()
		select {
		case err := <-done:
			if err != nil {
				t.Errorf("Actual OS fixture exit: %v: %s", err, diagnostic.String())
			}
		case <-time.After(10 * time.Second):
			_ = cmd.Process.Kill()
			<-done
			t.Error("Actual OS test fixture did not exit")
		}
	})
	var receipt struct {
		Discovery string `json:"discovery"`
	}
	if err = json.NewDecoder(bufio.NewReader(output)).Decode(&receipt); err != nil || receipt.Discovery == "" {
		t.Fatalf("Actual OS fixture start: %v: %s", err, diagnostic.String())
	}
	return receipt.Discovery, project, &calls
}

func TestBridgeRealToolOfflineReceiptRecoveryAndOneExecutor(t *testing.T) {
	f := fixtureHub(t)
	executor := pairDevice(t, f, "linux")
	sender := pairDevice(t, f, "desktop")
	discovery, project, requests := realCore(t)
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
	defer cancel()
	b, e := OpenBridge(ctx, executor, discovery, "Synthetic selected session")
	if e != nil {
		t.Fatal(e)
	}
	defer func() { b.Close() }()
	if _, e = OpenBridge(ctx, executor, discovery, "duplicate"); e == nil {
		t.Fatal("second local bridge accepted")
	}
	for i := 0; i < 2; i++ {
		if e = b.Step(ctx); e != nil {
			t.Fatal(e)
		}
	}
	if requests.Load() != 0 {
		t.Fatal("idle Link invoked model")
	}
	var message Message
	send := map[string]string{"session_id": b.SessionID(), "request_id": "once-through-link", "text": "Create linked.txt using apply_patch."}
	mustCall(t, sender, "/v1/send", send, &message)
	f.mu.Lock()
	f.failReceipts = true
	f.mu.Unlock()
	if e = b.Step(ctx); e == nil {
		t.Fatal("missing receipt failure")
	}
	// 核心已受理后云回执丢失，桥接重启必须读原请求，不再执行第二份。
	b.Close()
	f.mu.Lock()
	f.failReceipts = false
	f.mu.Unlock()
	b, e = OpenBridge(ctx, executor, discovery, "Synthetic selected session")
	if e != nil {
		t.Fatal(e)
	}
	for {
		if e = b.Step(ctx); e != nil {
			t.Fatal(e)
		}
		mustCall(t, sender, "/v1/messages", map[string]string{"id": message.ID}, &message)
		if finalState(message.State) {
			break
		}
		select {
		case <-ctx.Done():
			t.Fatal("task did not settle", message)
		case <-time.After(30 * time.Millisecond):
		}
	}
	if message.State != "completed" || message.Reply != "LINK_TOOL_VERIFIED" {
		t.Fatal(message)
	}
	data, e := os.ReadFile(filepath.Join(project, "linked.txt"))
	if e != nil || string(data) != "real-core\n" {
		t.Fatal(string(data), e)
	}
	if requests.Load() != 2 {
		t.Fatal("model work duplicated", requests.Load())
	}
	mustCall(t, sender, "/v1/send", send, &message)
	if e = b.Step(ctx); e != nil {
		t.Fatal(e)
	}
	if requests.Load() != 2 {
		t.Fatal("completed message replayed")
	}
}

func TestBridgeMissingSubmissionReceiptNeverReplays(t *testing.T) {
	f := fixtureHub(t)
	executor := pairDevice(t, f, "linux")
	discovery, _, requests := realCore(t)
	b, e := OpenBridge(context.Background(), executor, discovery, "selected")
	if e != nil {
		t.Fatal(e)
	}
	var message Message
	mustCall(t, f.owner, "/v1/send", map[string]string{"session_id": b.SessionID(), "request_id": "uncertain", "text": "Do not run blindly"}, &message)
	b.state.Submissions[message.ID] = "submitting"
	if e = writeJSON(b.statePath, b.state); e != nil {
		t.Fatal(e)
	}
	b.Close()
	b, e = OpenBridge(context.Background(), executor, discovery, "selected")
	if e != nil {
		t.Fatal(e)
	}
	defer b.Close()
	if e = b.Step(context.Background()); e != nil {
		t.Fatal(e)
	}
	mustCall(t, f.owner, "/v1/messages", map[string]string{"id": message.ID}, &message)
	if message.State != "unknown" || requests.Load() != 0 || !strings.Contains(message.Error, "receipt missing") {
		t.Fatal(message, requests.Load())
	}
}

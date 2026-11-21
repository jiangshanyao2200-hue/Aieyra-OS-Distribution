// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/CLI/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: TestStartupBufferedInputAndEOFDoNotInvokeProvider; TestStartupGreetingStaysOnDiagnosticAndPreservesNextInput; TestStartupInputCancelsProviderAndSurvives; TestEarlyCancellationResolvesExactRequestBeforeCancel
// Impact: python -B scripts/code-atlas.py show Client/CLI/host/startup_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package cli

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestStartupBufferedInputAndEOFDoNotInvokeProvider(t *testing.T) {
	for _, eof := range []bool{false, true} {
		t.Run(map[bool]string{false: "input", true: "eof"}[eof], func(t *testing.T) {
			config, project := fixture(t, func(http.ResponseWriter, *http.Request) { t.Error("startup invoked provider despite pending input") })
			c := activeClient(t, config, project)
			lines := make(chan inputLine, 1)
			if eof {
				close(lines)
			} else {
				lines <- inputLine{text: "完整保留用户输入 👩🏽‍💻"}
			}
			line, err := c.startup(context.Background(), lines, io.Discard)
			if err != nil || line == nil {
				t.Fatal(line, err)
			}
			if eof && line.err != io.EOF || !eof && line.text != "完整保留用户输入 👩🏽‍💻" {
				t.Fatal(line)
			}
			var snapshot struct{ Greeting struct{ State string } }
			if err := c.call(context.Background(), "workspace.snapshot", nil, &snapshot); err != nil || snapshot.Greeting.State != "skipped" {
				t.Fatal(snapshot, err)
			}
		})
	}
}

func TestStartupGreetingStaysOnDiagnosticAndPreservesNextInput(t *testing.T) {
	var requests atomic.Int32
	config, project := fixture(t, func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		encoded, _ := json.Marshal(body)
		if !bytes.Contains(encoded, []byte("[Startup connection greeting; no tools or task execution.]")) {
			t.Error("missing shared startup context")
		}
		answer(w, "greeting", "我在，新的工作可以开始了。", nil)
	})
	c := activeClient(t, config, project)
	lines := make(chan inputLine, 1)
	var diagnostic bytes.Buffer
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	line, err := c.startup(ctx, lines, &diagnostic)
	if err != nil || line != nil || !strings.Contains(diagnostic.String(), "新的工作可以开始了") || requests.Load() != 1 {
		t.Fatal(line, err, diagnostic.String(), requests.Load())
	}
	lines <- inputLine{text: "next task"}
	if got, err := nextLine(ctx, lines); err != nil || got != "next task" {
		t.Fatal(got, err)
	}
}

func TestStartupInputCancelsProviderAndSurvives(t *testing.T) {
	started, cancelled := make(chan struct{}, 1), make(chan struct{}, 1)
	release := make(chan struct{})
	defer close(release)
	config, project := fixture(t, func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		started <- struct{}{}
		select {
		case <-r.Context().Done():
			cancelled <- struct{}{}
		case <-release:
		}
	})
	c := activeClient(t, config, project)
	lines := make(chan inputLine, 1)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	type result struct {
		line *inputLine
		err  error
	}
	done := make(chan result, 1)
	go func() { line, err := c.startup(ctx, lines, io.Discard); done <- result{line, err} }()
	select {
	case <-started:
	case <-ctx.Done():
		t.Fatal("startup did not begin")
	}
	lines <- inputLine{text: "立即执行我的任务"}
	select {
	case r := <-done:
		if r.err != nil || r.line == nil || r.line.text != "立即执行我的任务" {
			t.Fatal(r)
		}
	case <-ctx.Done():
		t.Fatal("input stuck behind startup")
	}
	select {
	case <-cancelled:
	case <-ctx.Done():
		t.Fatal("startup provider was not cancelled")
	}
}

func TestEarlyCancellationResolvesExactRequestBeforeCancel(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	var status, cancelled atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Action    string
			Arguments map[string]any
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
			return
		}
		if body.Arguments["task_id"] != "child" || body.Arguments["request_id"] != "original" {
			t.Error("wrong task/request", body)
		}
		switch body.Action {
		case "workspace.task_status":
			status.Add(1)
		case "workspace.task_cancel":
			cancelled.Add(1)
			if body.Arguments["generation"] != float64(7) {
				t.Error("cancellation lost generation", body)
			}
		default:
			t.Error("unexpected action", body.Action)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "data": map[string]any{"generation": 7}})
	}))
	defer server.Close()
	c := &client{url: server.URL, session: "child", http: server.Client()}
	if err := c.wait(ctx, "original", io.Discard, io.Discard, true, nil); err == nil {
		t.Fatal("cancel returned success")
	}
	if status.Load() != 1 || cancelled.Load() != 1 {
		t.Fatal("unresolved cancellation", status.Load(), cancelled.Load())
	}
}

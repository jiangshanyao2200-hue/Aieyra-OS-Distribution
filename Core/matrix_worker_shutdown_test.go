// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: modelWorkerShutdownPrefix; modelWorkerShutdownSpec; runModelWorkerTestEntrypoint; runModelShutdownCase; TestModelWorkerOwnedShutdown
// Impact: python -B scripts/code-atlas.py show Core/matrix_worker_shutdown_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

const modelWorkerShutdownPrefix = "fixture-shutdown:"

type modelWorkerShutdownSpec struct {
	Mode  string `json:"mode"`
	Trace string `json:"trace"`
}

// 普通测试仍走生产worker入口；专项仅用私有stdin携带本地夹具参数。
func runModelWorkerTestEntrypoint(in io.Reader, out io.Writer) error {
	dec := json.NewDecoder(in)
	var raw json.RawMessage
	if err := dec.Decode(&raw); err != nil {
		return err
	}
	var request modelWorkerRequest
	if err := json.Unmarshal(raw, &request); err != nil {
		return err
	}
	if request.Settings == nil || !strings.HasPrefix(request.Settings.Model, modelWorkerShutdownPrefix) {
		return RunMatrixModelWorker(io.MultiReader(bytes.NewReader(append(raw, '\n')), dec.Buffered(), in), out)
	}
	var fixture modelWorkerShutdownSpec
	if err := json.Unmarshal([]byte(strings.TrimPrefix(request.Settings.Model, modelWorkerShutdownPrefix)), &fixture); err != nil {
		return err
	}
	record := func(event string, code int) {
		raw, _ := json.Marshal(map[string]any{"event": event, "code": code, "pid": os.Getpid(), "time": time.Now().UTC().Format(time.RFC3339Nano)})
		f, err := os.OpenFile(fixture.Trace, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0600)
		if err != nil {
			os.Exit(2)
		}
		if _, err = f.Write(append(raw, '\n')); err != nil {
			os.Exit(2)
		}
		if err = f.Close(); err != nil {
			os.Exit(2)
		}
	}
	record("started", 0)
	if fixture.Mode != "cancel" {
		frame := modelWorkerFrame{Kind: "result", Answer: Message{Role: RoleAssistant, Content: "worker-result"}, Usage: &Usage{PromptTokens: 3, CompletionTokens: 2, TotalTokens: 5}, Finish: "stop"}
		switch fixture.Mode {
		case "provider-error":
			frame.Error = "provider-fixture-failure"
		case "request-timeout", "request-cancelled":
			cause := context.DeadlineExceeded
			if fixture.Mode == "request-cancelled" {
				cause = context.Canceled
			}
			original := fmt.Errorf("worker request: %w", cause)
			event := modelWorkerFrame{Kind: "event", Event: &Event{Kind: EventError}}
			event.setError(original)
			if err := json.NewEncoder(out).Encode(event); err != nil {
				return err
			}
			frame.setError(original)
		}
		if fixture.Mode == "invalid-frame" {
			frame.Kind = "invalid"
		}
		if err := json.NewEncoder(out).Encode(frame); err != nil {
			return err
		}
		record("result", 0)
	}
	var ack modelWorkerFrame
	if err := dec.Decode(&ack); !errors.Is(err, io.EOF) {
		return fmt.Errorf("fixture expected parent EOF: %v", err)
	}
	record("eof", 0)
	if fixture.Mode == "hang" {
		for {
			time.Sleep(time.Hour)
		}
	}
	// 实际延迟清理，确保返回result与子进程完成不是同一时刻。
	time.Sleep(120 * time.Millisecond)
	record("drained", 0)
	code := 0
	if fixture.Mode == "exit-error" {
		code = 7
	}
	record("exit", code)
	if code != 0 {
		os.Exit(code)
	}
	return nil
}

func runModelShutdownCase(t *testing.T, mode string, status func(int)) (string, error) {
	t.Helper()
	trace := filepath.Join(t.TempDir(), "worker-exit.jsonl")
	data, _ := json.Marshal(modelWorkerShutdownSpec{Mode: mode, Trace: trace})
	settings := Defaults()
	settings.Model = modelWorkerShutdownPrefix + string(data)
	settings.APIKey = "sk-local-worker-fixture"
	ctx, cancel := context.WithCancel(WithProviderSession(context.Background(), testMatrixOwner))
	defer cancel()
	read := func() string { raw, _ := os.ReadFile(trace); return string(raw) }
	done := make(chan error, 1)
	var stoppedTrace string
	var answer Message
	var usage *Usage
	go func() {
		var err error
		answer, usage, err = completeAgentProcess(ctx, settings, []Message{{Role: RoleUser, Content: "local shutdown fixture"}}, nil, nil, func(pid int) error {
			if status != nil {
				status(pid)
			}
			if pid == 0 {
				stoppedTrace = read()
			}
			return nil
		})
		done <- err
	}()
	if mode == "cancel" {
		deadline := time.Now().Add(5 * time.Second)
		for !strings.Contains(read(), `"event":"started"`) && time.Now().Before(deadline) {
			time.Sleep(10 * time.Millisecond)
		}
		if !strings.Contains(read(), `"event":"started"`) {
			t.Fatal("worker did not receive its private request")
		}
		cancel()
	}
	var err error
	select {
	case err = <-done:
	case <-time.After(8 * time.Second):
		cancel()
		t.Fatal("worker shutdown exceeded its bound")
	}
	raw := read()
	t.Logf("worker mode=%s returned=%v; trace: %s", mode, err, raw)
	if mode != "hang" && (!strings.Contains(raw, `"event":"drained"`) || !strings.Contains(raw, `"event":"exit"`)) {
		t.Errorf("parent returned before EOF cleanup completed: %s", raw)
	}
	if mode != "hang" && !strings.Contains(stoppedTrace, `"event":"exit"`) {
		t.Errorf("worker PID cleared before its exit receipt: %s", stoppedTrace)
	}
	switch mode {
	case "normal":
		if err != nil {
			t.Errorf("normal worker failed: %v", err)
		}
	case "cancel":
		if !errors.Is(err, context.Canceled) {
			t.Errorf("cancel sentinel lost: %v", err)
		}
	case "provider-error":
		if err == nil || err.Error() != "provider-fixture-failure" {
			t.Errorf("provider error lost: %v", err)
		}
	case "exit-error":
		if err == nil || err.Error() != "model_worker_stop_failed" {
			t.Errorf("nonzero process exit hidden: %v", err)
		}
	case "hang":
		if err == nil || err.Error() != "model_worker_stop_timeout" {
			t.Errorf("forced process termination hidden: %v", err)
		}
	case "invalid-frame":
		if err == nil || err.Error() != "unknown worker response" {
			t.Errorf("protocol error lost: %v", err)
		}
	}
	if mode == "normal" || mode == "provider-error" || mode == "exit-error" || mode == "hang" {
		if answer.Content != "worker-result" || answer.FinishReason != "stop" || usage == nil || usage.TotalTokens != 5 {
			t.Errorf("shutdown lost completed answer or usage: %+v %+v", answer, usage)
		}
	}
	return raw, err
}

func TestModelWorkerOwnedShutdown(t *testing.T) {
	for _, mode := range []string{"normal", "cancel", "provider-error", "exit-error", "hang", "invalid-frame"} {
		t.Run(mode, func(t *testing.T) { runModelShutdownCase(t, mode, nil) })
	}
}

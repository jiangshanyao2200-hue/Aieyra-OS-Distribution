// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/CLI/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: answer; callTool; fixture; runTest; activeClient; runClient; TestRunToolsContinuationAndIdempotency; TestCLIMotherMemoryRecallKeepsContextWithoutTeam; TestRetiredSessionsRejectedAndHistoricalFilesPreserved; TestServeEOFIdleOwnershipAndShutdown; TestRunCancellationSettlesAndDoesNotReplay; TestInitUsesSharedResponseReceiptProtectsExistingAndHidesKey; TestInitCapacityUsesModelMetadataWithOrWithoutLegacyFlag; TestInitFailureLeavesNoConfigAndTerminalControlsAreRemoved; TestInitPromptDirectoryUsesSharedCASUpdate; TestInitRejectsConfigCreatedDuringVerificationWithoutRetry; TestRetiredHumanToolDoesNotSuspendActiveTask; TestLongResponseAndTerminalCapabilitiesSurviveRetry; TestUndeclaredWorkspaceCallFailsWithoutReplay
// Impact: python -B scripts/code-atlas.py show Client/CLI/host/cli_test.go
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
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	agent "github.com/aieyra/aieyra-os/CORE"
)

func answer(w http.ResponseWriter, id, text string, calls []any) {
	if calls == nil {
		calls = []any{map[string]any{"type": "message", "id": "msg_" + id, "role": "assistant", "status": "completed", "content": []any{map[string]any{"type": "output_text", "text": text}}}}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"id": id, "status": "completed", "output": calls, "usage": map[string]int{"input_tokens": 40, "output_tokens": 10}})
}
func callTool(w http.ResponseWriter, id, name string, args any) {
	b, _ := json.Marshal(args)
	answer(w, id, "", []any{map[string]any{"type": "function_call", "id": "fc_" + id, "call_id": "call_" + id, "name": name, "arguments": string(b)}})
}

func fixture(t *testing.T, handler http.HandlerFunc) (string, string) {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	dir := t.TempDir()
	project := filepath.Join(dir, "project")
	if err := os.Mkdir(project, 0700); err != nil {
		t.Fatal(err)
	}
	s := agent.Defaults()
	s.MemoryEnabled = false // Tool lifecycle tests must not invoke semantic maintenance.
	s.SetPath(filepath.Join(dir, "config.json"))
	s.ModelPoolVersion = 1
	s.ActiveProfile = "test-model"
	s.MatrixProfile = s.ActiveProfile
	s.PromptDir = filepath.Join(dir, "prompts")
	if err := os.Mkdir(s.PromptDir, 0700); err != nil {
		t.Fatal(err)
	}
	s.ProviderConnections = []agent.ProviderConnection{{ID: "test", Provider: "custom", BaseURL: server.URL, APIKey: "local-fixture-key", RequestTimeout: 10}}
	s.APIProfiles = []agent.APIProfile{{ID: s.ActiveProfile, ConnectionID: "test", Model: "fixture", Adapter: "openai", Protocol: agent.ProtocolResponses, BaseURL: server.URL, ToolCalls: true, ContextWindow: 128000, Parameters: json.RawMessage(`{"stream":false,"max_tokens":0}`)}}
	if err := s.Save(); err != nil {
		t.Fatal(err)
	}
	return s.Path(), project
}
func runTest(t *testing.T, args []string, input string) (string, string, error) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	var out, log bytes.Buffer
	err := Run(ctx, args, strings.NewReader(input), &out, &log, "test")
	return out.String(), log.String(), err
}

func activeClient(t *testing.T, config, project string) *client {
	t.Helper()
	host := agent.NewWorkspaceHost(config, "", "")
	if err := host.SetMode(agent.HostCLI); err != nil {
		t.Fatal(err)
	}
	host.SetTerminal()
	host.SetControl(false)
	t.Cleanup(host.Close)
	d, err := host.Open("", project)
	if err != nil {
		t.Fatal(err)
	}
	return newClient(d)
}

func runClient(t *testing.T, c *client, id, prompt string, asJSON bool) (string, error) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	var out bytes.Buffer
	err := c.run(ctx, id, prompt, &out, io.Discard, asJSON, nil)
	return out.String(), err
}

func TestRunToolsContinuationAndIdempotency(t *testing.T) {
	var requests atomic.Int32
	config, project := fixture(t, func(w http.ResponseWriter, r *http.Request) {
		var b map[string]any
		_ = json.NewDecoder(r.Body).Decode(&b)
		n := requests.Add(1)
		if n == 1 {
			callTool(w, "patch", "apply_patch", map[string]string{"patch": "*** Begin Patch\n*** Add File: proof.txt\n+saved\n*** End Patch"})
			return
		}
		data, _ := json.Marshal(b)
		if !bytes.Contains(data, []byte("function_call_output")) {
			t.Error("tool result was not preserved")
		}
		answer(w, "reply", "TOOL_RESULT_SAVED", nil)
	})
	c := activeClient(t, config, project)
	out, err := runClient(t, c, "once", "write proof", true)
	if err != nil {
		t.Fatal(err, out)
	}
	var result struct {
		Session      string `json:"session_id"`
		State, Reply string
	}
	if json.Unmarshal([]byte(out), &result) != nil || result.State != "completed" || result.Reply != "TOOL_RESULT_SAVED" {
		t.Fatal(out)
	}
	if data, err := os.ReadFile(filepath.Join(project, "proof.txt")); err != nil || string(data) != "saved\n" {
		t.Fatal(string(data), err)
	}
	before := requests.Load()
	if _, err = runClient(t, c, "once", "write proof", true); err != nil {
		t.Fatal(err)
	}
	if requests.Load() != before {
		t.Fatal("retry replayed completed tool work")
	}
	if _, err = runClient(t, c, "followup", "confirm the previous file", true); err != nil {
		t.Fatal(err)
	}
	if requests.Load() != before+1 {
		t.Fatal("continuation did not send one new task")
	}
	if _, err = runClient(t, c, "once", "different request", true); err == nil {
		t.Fatal("request ID conflict accepted")
	}
}

func TestCLIMotherMemoryRecallKeepsContextWithoutTeam(t *testing.T) {
	var calls atomic.Int32
	config, project := fixture(t, func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Tools []struct{ Name string }
			Input json.RawMessage
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		memory := false
		for _, tool := range body.Tools {
			memory = memory || tool.Name == "memory"
			if tool.Name == "team" || tool.Name == "agents" || tool.Name == "toolbox" || tool.Name == "workspace" {
				t.Error("CLI mother acquired an unassigned tool", tool.Name)
			}
		}
		if !memory || bytes.Contains(body.Input, []byte("toolbox, memory tool, browser")) {
			t.Error("memory permission and terminal contract disagree")
		}
		switch calls.Add(1) {
		case 1:
			answer(w, "first-context", "CLI_FIRST_CONTEXT_MARKER", nil)
		case 2:
			if !bytes.Contains(body.Input, []byte("CLI_FIRST_CONTEXT_MARKER")) {
				t.Error("live context was lost across CLI requests")
			}
			callTool(w, "memory-recall", "memory", map[string]any{"action": "recall", "query": "CLI_FIRST_CONTEXT_MARKER"})
		default:
			if !bytes.Contains(body.Input, []byte("function_call_output")) || !bytes.Contains(body.Input, []byte("records")) || !bytes.Contains(body.Input, []byte("CLI_FIRST_CONTEXT_MARKER")) {
				t.Error("memory recall did not return real archived context")
			}
			answer(w, "memory-done", "CLI_MEMORY_CONTEXT_OK", nil)
		}
	})
	c := activeClient(t, config, project)
	if out, err := runClient(t, c, "context-first", "remember this turn", true); err != nil {
		t.Fatal(err, out)
	}
	out, err := runClient(t, c, "context-recall", "recall the earlier marker", true)
	if err != nil || !strings.Contains(out, "CLI_MEMORY_CONTEXT_OK") || calls.Load() != 3 {
		t.Fatal("CLI memory/context round trip failed", calls.Load(), err, out)
	}
}

func TestRetiredSessionsRejectedAndHistoricalFilesPreserved(t *testing.T) {
	config, project := fixture(t, func(http.ResponseWriter, *http.Request) { t.Error("retired operation invoked provider") })
	file := filepath.Join(filepath.Dir(config), "cli", "workspaces", strings.Repeat("a", 32), "workspace.json")
	if err := os.MkdirAll(filepath.Dir(file), 0700); err != nil {
		t.Fatal(err)
	}
	const historical = "historical private content must stay byte-identical"
	if err := os.WriteFile(file, []byte(historical), 0600); err != nil {
		t.Fatal(err)
	}
	for _, args := range [][]string{
		{"sessions", "--config", config},
		{"run", "--config", config, "--workdir", project, "--resume", strings.Repeat("a", 32), "-p", "old task"},
	} {
		if _, _, err := runTest(t, args, ""); err == nil {
			t.Fatal("saved session command accepted")
		}
	}
	data, err := os.ReadFile(file)
	if err != nil || string(data) != historical {
		t.Fatal("historical archive changed", err)
	}
}

func TestServeEOFIdleOwnershipAndShutdown(t *testing.T) {
	var requests atomic.Int32
	config, project := fixture(t, func(w http.ResponseWriter, r *http.Request) { requests.Add(1); answer(w, "idle", "unexpected", nil) })
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	reader, writer := io.Pipe()
	defer reader.Close()
	done := make(chan error, 1)
	go func() {
		done <- Run(ctx, []string{"serve", "--config", config, "--workdir", project}, strings.NewReader(""), writer, io.Discard, "test")
		writer.Close()
	}()
	var ready struct {
		Session   string `json:"session_id"`
		Discovery string `json:"discovery"`
		Token     string `json:"token"`
	}
	if err := json.NewDecoder(reader).Decode(&ready); err != nil {
		t.Fatal(err)
	}
	if ready.Session == "" || ready.Token != "" {
		t.Fatal("invalid public ready record")
	}
	select {
	case err := <-done:
		t.Fatal("EOF terminated serve", err)
	case <-time.After(300 * time.Millisecond):
	}
	if requests.Load() != 0 {
		t.Fatal("idle server invoked model")
	}
	_, _, err := runTest(t, []string{"run", "--config", config, "--workdir", project, "--resume", ready.Session, "-p", "must not start"}, "")
	if err == nil {
		t.Fatal("second executor accepted")
	}
	cancel()
	select {
	case err = <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("shutdown did not finish")
	}
	if _, err = os.Stat(ready.Discovery); !os.IsNotExist(err) {
		t.Fatal("discovery file survived shutdown", err)
	}
	_, _, err = runTest(t, []string{"chat", "--plain", "--config", config, "--workdir", project}, "/exit\n")
	if err != nil {
		t.Fatal("lock not released", err)
	}
}

func TestRunCancellationSettlesAndDoesNotReplay(t *testing.T) {
	started := make(chan struct{}, 1)
	closed := make(chan struct{}, 1)
	release := make(chan struct{})
	defer close(release)
	config, project := fixture(t, func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		started <- struct{}{}
		select {
		case <-r.Context().Done():
			closed <- struct{}{}
		case <-release:
		}
	})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	c := activeClient(t, config, project)
	done := make(chan error, 1)
	var log bytes.Buffer
	go func() {
		done <- c.run(ctx, "cancel-once", "wait", io.Discard, &log, true, nil)
	}()
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("request did not start")
	}
	cancel()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("cancel reported success")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("cancel stuck")
	}
	select {
	case <-closed:
	case <-time.After(2 * time.Second):
		t.Fatal("provider request was not cancelled")
	}
	files, _ := filepath.Glob(filepath.Join(filepath.Dir(config), "cli", "workspaces", "*", "workspace.json"))
	if len(files) != 0 {
		t.Fatal("ephemeral primary saved ordinary history", files)
	}
	out, err := runClient(t, c, "cancel-once", "wait", true)
	if err == nil || !strings.Contains(out, `"state":"cancelled"`) {
		t.Fatal("cancelled receipt lost", out, err)
	}
	select {
	case <-started:
		t.Fatal("retry replayed cancelled provider call")
	default:
	}
}

func TestInitUsesSharedResponseReceiptProtectsExistingAndHidesKey(t *testing.T) {
	sharedSettingsRoot(t)
	var count atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		count.Add(1)
		encoded, _ := json.Marshal(body)
		s := string(encoded)
		if !strings.Contains(s, "Reply with one short greeting.") || strings.Contains(s, "aieyra_connection_check") {
			t.Error("automation did not use one shared text detection")
		}
		answer(w, "verified", "hello", nil)
	}))
	defer server.Close()
	t.Setenv("CLI_TEST_KEY", "secret-fixture-init")
	config := filepath.Join(t.TempDir(), "config.json")
	args := []string{"init", "--config", config, "--base-url", server.URL, "--model", "fixture", "--context-window", "128000", "--key-env", "CLI_TEST_KEY"}
	out, log, err := runTest(t, args, "")
	if err != nil {
		t.Fatal(err, out, log)
	}
	if count.Load() != 1 || !strings.Contains(out, `"response_verified":true`) || !strings.Contains(out, `"tools_verified":false`) {
		t.Fatal(count.Load())
	}
	before, _ := os.ReadFile(config)
	if !bytes.Contains(before, []byte("secret-fixture-init")) {
		t.Fatal("connection key missing")
	}
	if strings.Contains(out+log, "secret-fixture-init") {
		t.Fatal("secret in output")
	}
	if _, _, err = runTest(t, args, ""); err == nil {
		t.Fatal("existing config overwritten")
	}
	after, _ := os.ReadFile(config)
	if !bytes.Equal(before, after) || count.Load() != 1 {
		t.Fatal("init mutated existing settings")
	}
	out, log, err = runTest(t, []string{"config", "--config", config}, "")
	if err != nil || strings.Contains(out+log, "secret-fixture-init") {
		t.Fatal("config output exposed key", err)
	}
}

func TestInitCapacityUsesModelMetadataWithOrWithoutLegacyFlag(t *testing.T) {
	sharedSettingsRoot(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		answer(w, "verified-capacity", "hello", nil)
	}))
	defer server.Close()
	t.Setenv("CLI_TEST_KEY", strings.Repeat("f", 24))
	for _, legacy := range []bool{false, true} {
		config := filepath.Join(t.TempDir(), "config.json")
		args := []string{"init", "--config", config, "--base-url", server.URL, "--model", "gemini-4-argon", "--key-env", "CLI_TEST_KEY"}
		if legacy {
			args = append(args, "--context-window", "52000")
		}
		if _, _, err := runTest(t, args, ""); err != nil {
			t.Fatal(legacy, err)
		}
		saved, err := agent.Load(config)
		if err != nil || saved.ModelContextWindow != 1048576 {
			t.Fatal("CLI init changed the model's catalog capacity", legacy, saved, err)
		}
	}
}

func TestInitFailureLeavesNoConfigAndTerminalControlsAreRemoved(t *testing.T) {
	sharedSettingsRoot(t)
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		answer(w, "incomplete", "", nil)
	}))
	defer server.Close()
	t.Setenv("CLI_TEST_KEY", "secret-fixture-failed")
	config := filepath.Join(t.TempDir(), "config.json")
	_, _, err := runTest(t, []string{"init", "--config", config, "--base-url", server.URL, "--model", "fixture", "--context-window", "128000", "--key-env", "CLI_TEST_KEY"}, "")
	if err == nil {
		t.Fatal("incomplete response accepted")
	}
	if calls.Load() != 1 {
		t.Fatalf("incomplete response path was not reached exactly once: %d", calls.Load())
	}
	if _, err = os.Stat(config); !os.IsNotExist(err) {
		t.Fatal("failed init wrote configuration")
	}
	if strings.ContainsAny(terminalText("hello\x1b[2J\u009b31m\a\r世界\n"), "\x1b\u009b\a\r") {
		t.Fatal("terminal control character passed through")
	}
}

func TestInitPromptDirectoryUsesSharedCASUpdate(t *testing.T) {
	sharedSettingsRoot(t)
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		answer(w, "prompt-directory", "hello", nil)
	}))
	defer server.Close()
	t.Setenv("CLI_TEST_KEY", "synthetic-prompt-dir-key")
	dir := t.TempDir()
	config := filepath.Join(dir, "config.json")
	prompts := filepath.Join(dir, "prompts 中文")
	if err := os.Mkdir(prompts, 0700); err != nil {
		t.Fatal(err)
	}
	out, log, err := runTest(t, []string{"init", "--config", config, "--base-url", server.URL, "--model", "fixture", "--context-window", "128000", "--key-env", "CLI_TEST_KEY", "--prompt-dir", prompts}, "")
	if err != nil {
		t.Fatal(err, out, log)
	}
	s, err := agent.Load(config)
	if err != nil || s.PromptDir != prompts || s.Model != "fixture" || requests.Load() != 1 {
		t.Fatal("shared prompt-dir update lost configuration or repeated detection", err, requests.Load())
	}
	if strings.Contains(out+log, "synthetic-prompt-dir-key") || !strings.Contains(out, `"configured":true`) {
		t.Fatal("init completion or key masking changed")
	}
}

func TestInitRejectsConfigCreatedDuringVerificationWithoutRetry(t *testing.T) {
	sharedSettingsRoot(t)
	config := filepath.Join(t.TempDir(), "config.json")
	external := []byte(`{"external_owner":"OS edit during detection","provider_connections":[],"api_profiles":[]}`)
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		if err := os.WriteFile(config, external, 0600); err != nil {
			t.Error(err)
		}
		answer(w, "concurrent-config", "hello", nil)
	}))
	defer server.Close()
	t.Setenv("CLI_TEST_KEY", "synthetic-concurrent-init-key")
	out, log, err := runTest(t, []string{"init", "--config", config, "--base-url", server.URL, "--model", "fixture", "--context-window", "128000", "--key-env", "CLI_TEST_KEY"}, "")
	if err == nil || !strings.Contains(err.Error(), "no retry") {
		t.Fatal("concurrent configuration did not reject the stale save", err)
	}
	saved, readErr := os.ReadFile(config)
	if readErr != nil || !bytes.Equal(saved, external) || requests.Load() != 1 {
		t.Fatal("stale init overwrote another writer or repeated detection", readErr, requests.Load())
	}
	if strings.Contains(out+log+err.Error(), "synthetic-concurrent-init-key") || strings.Contains(out, `"configured":true`) {
		t.Fatal("failed init exposed its key or claimed success")
	}
}

func TestRetiredHumanToolDoesNotSuspendActiveTask(t *testing.T) {
	var requests atomic.Int32
	config, project := fixture(t, func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Tools []struct{ Name string }
			Input json.RawMessage
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		for _, tool := range body.Tools {
			if tool.Name == "toolbox" || tool.Name == "human" || tool.Name == "agents" {
				t.Error("retired capability advertised", tool.Name)
			}
		}
		switch requests.Add(1) {
		case 1:
			// A provider can still return an old toolbox call. It must not create
			// a pending decision or make the CLI wait for unavailable UI.
			callTool(w, "ask", "toolbox", map[string]any{"action": "call", "name": "human", "arguments": map[string]any{"action": "request", "request_id": "choose-format", "category": "direction", "question": "Choose a format", "recommendation": "Use plain text", "impact": "Output format only", "resume_summary": "Write the selected format", "options": []any{map[string]string{"id": "plain", "label": "Plain text", "impact": "Readable"}, map[string]string{"id": "json", "label": "JSON", "impact": "Structured"}}}})
		default:
			if (!bytes.Contains(body.Input, []byte("tool_not_assigned: human")) && !bytes.Contains(body.Input, []byte("Toolbox 在基础能力阶段暂未开放"))) || bytes.Contains(body.Input, []byte("human_request_id")) {
				t.Error("retired human call was not rejected without a pending decision")
			}
			answer(w, "human-retired", "CONTINUED_WITHOUT_HUMAN_TOOL", nil)
		}
	})
	c := activeClient(t, config, project)
	out, err := runClient(t, c, "choose-format", "choose format", true)
	var result struct {
		Session      string `json:"session_id"`
		State, Reply string
	}
	if err != nil || json.Unmarshal([]byte(out), &result) != nil || result.State != "completed" || result.Reply != "CONTINUED_WITHOUT_HUMAN_TOOL" || requests.Load() != 2 {
		t.Fatal("retired human call left the task suspended", out, err, requests.Load())
	}
	if _, err = runClient(t, c, "choose-format", "choose format", true); err != nil || requests.Load() != 2 {
		t.Fatal("completed request replayed retired toolbox call", err, requests.Load())
	}
}

func TestLongResponseAndTerminalCapabilitiesSurviveRetry(t *testing.T) {
	text := strings.Repeat("完整中文正文和代码必须留在终端。\n", 40) + "END_OF_DOCUMENT"
	var requests atomic.Int32
	config, project := fixture(t, func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Tools []struct {
				Name       string
				Parameters struct {
					Properties map[string]struct{ Enum []string }
				}
			}
			Input json.RawMessage
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		allowed := map[string]bool{"terminal": true, "apply_patch": true, "update_plan": true, "memory": true, "models": true, "image_gen": true, "view_image": true}
		for _, tool := range body.Tools {
			if tool.Name == "web_search" { // Available when the private fallback is installed.
				continue
			}
			if !allowed[tool.Name] {
				t.Error("non-base capability advertised", tool.Name)
			}
			delete(allowed, tool.Name)
		}
		if len(allowed) != 0 {
			t.Error("base tools missing", allowed)
		}
		if bytes.Contains(body.Input, []byte("canvas_communication")) {
			t.Error("desktop canvas contract supplied to terminal")
		}
		if !bytes.Contains(body.Input, []byte("in the Aieyra CLI terminal")) {
			t.Error("terminal contract missing")
		}
		if requests.Add(1) == 1 {
			callTool(w, "long-proof", "apply_patch", map[string]string{"patch": "*** Begin Patch\n*** Add File: long-proof.txt\n+LONG_RESPONSE_PROOF\n*** End Patch"})
			return
		}
		if !bytes.Contains(body.Input, []byte("function_call_output")) {
			t.Error("base tool receipt missing from continuation")
		}
		answer(w, "long", text, nil)
	})
	c := activeClient(t, config, project)
	out, err := runClient(t, c, "long-response", "return the full response", true)
	var result struct {
		Session string `json:"session_id"`
		Reply   string
	}
	if err != nil || json.Unmarshal([]byte(out), &result) != nil || result.Reply != text {
		t.Fatal("long JSON response missing", err, out)
	}
	out, err = runClient(t, c, "long-response", "return the full response", false)
	if err != nil || out != text+"\n" || requests.Load() != 2 {
		t.Fatal("saved long response replayed or truncated", err, out, requests.Load())
	}
	if data, err := os.ReadFile(filepath.Join(project, "long-proof.txt")); err != nil || string(data) != "LONG_RESPONSE_PROOF\n" {
		t.Fatal("base tool did not write proof", string(data), err)
	}
}

func TestUndeclaredWorkspaceCallFailsWithoutReplay(t *testing.T) {
	var requests atomic.Int32
	config, project := fixture(t, func(w http.ResponseWriter, r *http.Request) {
		var body struct{ Tools []struct{ Name string } }
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		for _, tool := range body.Tools {
			if tool.Name == "workspace" {
				t.Error("retired workspace capability advertised")
			}
		}
		requests.Add(1)
		callTool(w, "unavailable", "workspace", map[string]string{"action": "connect"})
	})
	c := activeClient(t, config, project)
	for range 2 {
		out, err := runClient(t, c, "unavailable-workspace", "return the full response", true)
		var result struct{ State string }
		if err == nil || !strings.Contains(err.Error(), "tool_not_assigned: workspace") || json.Unmarshal([]byte(out), &result) != nil || result.State != "failed" {
			t.Fatal("undeclared workspace call did not preserve a real failure", err, out)
		}
	}
	if requests.Load() != 1 {
		t.Fatal("failed workspace request was silently replayed", requests.Load())
	}
}

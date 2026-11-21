// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestWorkspaceCompactRuntime; workspaceCompactWire; workspaceCompactFixture; counts; releaseLate; serve; workspaceCompactHost; workspaceCompactSend; workspaceCompactArchive; workspaceCompactPairs; workspaceCompactUsage; workspaceCompactEvidence; workspaceCompactSnapshot; testWorkspaceCompactRuntime
// Impact: python -B scripts/code-atlas.py show Core/workspace_compact_runtime_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// CLI必须在Open前设置终端能力，否则仅选择存储模式仍会携带桌面合同。
func TestWorkspaceCompactRuntime(t *testing.T) {
	for _, mode := range []HostMode{HostOS, HostCLI} {
		t.Run(string(mode), func(t *testing.T) {
			for _, scenario := range []string{"long", "invalid", "nonreducing", "temporary", "refused", "cancelled"} {
				t.Run(scenario, func(t *testing.T) {
					testWorkspaceCompactRuntime(t, mode, scenario)
				})
			}
		})
	}
	t.Run("legacy/persistent-reopen", func(t *testing.T) {
		testWorkspaceCompactRuntime(t, HostLegacy, "long")
	})
}

type workspaceCompactWire struct {
	Kind     string          `json:"kind"`
	Number   int             `json:"number"`
	At       string          `json:"at"`
	Request  json.RawMessage `json:"request"`
	Response json.RawMessage `json:"response"`
	Status   int             `json:"status"`
}

type workspaceCompactFixture struct {
	mode        HostMode
	t           *testing.T
	scenario    string
	wantTools   int
	mu          sync.Mutex
	wires       []workspaceCompactWire
	models      int
	compactions int
	entered     chan struct{}
	release     chan struct{}
	returned    chan struct{}
	releaseOnce sync.Once
}

func (f *workspaceCompactFixture) counts() (int, int) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.models, f.compactions
}

func (f *workspaceCompactFixture) releaseLate() {
	f.releaseOnce.Do(func() { close(f.release) })
}

func (f *workspaceCompactFixture) serve(rw http.ResponseWriter, req *http.Request) {
	raw, err := io.ReadAll(req.Body)
	if err != nil {
		f.t.Error(err)
		http.Error(rw, "fixture body unavailable", http.StatusBadRequest)
		return
	}
	var body struct {
		Tools []json.RawMessage `json:"tools"`
		Input []struct {
			Content json.RawMessage `json:"content"`
		} `json:"input"`
	}
	if err = json.Unmarshal(raw, &body); err != nil {
		f.t.Error(err)
		http.Error(rw, "fixture body invalid", http.StatusBadRequest)
		return
	}
	compact := len(body.Tools) == 0
	f.mu.Lock()
	kind, number := "model", f.models+1
	if compact {
		kind, number = "compact", f.compactions+1
		f.compactions++
	} else {
		f.models++
	}
	index := len(f.wires)
	f.wires = append(f.wires, workspaceCompactWire{Kind: kind, Number: number,
		At: time.Now().UTC().Format(time.RFC3339Nano), Request: append(json.RawMessage(nil), raw...)})
	f.mu.Unlock()
	answer := httptest.NewRecorder()
	late := compact && f.scenario == "cancelled" && number == 1
	if compact {
		var input string
		if len(body.Input) > 0 {
			_ = json.Unmarshal(body.Input[len(body.Input)-1].Content, &input)
		}
		var envelope struct {
			Digest string          `json:"source_digest"`
			Source json.RawMessage `json:"source"`
		}
		if err := json.Unmarshal([]byte(input), &envelope); err != nil || envelope.Digest == "" ||
			envelope.Digest != fmt.Sprintf("%x", sha256.Sum256(envelope.Source)) {
			f.t.Error("compact request omitted its actual source digest")
			http.Error(answer, "compact source invalid", http.StatusBadRequest)
		} else {
			// 独立检查压缩边界，防止夹具随CompactWorkCut一起接受未完成的工具事务。
			var source struct {
				Messages []Message `json:"messages"`
			}
			_ = json.Unmarshal(envelope.Source, &source)
			pending := map[string]bool{}
			for _, message := range source.Messages {
				for _, call := range message.ToolCalls {
					pending[call.ID] = true
				}
				if message.Role == RoleTool {
					delete(pending, message.ToolCallID)
				}
			}
			if len(pending) != 0 {
				f.t.Error("compact source split a pending tool group")
			}
			if late {
				close(f.entered)
				// 故意在用户取消后返回有效摘要，检验迟到结果不会提交或续作。
				<-f.release
			}
			summary := CompactSummary{SourceDigest: envelope.Digest,
				Goals: []string{"finish original work"}, Constraints: []string{"never repeat completed tools"},
				Decisions: []string{}, Progress: []string{"earlier files already completed"},
				CriticalFacts: []string{"COMPACT_RUNTIME_CHECKPOINT"}, OpenTasks: []string{"finish remaining work"},
				NextSteps: []string{"continue original task"}, Uncertainties: []string{}}
			switch f.scenario {
			case "invalid":
				fixtureAnswer(answer, "invalid-summary", "INVALID_CHECKPOINT_MUST_NOT_ENTER_CONTEXT", nil)
			case "nonreducing":
				summary.Progress = []string{strings.Repeat("unreduced context ", 6500)}
				fixtureAnswer(answer, "nonreducing-summary", string(rawJSON(summary)), nil)
			case "refused":
				answer.Header().Set("Content-Type", "application/json")
				answer.WriteHeader(http.StatusForbidden)
				_, _ = answer.Write([]byte(`{"error":{"code":"content_policy_violation","message":"explicit provider refusal"}}`))
			case "temporary":
				answer.Header().Set("Content-Type", "application/json")
				answer.WriteHeader(http.StatusServiceUnavailable)
				_, _ = answer.Write([]byte(`{"error":{"code":"service_unavailable","message":"summary service temporarily unavailable"}}`))
			default:
				fixtureAnswer(answer, fmt.Sprintf("compact-%d", number), string(rawJSON(summary)), nil)
			}
		}
	} else if number <= f.wantTools {
		// 真实Workspace的固定合同会抬高工作预算；留足工具schema增长余量，
		// 仍实际越过正式阈值，不依赖旧说明长度恰好触发压缩。
		call := map[string]any{"type": "function_call", "id": fmt.Sprintf("fc-compact-%d", number), "call_id": fmt.Sprintf("call_compact_%d", number),
			"name": "apply_patch", "arguments": string(rawJSON(map[string]any{
				"patch": fmt.Sprintf("*** Begin Patch\n*** Add File: step%d.txt\n+completed once\n*** End Patch", number)}))}
		if f.mode == HostOS {
			call = fixtureReportCall(fmt.Sprintf("call_compact_%d", number), fmt.Sprintf("step%d.txt", number), "completed once\n")
		}
		fixtureAnswer(answer, fmt.Sprintf("work-%d", number), "", []any{
			map[string]any{"type": "message", "id": fmt.Sprintf("progress-%d", number), "role": "assistant", "status": "completed",
				"content": []any{map[string]any{"type": "output_text", "text": "EXACT_OBSERVATION_MUST_SURVIVE " + strings.Repeat("bounded progress ", 5000)}}},
			call,
		})
	} else {
		text := "ORIGINAL_WORK_COMPLETED"
		if number > f.wantTools+1 || f.scenario == "cancelled" {
			text = "EXPLICIT_CONTINUATION_VERIFIED"
		}
		fixtureAnswer(answer, fmt.Sprintf("work-%d", number), text, nil)
	}
	f.mu.Lock()
	f.wires[index].Response = append(json.RawMessage(nil), answer.Body.Bytes()...)
	f.wires[index].Status = answer.Code
	f.mu.Unlock()
	for name, values := range answer.Header() {
		for _, value := range values {
			rw.Header().Add(name, value)
		}
	}
	rw.WriteHeader(answer.Code)
	_, _ = rw.Write(answer.Body.Bytes())
	if late {
		close(f.returned)
	}
}

func workspaceCompactHost(t *testing.T, config, dir string, mode HostMode, id string) (*WorkspaceHost, *Workspace) {
	t.Helper()
	h := NewWorkspaceHost(config, "", filepath.Join(dir, "prompts"))
	if err := h.SetMode(mode); err != nil {
		t.Fatal(err)
	}
	if mode == HostCLI {
		h.SetTerminal()
	}
	t.Cleanup(h.Close)
	opened, err := h.Open(id, dir)
	if err != nil {
		t.Fatal(err)
	}
	h.mu.Lock()
	w := h.workspaces[opened["session_id"].(string)]
	h.mu.Unlock()
	if w == nil || w.isTerminal() != (mode == HostCLI) {
		t.Fatal("host capability did not precede real Open")
	}
	return h, w
}

func workspaceCompactSend(t *testing.T, w *Workspace, request, text string) AgentRecord {
	t.Helper()
	if _, err := w.Send(request, text); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	tick := time.NewTicker(10 * time.Millisecond)
	defer tick.Stop()
	for {
		w.mu.Lock()
		id := w.state.Roles[WorkspaceMatrix]
		w.mu.Unlock()
		if id != "" {
			r, err := w.manager.Status(w.state.ID, id)
			if err == nil && r.Turns[request] == text {
				r, err = w.manager.Wait(ctx, w.state.ID, id, 25000)
				if err != nil || activeAgent(r.State) {
					t.Fatalf("real Send did not finish: state=%s error=%s wait=%v", r.State, r.Error, err)
				}
				return r
			}
		}
		select {
		case <-tick.C:
		case <-ctx.Done():
			t.Fatal("real Send did not dispatch the requested generation")
		}
	}
}

func workspaceCompactArchive(t *testing.T, w *Workspace, id string) ([]byte, *RestoredSession) {
	t.Helper()
	w.manager.mu.Lock()
	job := w.manager.jobs[id]
	var archive *SessionArchive
	if job != nil {
		archive = job.archive
	}
	w.manager.mu.Unlock()
	if archive == nil {
		path, err := SessionPath(filepath.Join(w.manager.dir, "config.json"), id)
		if err != nil {
			t.Fatal(err)
		}
		archive = &SessionArchive{Path: path}
	}
	var raw []byte
	if archive.ephemeral {
		archive.mu.Lock()
		raw = append([]byte(nil), archive.memory...)
		archive.mu.Unlock()
		if _, err := os.Stat(archive.Path); !os.IsNotExist(err) {
			t.Fatal("formal host persisted its temporary conversation", err)
		}
	} else {
		var err error
		raw, err = os.ReadFile(archive.Path)
		if err != nil {
			t.Fatal(err)
		}
	}
	restored, err := archive.read()
	if err != nil {
		t.Fatal(err)
	}
	return raw, restored
}

func workspaceCompactPairs(t *testing.T, restored *RestoredSession, want int) {
	t.Helper()
	calls, results := map[string]int{}, map[string]int{}
	for _, message := range restored.Messages {
		for _, call := range message.ToolCalls {
			calls[call.ID]++
		}
		if message.Role == RoleTool {
			results[message.ToolCallID]++
		}
	}
	if len(calls) != want || len(results) != want {
		t.Fatalf("archive lost tool pairs: calls=%v results=%v", calls, results)
	}
	for i := 1; i <= want; i++ {
		id := fmt.Sprintf("call_compact_%d", i)
		if calls[id] != 1 || results[id] != 1 {
			t.Fatalf("original call/result duplicated or missing: %s %d/%d", id, calls[id], results[id])
		}
	}
}

func workspaceCompactUsage(t *testing.T, r AgentRecord, models, compact int) {
	t.Helper()
	// 维护请求也计入Requests；各轮结束均按真实wire分类，避免漏记后续压缩。
	modelUsage, compactUsage := 0, 0
	for _, usage := range r.Usage {
		switch usage.Kind {
		case "model":
			modelUsage++
		case "compact":
			compactUsage++
		default:
			if strings.HasPrefix(usage.Kind, "compact:retry:") {
				compactUsage++
			} else {
				t.Errorf("unexpected maintenance/retry request: %s", usage.Kind)
			}
		}
	}
	if r.Requests != models+compact || modelUsage != models || compactUsage != compact {
		t.Fatalf("request kinds not accounted: requests=%d model=%d/%d compact=%d/%d", r.Requests, models, modelUsage, compact, compactUsage)
	}
}

func workspaceCompactEvidence(t *testing.T, name string, value any, raw bool) {
	t.Helper()
	root := os.Getenv("AIEYRA_WORKSPACE_COMPACT_EVIDENCE")
	if root == "" {
		return
	}
	dir := filepath.Join(root, strings.ReplaceAll(t.Name(), "/", "__"))
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	var data []byte
	if raw {
		data = value.([]byte)
	} else {
		var err error
		data, err = json.MarshalIndent(value, "", "  ")
		if err != nil {
			t.Fatal(err)
		}
		data = append(data, '\n')
	}
	if err := os.WriteFile(filepath.Join(dir, name), data, 0600); err != nil {
		t.Fatal(err)
	}
}

func workspaceCompactSnapshot(t *testing.T, label string, w *Workspace, r AgentRecord) *RestoredSession {
	t.Helper()
	raw, restored := workspaceCompactArchive(t, w, r.ID)
	workspaceCompactEvidence(t, label+"-archive.jsonl", raw, true)
	workspaceCompactEvidence(t, label+"-restored.json", restored, false)
	workspaceCompactEvidence(t, label+"-record.json", r, false)
	return restored
}

func testWorkspaceCompactRuntime(t *testing.T, mode HostMode, scenario string) {
	want := 1
	if scenario == "long" {
		want = 8
	}
	f := &workspaceCompactFixture{mode: mode, t: t, scenario: scenario, wantTools: want,
		entered: make(chan struct{}), release: make(chan struct{}), returned: make(chan struct{})}
	server := httptest.NewServer(http.HandlerFunc(f.serve))
	t.Cleanup(server.Close)
	dir := t.TempDir()
	config := filepath.Join(dir, "config.json")
	s := Defaults()
	s.SetPath(config)
	s.ModelPoolVersion, s.ActiveProfile = 1, "local-model"
	s.MemoryEnabled, s.DreamsEnabled = false, false
	s.ContextWorkingTokens, s.CompactPercent = 8192, 75
	s.ProviderConnections = []ProviderConnection{{ID: "local", Provider: "custom", BaseURL: server.URL, APIKey: "fake-key-only", RequestTimeout: 10}}
	s.APIProfiles = []APIProfile{{ID: "local-model", ConnectionID: "local", Model: "fixture", Adapter: "openai",
		Protocol: ProtocolResponses, BaseURL: server.URL, ToolCalls: true, ContextWindow: 128000,
		Parameters: rawJSON(map[string]any{"stream": false, "max_tokens": 0})}}
	s.applyPoolProfile()
	if err := s.Save(); err != nil {
		t.Fatal(err)
	}
	prompts := filepath.Join(dir, "prompts")
	if err := os.MkdirAll(prompts, 0700); err != nil {
		t.Fatal(err)
	}
	for _, id := range LayerIDs() {
		file, _, _ := layerSpec(id)
		if err := os.WriteFile(filepath.Join(prompts, file), []byte("Isolated compact fixture. Preserve completed tools.\n"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	h, w := workspaceCompactHost(t, config, dir, mode, "")
	t.Cleanup(func() {
		f.mu.Lock()
		defer f.mu.Unlock()
		workspaceCompactEvidence(t, "wire.json", f.wires, false)
		workspaceCompactEvidence(t, "fixture.json", map[string]any{"mode": mode, "terminal": mode == HostCLI,
			"scenario": scenario, "tools": want, "model_requests": f.models, "compact_requests": f.compactions}, false)
	})
	t.Cleanup(f.releaseLate)
	text := "finish original file work exactly once: USER_INPUT_MUST_REMAIN_EXACT"
	var r AgentRecord
	if scenario == "cancelled" {
		if _, err := w.Send("compact-original", text); err != nil {
			t.Fatal(err)
		}
		select {
		case <-f.entered:
		case <-time.After(10 * time.Second):
			t.Fatal("real tool did not reach compact request")
		}
		w.mu.Lock()
		id := w.state.Roles[WorkspaceMatrix]
		w.mu.Unlock()
		r, _ = w.manager.Status(w.state.ID, id)
		before := workspaceCompactSnapshot(t, "cancel-before", w, r)
		workspaceCompactPairs(t, before, 1)
		if err := w.Cancel(); err != nil {
			t.Fatal(err)
		}
		f.releaseLate()
		r, _ = w.manager.Wait(context.Background(), w.state.ID, id, 10000)
		select {
		case <-f.returned:
		case <-time.After(10 * time.Second):
			t.Fatal("late fixture summary did not return")
		}
		models, compact := f.counts()
		after := workspaceCompactSnapshot(t, "cancel-after", w, r)
		if r.State != "cancelled" || r.Compression != nil || after.Checkpoint != nil || models != 1 || compact != 1 ||
			!bytes.Equal(rawJSON(before.Messages), rawJSON(after.Messages)) {
			t.Fatalf("late compact committed or auto-continued: state=%s model=%d compact=%d", r.State, models, compact)
		}
		// 等待旧任务真正结束后，仅新的显式Send可以启动下一代和新的压缩。
		r = workspaceCompactSend(t, w, "compact-continue", "Explicitly continue after cancellation; preserve completed file.")
		if r.State != "completed" || r.Result != "EXPLICIT_CONTINUATION_VERIFIED" {
			t.Fatalf("explicit continuation failed: %s %s", r.State, r.Error)
		}
	} else {
		r = workspaceCompactSend(t, w, "compact-original", text)
	}
	restored := workspaceCompactSnapshot(t, "first", w, r)
	workspaceCompactPairs(t, restored, want)
	files := map[string]string{}
	for i := 1; i <= want; i++ {
		name := fmt.Sprintf("step%d.txt", i)
		file := filepath.Join(dir, name)
		if mode == HostOS {
			var err error
			file, err = fixtureReportFile(w, name)
			if err != nil {
				t.Fatal(err)
			}
		}
		data, err := os.ReadFile(file)
		files[name] = string(data)
		if err != nil || string(data) != "completed once\n" {
			t.Fatalf("actual artifact lost or repeated: %s content=%q error=%v", name, data, err)
		}
	}
	workspaceCompactEvidence(t, "files.json", files, false)
	models, compact := f.counts()
	if r.ToolTurns != want || compact == 0 {
		t.Fatalf("actual tool/compact boundary missing: tools=%d compact=%d", r.ToolTurns, compact)
	}
	workspaceCompactUsage(t, r, models, compact)
	switch scenario {
	case "refused":
		if r.State != "failed" || r.Failure == nil || r.Failure.Code != "provider_blocked" || models != 1 || compact != 1 || restored.Checkpoint != nil {
			t.Fatal("explicit provider refusal bypassed", r.State, r.Error)
		}
	case "invalid", "nonreducing", "temporary":
		wantCompact := 1
		if scenario == "temporary" {
			wantCompact = 3
		}
		if r.State != "completed" || models != 2 || compact != wantCompact || restored.Checkpoint != nil || r.Compression != nil {
			t.Fatalf("failed/nonreducing summary replaced context: state=%s model=%d compact=%d", r.State, models, compact)
		}
		f.mu.Lock()
		last := string(f.wires[len(f.wires)-1].Request)
		f.mu.Unlock()
		if !strings.Contains(last, "EXACT_OBSERVATION_MUST_SURVIVE") || !strings.Contains(last, text) ||
			strings.Contains(last, "INVALID_CHECKPOINT_MUST_NOT_ENTER_CONTEXT") || strings.Contains(last, "unreduced context unreduced context") {
			t.Fatal("exact precompact context was replaced")
		}
		if scenario == "invalid" || scenario == "temporary" {
			raw, _ := workspaceCompactArchive(t, w, r.ID)
			if !bytes.Contains(raw, []byte(`"kind":"compaction_deferred"`)) {
				t.Fatal("invalid summary lost its deferred receipt")
			}
		}
	case "long":
		if r.State != "completed" || r.Result != "ORIGINAL_WORK_COMPLETED" || models != 9 ||
			restored.Checkpoint == nil || restored.Checkpoint.LastUser != text || r.Compression == nil ||
			r.Compression.AfterTokens >= r.Compression.BeforeTokens {
			t.Fatalf("long work did not compact and finish: state=%s model=%d compact=%d error=%s", r.State, models, compact, r.Error)
		}
		firstArchive, _ := workspaceCompactArchive(t, w, r.ID)
		workspaceID, taskID, runtime := w.state.ID, r.ID, w.dir
		if mode == HostLegacy {
			h.Close()
			h, w = workspaceCompactHost(t, config, dir, mode, workspaceID)
			w.mu.Lock()
			w.startStartupLocked(s, false)
			done := w.startupDone
			w.mu.Unlock()
			select {
			case <-done:
			case <-time.After(10 * time.Second):
				t.Fatal("production startup boundary did not finish")
			}
			w.mu.Lock()
			ready, startupError := w.startupPrepared, w.startupError
			w.mu.Unlock()
			unchanged, _ := workspaceCompactArchive(t, w, taskID)
			newModels, newCompact := f.counts()
			if !ready || startupError != "" || !bytes.Equal(firstArchive, unchanged) || newModels != models || newCompact != compact {
				t.Fatal("legacy reopening changed archive or auto-resumed old work", startupError)
			}
			workspaceCompactEvidence(t, "reopened-before-send-archive.jsonl", unchanged, true)
		}
		r = workspaceCompactSend(t, w, "compact-continue", "Explicitly continue original work using its checkpoint; do not repeat files.")
		if r.ID != taskID || r.Generation != 2 || r.ToolTurns != want || r.State != "completed" || r.Result != "EXPLICIT_CONTINUATION_VERIFIED" {
			t.Fatalf("next explicit turn lost original task: state=%s generation=%d tools=%d", r.State, r.Generation, r.ToolTurns)
		}
		continuedModels, continuedCompact := f.counts()
		if continuedModels != models+1 || continuedCompact < compact {
			t.Fatal("explicit continuation did not preserve request history")
		}
		continuedArchive, continued := workspaceCompactArchive(t, w, r.ID)
		if !bytes.HasPrefix(continuedArchive, firstArchive) {
			t.Fatal("continuation rewrote the original archive")
		}
		workspaceCompactPairs(t, continued, want)
		workspaceCompactSnapshot(t, "continued", w, r)
		f.mu.Lock()
		last := string(f.wires[len(f.wires)-1].Request)
		f.mu.Unlock()
		if !strings.Contains(last, "COMPACT_RUNTIME_CHECKPOINT") || !strings.Contains(last, text) || !strings.Contains(last, "Explicitly continue original work") {
			t.Fatal("next user turn did not use exact user input and checkpoint")
		}
		if mode.unified() {
			if _, err := h.Open("", dir); err == nil {
				t.Fatal("formal host admitted a second primary conversation")
			}
			h.Close()
			if _, err := os.Stat(runtime); !os.IsNotExist(err) {
				t.Fatal("formal host failed to release its runtime", err)
			}
			next := NewWorkspaceHost(config, "", prompts)
			_ = next.SetMode(mode)
			if mode == HostCLI {
				next.SetTerminal()
			}
			t.Cleanup(next.Close)
			if _, err := next.Open(workspaceID, dir); err == nil {
				t.Fatal("formal host reopened a saved primary ID")
			}
			opened, err := next.Open("", dir)
			if err != nil {
				t.Fatal(err)
			}
			fresh := next.workspaces[opened["session_id"].(string)]
			if fresh.state.ID == workspaceID || len(fresh.state.Roles) != 0 {
				t.Fatal("fresh formal host retained a closed execution actor")
			}
			if mode == HostOS {
				// The desktop now restores the selected persistent conversation;
				// its execution actor still starts only on explicit continuation.
				session := fresh.contextSessionLocked()
				if session == nil || session.ID != w.coreLinkScopeLocked() || !strings.Contains(string(rawJSON(fresh.state.Messages)), "Explicitly continue original work") {
					t.Fatal("desktop reopening lost the selected conversation")
				}
				original, err := os.ReadFile(fresh.contextArchivePath(session.Archive))
				if err != nil || !bytes.Equal(original, continuedArchive) {
					t.Fatal("desktop reopening changed the original archive", err)
				}
				for i := 1; i <= want; i++ {
					assertFixtureReport(t, fresh, fmt.Sprintf("step%d.txt", i), "completed once\n")
				}
			} else if len(fresh.state.Messages) != 0 {
				t.Fatal("CLI restored the desktop's selected conversation")
			}
			newModels, newCompact := f.counts()
			if newModels != continuedModels || newCompact != continuedCompact {
				t.Fatal("formal reopen automatically requested old work")
			}
			workspaceCompactEvidence(t, "formal-close-reopen.json", map[string]any{"runtime_removed": true,
				"saved_id_rejected": true, "second_primary_rejected": true, "fresh_messages": len(fresh.state.Messages),
				"fresh_roles": len(fresh.state.Roles), "old_session": workspaceID, "fresh_session": fresh.state.ID}, false)
		}
	}
	models, compact = f.counts()
	workspaceCompactUsage(t, r, models, compact)
	workspaceCompactEvidence(t, "final-record.json", r, false)
	t.Logf("mode=%q terminal=%v scenario=%s models=%d compactions=%d tools=%d state=%s", mode, mode == HostCLI, scenario, models, compact, r.ToolTurns, r.State)
}

// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestWorkingContextBudgetSeparateFromCapacity; TestLongSingleTurnCompactsAndCompletesWithoutReplayingTools; TestLargeRequiredAssignmentContinuesWithinModelCapacity; TestFixedPromptDoesNotCompactTinyToolExchange; TestNonReducingCheckpointKeepsExactContextAndContinues; TestCompactionSavingExcludesExactTaskAndPlan; TestFailedCompactionRetainsExactContextAndCanFinish; TestExplicitProviderRejectionDuringCompactionStopsWithoutBypass; TestCompactionCooldownRetainsRecentEvidenceWithoutExceedingModel; TestArchiveRecallReadsBoundedRecentPages; TestCompactWithinToolLoopRetainsUserAndDoesNotSplitPendingCalls; TestAstraMigrationAndStatelessToolReasoning; TestGPTFastUsesWireTierAndExplicitDefault
// Impact: python -B scripts/code-atlas.py show Core/context_memory_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
)

func TestWorkingContextBudgetSeparateFromCapacity(t *testing.T) {
	s := Defaults()
	s.Adapter = "openai"
	s.ModelContextWindow = 1050000
	s.ContextWorkingTokens = 25000
	s.CompactPercent = 75
	b := s.ContextBudget()
	if b.Window != 1050000 || b.WorkingLimit() != 25000 || b.Threshold() != 18750 {
		t.Fatalf("%+v", b)
	}
	s.ModelContextWindow = 8192
	if s.ContextBudget().WorkingLimit() >= 8192 {
		t.Fatal("no output reserve")
	}
}

func TestLongSingleTurnCompactsAndCompletesWithoutReplayingTools(t *testing.T) {
	var calls, compactions atomic.Int32
	m, dir := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
		var body map[string]json.RawMessage
		_ = json.NewDecoder(r.Body).Decode(&body)
		if len(body["tools"]) == 0 {
			compactions.Add(1)
			var input []struct {
				Content json.RawMessage `json:"content"`
			}
			_ = json.Unmarshal(body["input"], &input)
			var text string
			_ = json.Unmarshal(input[len(input)-1].Content, &text)
			var source struct {
				Digest string `json:"source_digest"`
			}
			_ = json.Unmarshal([]byte(text), &source)
			if source.Digest == "" {
				t.Error("missing compact digest", string(input[len(input)-1].Content))
			}
			s := CompactSummary{SourceDigest: source.Digest, Goals: []string{"finish eight steps"}, Constraints: []string{"do not repeat completed tools"}, Decisions: []string{}, Progress: []string{"finished earlier steps"}, CriticalFacts: []string{}, OpenTasks: []string{"finish remaining steps"}, NextSteps: []string{"continue"}, Uncertainties: []string{}}
			fixtureAnswer(w, fmt.Sprintf("compact%d", compactions.Load()), string(rawJSON(s)), nil)
			return
		}
		n := calls.Add(1)
		if n > 8 {
			fixtureAnswer(w, "done", "FINISHED", nil)
			return
		}
		fixtureAnswer(w, fmt.Sprintf("r%d", n), "", []any{
			map[string]any{"type": "message", "id": fmt.Sprintf("msg%d", n), "role": "assistant", "status": "completed", "content": []any{map[string]any{"type": "output_text", "text": strings.Repeat("bounded progress ", 1800)}}},
			map[string]any{"type": "function_call", "id": fmt.Sprintf("fc%d", n), "call_id": fmt.Sprintf("call%d", n), "name": "apply_patch", "arguments": string(rawJSON(map[string]any{"patch": fmt.Sprintf("*** Begin Patch\n*** Add File: step%d.txt\n+completed once\n*** End Patch", n)}))},
		})
	})
	s, e := Load(m.config)
	if e != nil {
		t.Fatal(e)
	}
	s.ContextWorkingTokens = 8192
	s.CompactPercent = 75
	setTestProfileCompact(s, 6144)
	if e = s.Save(); e != nil {
		t.Fatal(e)
	}
	r, e := m.Create(context.Background(), testMatrixOwner, AgentSpec{RequestID: "long-work", ModelID: "local-model", Task: "finish all eight steps and keep files", Prompt: "Use tools", Workdir: dir, Tools: []string{"apply_patch"}, MaxRequests: 24, MaxTokens: 500000})
	if e != nil {
		t.Fatal(e)
	}
	r, e = m.Wait(context.Background(), testMatrixOwner, r.ID, 25000)
	if e != nil || r.State != "completed" {
		t.Fatalf("state=%s error=%s %v", r.State, r.Error, e)
	}
	if compactions.Load() < 1 || calls.Load() != 9 {
		t.Fatalf("compactions=%d calls=%d", compactions.Load(), calls.Load())
	}
	for i := 1; i <= 8; i++ {
		b, e := os.ReadFile(filepath.Join(dir, fmt.Sprintf("step%d.txt", i)))
		if e != nil || string(b) != "completed once\n" {
			t.Fatal(i, e, string(b))
		}
	}
	if r.Compression == nil || r.Compression.AfterTokens >= r.Compression.BeforeTokens {
		t.Fatal("checkpoint missing")
	}
}

func TestLargeRequiredAssignmentContinuesWithinModelCapacity(t *testing.T) {
	m, dir := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
		fixtureAnswer(w, "required-input", "FINISHED", nil)
	})
	s, err := Load(m.config)
	if err != nil {
		t.Fatal(err)
	}
	s.ContextWorkingTokens = 25000
	setTestProfileCompact(s, 22500)
	if err = s.Save(); err != nil {
		t.Fatal(err)
	}
	before, _ := os.ReadFile(m.config)
	r, err := m.Create(context.Background(), testMatrixOwner, AgentSpec{RequestID: "required-input", ModelID: "local-model", Task: strings.Repeat("necessary ", 5800), Prompt: strings.Repeat("required ", 2800), Workdir: dir, Tools: []string{"apply_patch"}, MaxRequests: 2, MaxTokens: 200000})
	if err != nil {
		t.Fatal(err)
	}
	r, err = m.Wait(context.Background(), testMatrixOwner, r.ID, 10000)
	if err != nil || r.State != "completed" {
		t.Fatalf("%s %s %v", r.State, r.Error, err)
	}
	if r.Context == nil || r.Context.Window <= 25000 || r.Context.Tokens > r.Context.Window {
		t.Fatalf("budget not adapted: %+v", r.Context)
	}
	after, _ := os.ReadFile(m.config)
	if string(before) != string(after) {
		t.Fatal("task changed user settings")
	}
}

func TestFixedPromptDoesNotCompactTinyToolExchange(t *testing.T) {
	var calls, compactions atomic.Int32
	m, dir := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
		var body map[string]json.RawMessage
		_ = json.NewDecoder(r.Body).Decode(&body)
		if len(body["tools"]) == 0 {
			compactions.Add(1)
			fixtureAnswer(w, "unexpected-compact", "invalid unnecessary summary", nil)
			return
		}
		if calls.Add(1) == 1 {
			fixtureAnswer(w, "one-tool", "", []any{map[string]any{"type": "function_call", "id": "fc-small", "call_id": "small", "name": "apply_patch", "arguments": string(rawJSON(map[string]any{"patch": "*** Begin Patch\n*** Add File: receipt.txt\n+once\n*** End Patch"}))}})
			return
		}
		fixtureAnswer(w, "finish", "FINISHED", nil)
	})
	s, err := Load(m.config)
	if err != nil {
		t.Fatal(err)
	}
	s.ContextWorkingTokens, s.CompactPercent = 8192, 75
	setTestProfileCompact(s, 6144)
	if err = s.Save(); err != nil {
		t.Fatal(err)
	}
	before, _ := os.ReadFile(m.config)
	r, err := m.Create(context.Background(), testMatrixOwner, AgentSpec{RequestID: "fixed-prompt", ModelID: "local-model", Task: "create receipt.txt once and finish", Prompt: strings.Repeat("required ", 2800), Workdir: dir, Tools: []string{"apply_patch"}, MaxRequests: 3, MaxTokens: 200000})
	if err != nil {
		t.Fatal(err)
	}
	r, err = m.Wait(context.Background(), testMatrixOwner, r.ID, 10000)
	if err != nil || r.State != "completed" {
		t.Fatalf("%s %s %v", r.State, r.Error, err)
	}
	if calls.Load() != 2 || compactions.Load() != 0 {
		t.Fatalf("calls=%d compactions=%d", calls.Load(), compactions.Load())
	}
	b, err := os.ReadFile(filepath.Join(dir, "receipt.txt"))
	if err != nil || string(b) != "once\n" {
		t.Fatal(err, string(b))
	}
	after, _ := os.ReadFile(m.config)
	if string(before) != string(after) {
		t.Fatal("settings changed")
	}
}

func TestNonReducingCheckpointKeepsExactContextAndContinues(t *testing.T) {
	var calls, compactions atomic.Int32
	m, dir := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
		var body map[string]json.RawMessage
		_ = json.NewDecoder(r.Body).Decode(&body)
		if len(body["tools"]) == 0 {
			compactions.Add(1)
			var input []struct {
				Content string `json:"content"`
			}
			_ = json.Unmarshal(body["input"], &input)
			var source struct {
				Digest string `json:"source_digest"`
			}
			_ = json.Unmarshal([]byte(input[len(input)-1].Content), &source)
			s := CompactSummary{SourceDigest: source.Digest, Goals: []string{strings.Repeat("needlessly verbose summary ", 2200)}, Constraints: []string{}, Decisions: []string{}, Progress: []string{}, CriticalFacts: []string{}, OpenTasks: []string{}, NextSteps: []string{}, Uncertainties: []string{}}
			fixtureAnswer(w, "larger-summary", string(rawJSON(s)), nil)
			return
		}
		if calls.Add(1) == 1 {
			fixtureAnswer(w, "one-exchange", "", []any{
				map[string]any{"type": "message", "id": "progress", "role": "assistant", "status": "completed", "content": []any{map[string]any{"type": "output_text", "text": strings.Repeat("original observation ", 1800)}}},
				map[string]any{"type": "function_call", "id": "fc-once", "call_id": "once", "name": "apply_patch", "arguments": string(rawJSON(map[string]any{"patch": "*** Begin Patch\n*** Add File: exact.txt\n+ORIGINAL_REMAINS\n*** End Patch"}))},
			})
			return
		}
		if !strings.Contains(string(body["input"]), "ORIGINAL_REMAINS") || strings.Contains(string(body["input"]), "needlessly verbose summary") {
			t.Error("exact context replaced by larger summary")
		}
		fixtureAnswer(w, "finish-exact", "FINISHED", nil)
	})
	s, err := Load(m.config)
	if err != nil {
		t.Fatal(err)
	}
	s.ContextWorkingTokens, s.CompactPercent = 8192, 75
	setTestProfileCompact(s, 6144)
	if err = s.Save(); err != nil {
		t.Fatal(err)
	}
	r, err := m.Create(context.Background(), testMatrixOwner, AgentSpec{RequestID: "non-reducing", ModelID: "local-model", Task: "create exact.txt once then finish", Prompt: "Use tools", Workdir: dir, Tools: []string{"apply_patch"}, MaxRequests: 4, MaxTokens: 500000})
	if err != nil {
		t.Fatal(err)
	}
	r, err = m.Wait(context.Background(), testMatrixOwner, r.ID, 25000)
	if err != nil || r.State != "completed" || compactions.Load() != 1 || calls.Load() != 2 || r.Compression != nil {
		t.Fatalf("state=%s error=%s compactions=%d calls=%d %v", r.State, r.Error, compactions.Load(), calls.Load(), err)
	}
	if b, e := os.ReadFile(filepath.Join(dir, "exact.txt")); e != nil || string(b) != "ORIGINAL_REMAINS\n" {
		t.Fatal(e, string(b))
	}
}

func TestCompactionSavingExcludesExactTaskAndPlan(t *testing.T) {
	user := Message{Role: RoleUser, Content: strings.Repeat("must preserve instruction ", 700)}
	messages := []Message{user, {Role: RoleAssistant, Content: "read complete"}}
	if compactSourceTokens(nil, messages)-compactRequiredTokens(nil, messages, nil) > 2048 {
		t.Fatal("exact task counted as compressible history")
	}
	previous := &Checkpoint{LastUser: user.Content, Summary: CompactSummary{Goals: []string{"continue"}}}
	if compactSourceTokens(previous, messages) <= compactSourceTokens(nil, messages) {
		t.Fatal("previous checkpoint omitted")
	}
}

func TestFailedCompactionRetainsExactContextAndCanFinish(t *testing.T) {
	var calls, compactions atomic.Int32
	m, dir := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
		var body map[string]json.RawMessage
		_ = json.NewDecoder(r.Body).Decode(&body)
		if len(body["tools"]) == 0 {
			compactions.Add(1)
			fixtureAnswer(w, "bad-summary", "not a valid checkpoint", nil)
			return
		}
		if calls.Add(1) == 1 {
			fixtureAnswer(w, "evidence-once", "", []any{
				map[string]any{"type": "message", "id": "observation", "role": "assistant", "status": "completed", "content": []any{map[string]any{"type": "output_text", "text": strings.Repeat("original observation ", 1800)}}},
				map[string]any{"type": "function_call", "id": "fc-evidence", "call_id": "evidence-once", "name": "apply_patch", "arguments": string(rawJSON(map[string]any{"patch": "*** Begin Patch\n*** Add File: preserved.txt\n+EXACT_CONTEXT_REMAINS\n*** End Patch"}))},
			})
			return
		}
		if !strings.Contains(string(body["input"]), "EXACT_CONTEXT_REMAINS") || strings.Contains(string(body["input"]), "not a valid checkpoint") {
			t.Error("错误摘要替换了原上下文")
		}
		fixtureAnswer(w, "finish", "FINISHED", nil)
	})
	s, err := Load(m.config)
	if err != nil {
		t.Fatal(err)
	}
	s.ContextWorkingTokens, s.CompactPercent = 8192, 75
	setTestProfileCompact(s, 6144)
	if err = s.Save(); err != nil {
		t.Fatal(err)
	}
	r, err := m.Create(context.Background(), testMatrixOwner, AgentSpec{RequestID: "failed-summary", ModelID: "local-model", Task: "create preserved.txt once then finish", Prompt: "Use tools", Workdir: dir, Tools: []string{"apply_patch"}, MaxRequests: 5, MaxTokens: 500000})
	if err != nil {
		t.Fatal(err)
	}
	r, err = m.Wait(context.Background(), testMatrixOwner, r.ID, 25000)
	if err != nil || r.State != "completed" || compactions.Load() != 1 || calls.Load() != 2 || r.Compression != nil {
		t.Fatalf("state=%s error=%s compactions=%d calls=%d %v", r.State, r.Error, compactions.Load(), calls.Load(), err)
	}
	if b, e := os.ReadFile(filepath.Join(dir, "preserved.txt")); e != nil || string(b) != "EXACT_CONTEXT_REMAINS\n" {
		t.Fatal(e, string(b))
	}
	archive, restored, err := RestoreSession(filepath.Join(m.dir, "config.json"), r.ID)
	if err != nil {
		t.Fatal(err)
	}
	defer archive.Close()
	if len(restored.Messages) == 0 {
		t.Fatal("容错回执阻止原会话恢复")
	}
	file, _ := SessionPath(filepath.Join(m.dir, "config.json"), r.ID)
	b, err := os.ReadFile(file)
	if err != nil || !strings.Contains(string(b), "compaction_deferred") {
		t.Fatal("压缩失败证据丢失", err)
	}
}

func TestExplicitProviderRejectionDuringCompactionStopsWithoutBypass(t *testing.T) {
	var calls, compactions atomic.Int32
	m, dir := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
		var body map[string]json.RawMessage
		_ = json.NewDecoder(r.Body).Decode(&body)
		if len(body["tools"]) == 0 {
			compactions.Add(1)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusForbidden)
			_, _ = w.Write([]byte(`{"error":{"code":"content_policy_violation","message":"explicit provider refusal"}}`))
			return
		}
		calls.Add(1)
		fixtureAnswer(w, "evidence-once", "", []any{
			map[string]any{"type": "message", "id": "observation", "role": "assistant", "status": "completed", "content": []any{map[string]any{"type": "output_text", "text": strings.Repeat("original observation ", 1800)}}},
			map[string]any{"type": "function_call", "id": "fc-evidence", "call_id": "evidence-once", "name": "apply_patch", "arguments": string(rawJSON(map[string]any{"patch": "*** Begin Patch\n*** Add File: preserved.txt\n+KEPT_BEFORE_REJECTION\n*** End Patch"}))},
		})
	})
	s, err := Load(m.config)
	if err != nil {
		t.Fatal(err)
	}
	s.ContextWorkingTokens, s.CompactPercent = 8192, 75
	setTestProfileCompact(s, 6144)
	if err = s.Save(); err != nil {
		t.Fatal(err)
	}
	r, err := m.Create(context.Background(), testMatrixOwner, AgentSpec{RequestID: "refused-summary", ModelID: "local-model", Task: "create preserved.txt then finish", Prompt: "Use tools", Workdir: dir, Tools: []string{"apply_patch"}, MaxRequests: 5, MaxTokens: 500000})
	if err != nil {
		t.Fatal(err)
	}
	r, err = m.Wait(context.Background(), testMatrixOwner, r.ID, 25000)
	if err != nil || r.State != "failed" || compactions.Load() != 1 || calls.Load() != 1 || r.Failure == nil || r.Failure.Code != "provider_blocked" {
		t.Fatalf("rejection bypassed: state=%s error=%s compactions=%d calls=%d failure=%+v %v", r.State, r.Error, compactions.Load(), calls.Load(), r.Failure, err)
	}
	if b, e := os.ReadFile(filepath.Join(dir, "preserved.txt")); e != nil || string(b) != "KEPT_BEFORE_REJECTION\n" {
		t.Fatal(e, string(b))
	}
}

func TestCompactionCooldownRetainsRecentEvidenceWithoutExceedingModel(t *testing.T) {
	b := ContextBudget{Window: 131072, Output: 8192, Working: 25000, Percent: 80}
	retry := b.CompactionRetryAfter(3500)
	if b.CompactionReady(6500, 1000, retry, 27000) {
		t.Fatal("three thousand new tokens should not immediately re-summarize evidence")
	}
	if !b.CompactionReady(11000, 1000, retry, 32000) {
		t.Fatal("substantial new history never became eligible")
	}
	if !b.CompactionReady(6500, 1000, retry, b.InputLimit()-1000) {
		t.Fatal("cooldown prevented useful compression near the hard model limit")
	}
	if b.CompactionReady(1500, 1000, retry, b.InputLimit()) {
		t.Fatal("hard pressure must not treat required instructions as compressible")
	}
	if b.CompactionRetryAfter(0) < 4096 || (ContextBudget{Window: 1000000, Working: 900000}).CompactionRetryAfter(0) > 8192 {
		t.Fatal("unbounded cooldown")
	}
	conv := []Message{{Role: RoleUser, Content: "fix and verify"},
		{Role: RoleAssistant, ToolCalls: []ToolCall{{ID: "first"}}}, {Role: RoleTool, ToolCallID: "first", Content: "read source"},
		{Role: RoleAssistant, ToolCalls: []ToolCall{{ID: "second"}}}, {Role: RoleTool, ToolCallID: "second", Content: "receipt_key: actual-current-check"}}
	cut := CompactWorkCut(conv, 4, false)
	if cut != 3 || !strings.Contains(conv[cut+1].Content, "actual-current-check") {
		t.Fatal("ordinary working-budget pressure discarded the latest exact evidence")
	}
}

func TestArchiveRecallReadsBoundedRecentPages(t *testing.T) {
	f := filepath.Join(t.TempDir(), "archive.jsonl")
	a := &SessionArchive{Path: f}
	for i := 0; i < 30; i++ {
		if e := a.Append("message", Message{Role: RoleUser, Content: fmt.Sprintf("marker-%02d", i)}); e != nil {
			t.Fatal(e)
		}
	}
	ctx := context.WithValue(context.Background(), archiveMemoryKey{}, f)
	cursor := ""
	seen := map[string]bool{}
	for i := 0; i < 10; i++ {
		r := recallArchive(ctx, map[string]any{"query": "marker-", "limit": float64(4), "cursor": cursor}).(map[string]any)
		if r["ok"] != true {
			t.Fatal(r)
		}
		for _, v := range r["records"].([]map[string]any) {
			text := v["excerpt"].(string)
			if seen[text] {
				t.Fatal("repeat", text)
			}
			seen[text] = true
		}
		if r["next_cursor"] == nil {
			break
		}
		cursor = r["next_cursor"].(string)
	}
	if len(seen) != 30 {
		t.Fatalf("retrieved %d", len(seen))
	}
}
func TestCompactWithinToolLoopRetainsUserAndDoesNotSplitPendingCalls(t *testing.T) {
	user := Message{Role: RoleUser, Content: "Keep the original files and finish all three tasks."}
	call := func(id string) Message {
		return Message{Role: RoleAssistant, ToolCalls: []ToolCall{{ID: id, Function: FunctionCall{Name: "memory", Arguments: `{"action":"status"}`}}}}
	}
	result := func(id string) Message { return Message{Role: RoleTool, ToolCallID: id, Content: "completed"} }
	messages := []Message{user, call("a"), result("a"), call("b")}
	if cut := CompactWorkCut(messages, 4, true); cut != 3 {
		t.Fatalf("unsafe cut %d", cut)
	}
	cp, e := Compact(context.Background(), nil, messages[:3], func(_ context.Context, req []Message) (Message, string, error) {
		var input struct {
			Digest string `json:"source_digest"`
		}
		_ = json.Unmarshal([]byte(req[1].Content), &input)
		s := CompactSummary{SourceDigest: input.Digest, Goals: []string{"finish three tasks"}, Constraints: []string{}, Decisions: []string{}, Progress: []string{}, CriticalFacts: []string{}, OpenTasks: []string{}, NextSteps: []string{}, Uncertainties: []string{}}
		return Message{Content: string(rawJSON(s))}, "stop", nil
	})
	if e != nil {
		t.Fatal(e)
	}
	if cp.LastUser != user.Content || cp.Covered != 3 || !strings.Contains(cp.Message().Content, user.Content) {
		t.Fatalf("user lost: %+v", cp)
	}
}
func TestAstraMigrationAndStatelessToolReasoning(t *testing.T) {
	p := APIProfile{Model: "gpt-6-astra", Protocol: ProtocolResponses, ContextWindow: 8192, ContextWindowSource: "conservative_client_budget"}
	upgradeKnownProfile(&p)
	if p.ContextWindow != 1050000 || len(p.ParameterSpecs) != 2 || p.ParameterSpecs[1].Key != "service_tier" {
		t.Fatalf("%+v", p)
	}
	s := Defaults()
	s.Adapter = "openai"
	s.Model = p.Model
	s.ModelOptions = map[string]any{"reasoning_effort": "high"}
	r := BuildResponsesRequest(s, nil, true, []ToolDefinition{MemoryToolDefinition()})
	if len(r.Include) != 1 || r.Include[0] != "reasoning.encrypted_content" || r.Store {
		t.Fatalf("stateless reasoning missing")
	}
}

func TestGPTFastUsesWireTierAndExplicitDefault(t *testing.T) {
	for _, protocol := range []string{ProtocolResponses, ProtocolChat} {
		for _, tier := range []string{"fast", "default"} {
			s := Defaults()
			s.Adapter, s.APIProtocol, s.Model = "openai", protocol, "gpt-6-astra"
			s.ModelOptions = map[string]any{"service_tier": tier, "reasoning_effort": "high"}
			body := map[string]any{}
			genericOptions(s, body)
			if body["service_tier"] != tier {
				t.Fatalf("%s: %+v", protocol, body)
			}
		}
	}
}

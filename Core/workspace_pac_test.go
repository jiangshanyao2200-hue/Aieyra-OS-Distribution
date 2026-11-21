// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestPACMainLoopSealsBeforeReplyAndRetainsOriginal; TestPACSealReceiptObservationBoundsAndRedaction; TestPACSealRejectsMixedBatchAndPartialToolGroup; TestPACMainLoopFailedSealKeepsOriginal; TestPACRecoveryVerifiesOriginalBeforeAdvancing; TestPACProfileCorrectionDoesNotChangePacketPrefix; TestPACWorkingBudgetUsesConfiguredTargetAndRespectsDisabledCompaction; TestPACBudgetMatchesModelTargetAndSafetyCeiling; TestPACMainLoopSeesExternalPreferenceCorrectionAtNextRequest; TestPACMainLoopMergesHierarchyAtThreshold
// Impact: python -B scripts/code-atlas.py show Core/workspace_pac_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
)

func TestPACMainLoopSealsBeforeReplyAndRetainsOriginal(t *testing.T) {
	var calls atomic.Int32
	var stablePrefix []json.RawMessage
	var reportOutput string
	const summary = "阶段A已完成验证；阶段B仍待用户确认，保留琥珀色偏好。"
	const marker = "RAW_STAGED_MARKER"
	m, dir := matrixTestManager(t, func(rw http.ResponseWriter, r *http.Request) {
		var body map[string]json.RawMessage
		_ = json.NewDecoder(r.Body).Decode(&body)
		input := string(body["input"])
		switch calls.Add(1) {
		case 1:
			fixtureAnswer(rw, "work", "", []any{
				map[string]any{"type": "message", "id": "work-msg", "role": "assistant", "status": "completed", "content": []any{map[string]any{"type": "output_text", "text": marker + strings.Repeat("工作记录 ", 1000)}}},
				map[string]any{"type": "function_call", "id": "fc-work", "call_id": "call-work", "name": "report", "arguments": string(rawJSON(map[string]any{"action": "report", "format": "md", "title": "pac-evidence.txt", "content": "verified\n"}))},
			})
		case 2:
			var items []json.RawMessage
			if err := json.Unmarshal(body["input"], &items); err != nil {
				t.Error(err)
			}
			for _, item := range items {
				var message struct{ Role string }
				if json.Unmarshal(item, &message) != nil || (message.Role != "system" && message.Role != "developer") {
					break
				}
				stablePrefix = append(stablePrefix, item)
			}
			if len(stablePrefix) == 0 {
				t.Error("seal request is missing its stable instruction prefix")
			}
			if !strings.Contains(input, marker) {
				t.Error("work disappeared before seal")
			}
			for _, raw := range items {
				var item struct {
					CallID string `json:"call_id"`
					Output string `json:"output"`
				}
				if json.Unmarshal(raw, &item) == nil && item.CallID == "call-work" && item.Output != "" {
					reportOutput = item.Output
				}
			}
			if reportOutput == "" {
				t.Error("original report tool result missing")
			}
			fixtureAnswer(rw, "seal", "", []any{map[string]any{"type": "function_call", "id": "fc-seal", "call_id": "call-seal", "name": "memory", "arguments": string(rawJSON(map[string]any{"action": "seal", "title": "阶段A", "keywords": "阶段A 琥珀色", "content": summary}))}})
		case 3:
			var items []json.RawMessage
			if err := json.Unmarshal(body["input"], &items); err != nil {
				t.Error(err)
			}
			for i, previous := range stablePrefix {
				if i >= len(items) || string(items[i]) != string(previous) {
					t.Errorf("seal changed fixed instruction at input item %d", i)
					break
				}
			}
			if strings.Contains(input, marker) || !strings.Contains(input, summary) || !strings.Contains(input, "pac_id") {
				t.Errorf("next request: old=%v summary=%v checkpoint=%v", strings.Contains(input, marker), strings.Contains(input, summary), strings.Contains(input, "pac_id"))
			}
			if strings.Contains(string(body["tools"]), "ask_subconscious") || strings.Contains(string(body["tools"]), "share_diary") {
				t.Error("retired tools exposed")
			}
			found := 0
			for _, raw := range items {
				var item struct {
					CallID  string `json:"call_id"`
					Content string `json:"content"`
				}
				_ = json.Unmarshal(raw, &item)
				if item.CallID == "call-work" {
					t.Error("archived tool group was repeated on the wire")
				}
				if _, data, ok := strings.Cut(item.Content, "section: sealed_tool_receipts\n"); ok {
					found++
					var evidence struct {
						PACID   string `json:"pac_id"`
						Results []struct {
							Tool   string `json:"tool"`
							CallID string `json:"call_id"`
							Output string `json:"output"`
						} `json:"results"`
					}
					if json.Unmarshal([]byte(data), &evidence) != nil || evidence.PACID == "" || len(evidence.Results) != 1 ||
						evidence.Results[0].Tool != "report" || evidence.Results[0].CallID != "call-work" || evidence.Results[0].Output != reportOutput {
						t.Error("first request after seal lost the exact current tool receipt")
					}
				}
			}
			if found != 1 {
				t.Errorf("sealed tool receipt appeared %d times", found)
			}
			fixtureAnswer(rw, "done", "阶段A完成，阶段B仍待确认。", nil)
		case 4:
			if strings.Contains(input, "sealed_tool_receipts") || strings.Contains(input, "call-work") {
				t.Error("a new user turn received the previous task's transient receipt")
			}
			fixtureAnswer(rw, "new", "新的工单已接收。", nil)
		default:
			t.Error("unexpected autonomous maintenance request")
			fixtureAnswer(rw, "unexpected", "停止。", nil)
		}
	})
	settings, loadErr := Load(m.config)
	if loadErr != nil {
		t.Fatal(loadErr)
	}
	setTestProfileCompact(settings, 0)
	if err := settings.Save(); err != nil {
		t.Fatal(err)
	}
	w := modeWorkspace(t, m.config, dir, HostOS)
	w.service = NewSettingsService(m.config)
	t.Cleanup(w.service.Close)
	w.mu.Lock()
	r, err := w.dispatchLocked(WorkspaceMatrix, workspaceID(), "完成阶段A并封存，阶段B保持未完成")
	w.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	r, err = w.manager.Wait(context.Background(), w.state.ID, r.ID, 25000)
	if err != nil || r.State != "completed" || calls.Load() != 3 {
		t.Fatalf("run failed: %s %s calls=%d err=%v", r.State, r.Error, calls.Load(), err)
	}
	snap, err := w.readPAC(context.Background())
	if err != nil || len(snap.Packets) != 1 || snap.Packets[0].Content != summary {
		t.Fatalf("PAC missing: %+v %v", snap, err)
	}
	_, saved := workspaceCompactArchive(t, w, r.ID)
	position := -1
	for i, message := range saved.Messages {
		if message.Role == RoleAssistant && strings.Contains(message.Content, marker) {
			position = i
			break
		}
	}
	if position < 0 {
		t.Fatal("original assistant message missing from archive")
	}
	original, err := memoryResult(w.memory(context.Background(), map[string]any{"action": "pac_original", "id": snap.Packets[0].ID, "cursor": fmt.Sprintf("%d:0", position), "limit_chars": 8000}))
	if err != nil || !strings.Contains(memString(original["content"]), marker) || original["format"] != "message_json" {
		t.Fatalf("original not durable: %v %v", original, err)
	}
	if r.Compression == nil || r.Compression.AfterTokens >= r.Compression.BeforeTokens {
		t.Fatal("missing effective compression", r.Compression)
	}
	activity, err := w.manager.Activity(w.state.ID, r.ID, 0, 0, 120)
	if err != nil {
		t.Fatal(err)
	}
	var page struct {
		Items []AgentActivity `json:"items"`
	}
	if err = json.Unmarshal(rawJSON(activity), &page); err != nil {
		t.Fatal(err)
	}
	found := false
	for _, item := range page.Items {
		if item.Tool != "memory" || item.Action != "seal" {
			continue
		}
		var receipt struct {
			Compression  ContextCompression `json:"compression"`
			NewlyCovered int                `json:"newly_covered_messages"`
			Originals    bool               `json:"originals_preserved"`
		}
		if json.Unmarshal(item.Preview, &receipt) != nil || receipt.Compression != *r.Compression || receipt.NewlyCovered < 1 || !receipt.Originals {
			t.Fatalf("incomplete visible seal receipt: %s", item.Preview)
		}
		if !strings.Contains(string(item.InputPreview), summary) {
			t.Fatal("stage summary missing from display projection")
		}
		if strings.Contains(string(item.Preview), summary) {
			t.Fatal("summary duplicated into model result")
		}
		found = true
	}
	if !found {
		t.Fatal("seal activity missing")
	}
	for _, message := range saved.Messages {
		if message.Name == "sealed_tool_receipts" {
			t.Fatal("transient receipt was copied into the archive")
		}
	}
	w.mu.Lock()
	next, err := w.dispatchLocked(WorkspaceMatrix, workspaceID(), "开始另一项独立工单")
	w.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	next, err = w.manager.Wait(context.Background(), w.state.ID, next.ID, 25000)
	if err != nil || next.State != "completed" || calls.Load() != 4 {
		t.Fatalf("new user turn failed: %s %s calls=%d err=%v", next.State, next.Error, calls.Load(), err)
	}
}

func TestPACSealReceiptObservationBoundsAndRedaction(t *testing.T) {
	cp := &Checkpoint{Packet: "pac_fixture", Compression: &ContextCompression{BeforeTokens: 8000, AfterTokens: 150}}
	messages := []Message{
		{Role: RoleTool, Name: "terminal", ToolCallID: "first", Content: "expired output"},
		{Role: RoleTool, Name: "terminal", ToolCallID: "read", Content: "read proof"},
		{Role: RoleTool, Name: "apply_patch", ToolCallID: "patch", Content: "wrote proof"},
		{Role: RoleTool, Name: "terminal", ToolCallID: "verify", Content: "verified with SECRET_FIXTURE"},
		{Role: RoleTool, Name: "terminal", ToolCallID: "large", Content: strings.Repeat("large output ", 450)},
		{Role: RoleTool, Name: "memory", ToolCallID: "lookup", Content: "memory output"},
	}
	redact := func(s string) string { return strings.ReplaceAll(s, "SECRET_FIXTURE", "[redacted]") }
	result := pacSealReceiptObservation(cp, messages, redact)
	var payload struct {
		Results []struct {
			CallID string `json:"call_id"`
			Output string `json:"output"`
		} `json:"results"`
	}
	if !result.ContextObservation || len(result.Content) > 4096 || json.Unmarshal([]byte(result.Content), &payload) != nil || len(payload.Results) != 3 {
		t.Fatalf("invalid receipt observation: %s", result.Content)
	}
	if payload.Results[0].CallID != "read" || payload.Results[1].CallID != "patch" || payload.Results[2].CallID != "verify" || payload.Results[2].Output != "verified with [redacted]" {
		t.Fatalf("wrong receipt selection or redaction: %+v", payload.Results)
	}
	cp.Compression.BeforeTokens = cp.Compression.AfterTokens + 1
	if out := pacSealReceiptObservation(cp, messages, redact); out.Content != "" {
		t.Fatal("optional tool receipts consumed the whole compression saving")
	}
}

func TestPACSealRejectsMixedBatchAndPartialToolGroup(t *testing.T) {
	w := &Workspace{}
	b := &pacBoundary{workspace: w, exclusive: false}
	ctx := context.WithValue(context.Background(), pacBoundaryKey{}, b)
	if _, err := w.pacTool(ctx, memoryRow{"action": "seal", "title": "unsafe", "content": "不能与其它工具同时封存"}); err == nil || b.checkpoint != nil {
		t.Fatal("mixed batch accepted")
	}
	call := ToolCall{ID: "a"}
	if pacCompleteRange([]Message{{Role: RoleAssistant, ToolCalls: []ToolCall{call}}}) {
		t.Fatal("pending tool accepted")
	}
	if pacCompleteRange([]Message{{Role: RoleTool, ToolCallID: "a"}}) {
		t.Fatal("orphan receipt accepted")
	}
	if !pacCompleteRange([]Message{{Role: RoleAssistant, ToolCalls: []ToolCall{call}}, {Role: RoleTool, ToolCallID: "a", Content: "done"}}) {
		t.Fatal("complete group rejected")
	}
}

func TestPACMainLoopFailedSealKeepsOriginal(t *testing.T) {
	var calls atomic.Int32
	const original = "DO_NOT_DISCARD_THIS_UNFINISHED_WORK"
	m, dir := matrixTestManager(t, func(rw http.ResponseWriter, r *http.Request) {
		var body map[string]json.RawMessage
		_ = json.NewDecoder(r.Body).Decode(&body)
		switch calls.Add(1) {
		case 1:
			fixtureAnswer(rw, "bad-seal", "", []any{map[string]any{"type": "function_call", "id": "fc-seal", "call_id": "call-seal", "name": "memory", "arguments": string(rawJSON(map[string]any{"action": "seal", "title": "阶段", "content": ""}))}})
		default:
			if !strings.Contains(string(body["input"]), original) {
				t.Error("failed seal discarded original")
			}
			fixtureAnswer(rw, "done", "原文保留，任务仍未完成。", nil)
		}
	})
	w := modeWorkspace(t, m.config, dir, HostOS)
	w.service = NewSettingsService(m.config)
	t.Cleanup(w.service.Close)
	w.mu.Lock()
	r, err := w.dispatchLocked(WorkspaceMatrix, workspaceID(), original)
	w.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	r, err = w.manager.Wait(context.Background(), w.state.ID, r.ID, 15000)
	if err != nil || r.State != "completed" || r.Compression != nil {
		t.Fatalf("failure fallback: %+v %v", r, err)
	}
	snap, err := w.readPAC(context.Background())
	if err != nil || len(snap.Packets) != 0 {
		t.Fatal("failed seal created packet", snap, err)
	}
}

func TestPACRecoveryVerifiesOriginalBeforeAdvancing(t *testing.T) {
	m, dir := matrixTestManager(t, func(rw http.ResponseWriter, r *http.Request) { t.Error("recovery must not call a model") })
	w := modeWorkspace(t, m.config, dir, HostOS)
	w.service = NewSettingsService(m.config)
	t.Cleanup(w.service.Close)
	ctx := context.Background()
	history := []Message{{Role: RoleUser, Content: "完成A，保留B未完成"}, {Role: RoleAssistant, Content: "A已验证，B未完成"}}
	id, err := w.sealPAC(ctx, "agent", history, 0, 2, "阶段A", "A已完成验证；B仍未完成。", "阶段A")
	if err != nil {
		t.Fatal(err)
	}
	// Simulate a durable memory commit followed by a missing archive checkpoint.
	cp, err := w.recoverPAC(ctx, "agent", history, nil, nil)
	if err != nil || cp == nil || cp.Packet != id || cp.Covered != 2 || cp.LastUser != history[0].Content {
		t.Fatal("recovery missing", cp, err)
	}
	changed := append([]Message(nil), history...)
	changed[1].Content = "different history"
	if cp, err = w.recoverPAC(ctx, "agent", changed, nil, nil); err == nil || cp != nil {
		t.Fatal("recovery applied to changed original", cp, err)
	}
}

func TestPACProfileCorrectionDoesNotChangePacketPrefix(t *testing.T) {
	s := pacTestStore(t)
	r := memoryCall(t, s, memoryRow{"action": "record", "kind": "preference", "title": "颜色", "content": "琥珀色", "request_id": "color"}, "project:a", "test")["record"].(memoryRow)
	pacTestTranscript(t, s, "project:a", "color-history", []Message{{Role: RoleUser, Content: "阶段A"}, {Role: RoleAssistant, Content: "完成阶段A"}})
	pacTestSeal(t, s, "project:a", "color-history", "A", "阶段A完成。", 0, 1)
	read := func() pacSnapshot {
		var snap pacSnapshot
		json.Unmarshal(rawJSON(memoryCall(t, s, memoryRow{"action": "pac_snapshot"}, "project:a", "test")), &snap)
		return snap
	}
	before := read()
	memoryCall(t, s, memoryRow{"action": "update", "id": r["id"], "expected_revision": 1, "content": "改为蓝色，旧琥珀色偏好失效"}, "project:a", "test")
	after := read()
	if renderPAC(before, 10000) != renderPAC(after, 10000) {
		t.Fatal("profile correction rewrote stable PAC prefix")
	}
	profile := renderPACProfile(after)
	if !strings.Contains(profile, "改为蓝色") || len(after.Profile) != 1 {
		t.Fatal("current preference missing or duplicated", profile)
	}
	// 连续多个通用「工作上下文检查点」最多展开最近 2 个正文，保留更早的具名阶段里程碑记忆不被挤出。
	mixedSnap := pacSnapshot{
		Packets: []pacPacket{
			{ID: "pac_milestone", Title: "重要里程碑阶段", Content: "MILESTONE_BODY_KEEP"},
			{ID: "pac_cp1", Title: "工作上下文检查点", Content: "CP1_OLD_SKIP"},
			{ID: "pac_cp2", Title: "工作上下文检查点", Content: "CP2_RECENT_KEEP"},
			{ID: "pac_cp3", Title: "工作上下文检查点", Content: "CP3_LATEST_KEEP"},
		},
	}
	rendered := renderPAC(mixedSnap, 10000)
	if !strings.Contains(rendered, "MILESTONE_BODY_KEEP") || !strings.Contains(rendered, "CP2_RECENT_KEEP") || !strings.Contains(rendered, "CP3_LATEST_KEEP") {
		t.Fatalf("expected milestone and latest 2 checkpoints in rendered PAC: %s", rendered)
	}
	if strings.Contains(rendered, "CP1_OLD_SKIP") || !strings.Contains(rendered, "pac_cp1 | 工作上下文检查点") {
		t.Fatalf("expected older checkpoint body skipped while keeping index entry: %s", rendered)
	}
}

func TestPACWorkingBudgetUsesConfiguredTargetAndRespectsDisabledCompaction(t *testing.T) {
	s := &Settings{Model: "qwen3-max", ContextWorkingTokens: 200000, CompactPercent: 80}
	b := pacContextBudget(s)
	if b.Working != 200000 || s.ContextWorkingTokens != 200000 {
		t.Fatal("working budget or persistent settings changed", b)
	}
	zero := 0
	s.CompactAtTokens = &zero
	if b = pacContextBudget(s); b.Percent != 0 {
		t.Fatal("explicit disable ignored", b)
	}
}

func TestPACBudgetMatchesModelTargetAndSafetyCeiling(t *testing.T) {
	for _, model := range []string{"grok-4.7-build-fast", "gemini-4-argon"} {
		for _, target := range []int{0, 20000, 200000, 205000, 2000000} {
			s := nativeModelConfigFixture(model, ProtocolResponses, nil)
			s.APIProfiles[0].CompactAtTokens = catalogInt(target)
			s.applyPoolProfile()
			ordinary, pac := s.ContextBudget(), pacContextBudget(s)
			if ordinary != pac {
				t.Fatalf("PAC changed %s target %d: ordinary=%+v PAC=%+v", model, target, ordinary, pac)
			}
			if target == 200000 && pac.Threshold() != 160000 {
				t.Fatalf("200K must prepare at 160K: %+v", pac)
			}
			if target == 205000 && pac.Threshold() != 164000 {
				t.Fatalf("205K must prepare at 164K: %+v", pac)
			}
			if target > 0 && pac.Threshold() > pac.InputLimit()*80/100 {
				t.Fatal("safety input ceiling bypassed")
			}
			if target == 0 && pac.Threshold() != 0 {
				t.Fatal("explicit compaction disable ignored")
			}
		}
	}
}

func TestPACMainLoopSeesExternalPreferenceCorrectionAtNextRequest(t *testing.T) {
	var w *Workspace
	var preferenceID string
	var calls atomic.Int32
	m, dir := matrixTestManager(t, func(rw http.ResponseWriter, r *http.Request) {
		var body map[string]json.RawMessage
		_ = json.NewDecoder(r.Body).Decode(&body)
		input := string(body["input"])
		if !strings.Contains(input, "PACKET_STABLE_MARKER") {
			t.Error("packet prefix disappeared")
		}
		if calls.Add(1) == 1 {
			if !strings.Contains(input, "OLD_PROFILE_COLOR") {
				t.Error("initial preference missing")
			}
			if _, err := memoryResult(w.memory(context.Background(), map[string]any{"action": "update", "id": preferenceID, "expected_revision": 1, "content": "NEW_PROFILE_COLOR"})); err != nil {
				t.Error(err)
			}
			fixtureAnswer(rw, "patch", "", []any{map[string]any{"type": "function_call", "id": "patch", "call_id": "patch", "name": "report", "arguments": string(rawJSON(map[string]any{"action": "report", "format": "md", "title": "correction.txt", "content": "verified\n"}))}})
		} else {
			var items []struct {
				Content string `json:"content"`
			}
			if err := json.Unmarshal(body["input"], &items); err != nil {
				t.Error(err)
			}
			current := ""
			// Provider requests carry the host section in text; internal Message.Name
			// is not a wire field. Select the latest explicit profile observation.
			const profileSection = "[Aieyra runtime context]\nsection: current_memory_profile\n"
			for _, item := range items {
				if strings.HasPrefix(item.Content, profileSection) {
					current = strings.TrimPrefix(item.Content, profileSection)
				}
			}
			if !strings.HasPrefix(current, runtimePrompt("Matrix/记忆/当前偏好.txt")) || !strings.Contains(current, "NEW_PROFILE_COLOR") || strings.Contains(current, "OLD_PROFILE_COLOR") {
				t.Error("external correction stale in the latest profile observation")
			}
			if !strings.Contains(input, "OLD_PROFILE_COLOR") {
				t.Error("correction rewrote an already submitted historical snapshot")
			}
			fixtureAnswer(rw, "done", "完成。", nil)
		}
	})
	w = modeWorkspace(t, m.config, dir, HostOS)
	w.service = NewSettingsService(m.config)
	t.Cleanup(w.service.Close)
	ctx := context.Background()
	rec, err := memoryResult(w.memory(ctx, map[string]any{"action": "record", "kind": "preference", "title": "当前颜色", "content": "OLD_PROFILE_COLOR", "request_id": "seed-profile"}))
	if err != nil {
		t.Fatal(err)
	}
	preferenceID = memString(rec["record"].(map[string]any)["id"])
	_, err = w.sealPAC(ctx, "archived", []Message{{Role: RoleUser, Content: "过去"}, {Role: RoleAssistant, Content: "已验证"}}, 0, 2, "过去阶段", "PACKET_STABLE_MARKER", "过去")
	if err != nil {
		t.Fatal(err)
	}
	w.mu.Lock()
	run, err := w.dispatchLocked(WorkspaceMatrix, workspaceID(), "继续任务")
	w.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	run, err = w.manager.Wait(ctx, w.state.ID, run.ID, 15000)
	if err != nil || run.State != "completed" || calls.Load() != 2 {
		t.Fatal(run.State, run.Error, err)
	}
}

func TestPACMainLoopMergesHierarchyAtThreshold(t *testing.T) {
	var calls atomic.Int32
	var summaries atomic.Int32
	var children []string
	var version int64
	m, dir := matrixTestManager(t, func(rw http.ResponseWriter, r *http.Request) {
		var body map[string]json.RawMessage
		_ = json.NewDecoder(r.Body).Decode(&body)
		if strings.Contains(string(body["input"]), "【工作上下文封存】") {
			summaries.Add(1)
			fixtureAnswer(rw, "summary", "准备合并旧阶段A和B；合并前读取最新目录版本，C保持未完成。", nil)
			return
		}
		switch calls.Add(1) {
		case 1:
			if !strings.Contains(string(body["input"]), "PAC根摘要已超过合并阈值") {
				t.Error("merge boundary not surfaced")
			}
			fixtureAnswer(rw, "prepare", "", []any{map[string]any{"type": "message", "id": "progress", "role": "assistant", "status": "completed", "content": []any{map[string]any{"type": "output_text", "text": strings.Repeat("已核实的阶段进展；", 2000)}}}, map[string]any{"type": "function_call", "id": "fc-compact", "call_id": "compact", "name": "memory", "arguments": `{"action":"compact","purpose":"memory_edit"}`}})
		case 2:
			fixtureAnswer(rw, "snapshot", "", []any{map[string]any{"type": "function_call", "id": "fc-snapshot", "call_id": "snapshot", "name": "memory", "arguments": `{"action":"snapshot"}`}})
		case 3:
			var input []struct {
				Type   string `json:"type"`
				Output string `json:"output"`
			}
			_ = json.Unmarshal(body["input"], &input)
			for _, item := range input {
				if item.Type == "function_call_output" {
					var out struct {
						Version int64 `json:"version"`
					}
					_ = json.Unmarshal([]byte(item.Output), &out)
					if out.Version > 0 {
						version = out.Version
					}
				}
			}
			fixtureAnswer(rw, "merge", "", []any{map[string]any{"type": "function_call", "id": "fc-merge", "call_id": "call-merge", "name": "memory", "arguments": string(rawJSON(map[string]any{"action": "merge", "title": "阶段AB", "content": "A和B验证完成，后续C仍待执行。", "keywords": "A B C", "children": children, "expected_version": version, "request_id": "merge-AB"}))}})
		default:
			if !strings.Contains(string(body["input"]), "A和B验证完成，后续C仍待执行。") {
				t.Error("merged root not used by next request")
			}
			fixtureAnswer(rw, "done", "已有阶段已封存。", nil)
		}
	})
	settings, loadErr := Load(m.config)
	if loadErr != nil {
		t.Fatal(loadErr)
	}
	setTestProfileCompact(settings, 0)
	if err := settings.Save(); err != nil {
		t.Fatal(err)
	}
	w := modeWorkspace(t, m.config, dir, HostOS)
	w.service = NewSettingsService(m.config)
	t.Cleanup(w.service.Close)
	ctx := context.Background()
	history := []Message{{Role: RoleUser, Content: "A"}, {Role: RoleAssistant, Content: "A已验证"}, {Role: RoleUser, Content: "B"}, {Role: RoleAssistant, Content: "B已验证"}}
	for i := 0; i < 2; i++ {
		id, err := w.sealPAC(ctx, "historic", history, i*2, i*2+2, "旧阶段", strings.Repeat("阶段核验结果保留；", 1500), "阶段 核验")
		if err != nil {
			t.Fatal(err)
		}
		children = append(children, id)
	}
	snap, err := w.readPAC(ctx)
	if err != nil || !snap.MergeRecommended {
		t.Fatal("merge fixture below threshold", snap, err)
	}
	version = snap.Version
	w.mu.Lock()
	r, err := w.dispatchLocked(WorkspaceMatrix, workspaceID(), "查看已有阶段，C仍保持未完成")
	w.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	r, err = w.manager.Wait(ctx, w.state.ID, r.ID, 15000)
	if err != nil || r.State != "completed" || calls.Load() != 4 || summaries.Load() != 1 {
		t.Fatal("merge run", r.State, r.Error, err)
	}
	snap, err = w.readPAC(ctx)
	parents := 0
	for _, p := range snap.Packets {
		if p.Level == 1 {
			parents++
		}
	}
	if err != nil || len(snap.Packets) != 2 || parents != 1 {
		t.Fatal("invalid parent", snap, err)
	}
	for _, id := range children {
		r, err := memoryResult(w.memory(ctx, map[string]any{"action": "pac_original", "id": id}))
		if err != nil || r["format"] != "message_json" {
			t.Fatal("merged child original lost", r, err)
		}
	}
}

// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestToolReceiptMemoryRedactionSizesMatchPagedPublicBytes; receiptAppend; receiptMeta; receiptIntent; receiptIndexed; receiptMap; TestToolReceiptUTF8IndependentPagesAndFixedSHA; TestToolReceiptVersionChangeDoesNotReturnMixedBody; TestProgramToolReceiptsKeepOriginalsOutOfPublicViews; TestToolReceiptPartialTailRemainsPendingUntilComplete; TestToolReceiptOriginalIdentitySurvivesLateOutputAndRejectsCollisions; TestToolReceiptNestedNeedsRealParentAndKeepsOriginalGeneration; TestToolReceiptMissingOrForeignMetaCannotClaimCurrentIdentity
// Impact: python -B scripts/code-atlas.py show Core/tool_receipt_read_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"unicode/utf8"
)

func TestToolReceiptMemoryRedactionSizesMatchPagedPublicBytes(t *testing.T) {
	m, dir := matrixTestManager(t, func(http.ResponseWriter, *http.Request) { t.Error("receipt must never request a model") })
	settings, err := Load(m.config)
	if err != nil {
		t.Fatal(err)
	}
	secret := "synthetic-long-api-secret-for-receipt-only"
	settings.MemoryEnabled = true
	settings.ProviderConnections[0].APIKey = secret
	if err = settings.Save(); err != nil {
		t.Fatal(err)
	}
	service := NewSettingsService(m.config)
	t.Cleanup(service.Close)
	now := int64(1794000000000)
	store := nativeMemory(t, filepath.Join(t.TempDir(), "synthetic-memory.sqlite"), &now, now)
	service.memory = store
	w := &Workspace{config: m.config, manager: m, service: service, host: &WorkspaceHost{mode: HostOS}, state: workspaceState{ID: workspaceID(), Workdir: dir}}
	// Preserve a full paged original without exceeding the transcript preview limit.
	original := strings.Repeat(" \n", 34000) + "before🙂" + secret + "汉字\n"
	want := strings.ReplaceAll(original, secret, "[redacted]")
	if len(want) == len(original) {
		t.Fatal("fixture must change byte length")
	}
	memoryCall(t, store, memoryRow{"action": "transcript_append", "rows": []any{map[string]any{"key": "previous/session", "pos": 0, "at": now, "role": RoleUser, "content": strings.TrimSpace(original), "payload": string(rawJSON(Message{Role: RoleUser, Content: original}))}}}, w.memoryProject(dir), "synthetic")
	var text strings.Builder
	offset := 0
	for page := 0; page < 8; page++ {
		result, err := w.historyReceipt(rawJSON(map[string]any{"entry_id": "memory:previous/session:000000000000", "all_history": true, "input_offset": offset}))
		if err != nil {
			t.Fatal(err)
		}
		r := result.(map[string]any)
		part := r["input"].(string)
		if r["input_size"] != len(want) || len(part) > 64<<10 || !utf8.ValidString(part) || strings.Contains(part, secret) {
			t.Fatal("redacted size/page differs from public bytes")
		}
		text.WriteString(part)
		offset = r["next_input"].(int)
		if offset == 0 {
			break
		}
		if offset != text.Len() {
			t.Fatal("redacted byte cursor drifted")
		}
	}
	if offset != 0 || text.String() != want {
		t.Fatal("redacted memory original did not finish exactly")
	}
}

func receiptAppend(t *testing.T, a *SessionArchive, kind string, value any) {
	t.Helper()
	if err := a.Append(kind, value); err != nil {
		t.Fatal(err)
	}
}

func receiptMeta(t *testing.T, a *SessionArchive, actor string, generation int) {
	t.Helper()
	receiptAppend(t, a, "meta", map[string]any{"workspace_agent": actor, "workspace_generation": generation})
}

func receiptIntent(t *testing.T, a *SessionArchive, invocation, call, input string) string {
	t.Helper()
	receiptAppend(t, a, "tool_intent", ToolIntent{InvocationID: invocation, Response: Message{Role: RoleAssistant, ToolCalls: []ToolCall{{ID: call, Function: FunctionCall{Name: "read_file", Arguments: input}}}}})
	return invocation + ":" + call
}

func receiptIndexed(t *testing.T, h *workspaceHistory, source historySource, id string) historyEntry {
	t.Helper()
	if pending, err := h.indexReceiptSources([]historySource{source}); err != nil || pending {
		t.Fatalf("index pending=%v error=%v", pending, err)
	}
	v, exists := h.entries[source.agent+":"+id]
	if !exists {
		t.Fatal("missing original", id)
	}
	return h.resolveReceiptIdentity(v)
}

func receiptMap(t *testing.T, m *AgentManager, v historyEntry, p toolReceiptRequest) map[string]any {
	t.Helper()
	r, err := receiptPage(m, v, p, false, true)
	if err != nil {
		t.Fatal(err)
	}
	return r
}

func TestToolReceiptUTF8IndependentPagesAndFixedSHA(t *testing.T) {
	actor := strings.Repeat("a", 32)
	m := &AgentManager{config: t.TempDir()}
	a := &SessionArchive{ephemeral: true}
	h := &workspaceHistory{}
	receiptMeta(t, a, actor, 2)
	input := strings.Repeat("English/汉字🙂\n", 12000)
	output := `{"ok":true,"output":"` + strings.Repeat("结果/Output🚀", 19000) + `"}`
	id := receiptIntent(t, a, "invocation", "opaque:call/with:punctuation", input)
	receiptAppend(t, a, "tool_progress", ToolReceipt{Key: id, ToolName: "read_file", Output: output})
	v := receiptIndexed(t, h, historySource{key: actor, agent: actor, archive: a}, id)
	p := toolReceiptRequest{ID: id, ReceiptGeneration: 2}
	var in, out strings.Builder
	pages := 0
	for {
		r := receiptMap(t, m, v, p)
		if r["ok"] != true {
			t.Fatal(r)
		}
		if pages == 0 {
			p.ReceiptVersion = r["receipt_version"].(string)
		}
		if r["receipt_version"] != p.ReceiptVersion {
			t.Fatal("page version drift")
		}
		source := r["source"].(toolReceiptSource)
		if source.SessionID != actor || source.AgentID != actor || source.Generation != 2 || source.CallID != id {
			t.Fatal(source)
		}
		for _, side := range []string{"input", "output"} {
			text := r[side].(string)
			if len(text) > 64<<10 || !utf8.ValidString(text) {
				t.Fatal("bad UTF-8 page", side)
			}
		}
		in.WriteString(r["input"].(string))
		out.WriteString(r["output"].(string))
		pages++
		ni, no := r["next_input"].(int), r["next_output"].(int)
		if ni == 0 && no == 0 {
			break
		}
		if ni == 0 {
			ni = r["input_size"].(int)
		}
		if no == 0 {
			no = r["output_size"].(int)
		}
		p.InputOffset, p.OutputOffset = ni, no
		if pages > 20 {
			t.Fatal("pagination did not finish")
		}
	}
	if in.String() != input || out.String() != output || pages < 4 {
		t.Fatal("original bytes lost or not paged")
	}
	for _, check := range []struct{ text, want string }{
		{in.String(), "66fa07681e7e5f5d7264aca97fe82ee1d4ff98e596ff127fd62e5cf8096e6052"},
		{out.String(), "ba98a2b5f7bd93784b3f2537213bb5030de4c153fa36454de26f7181db7e8483"},
	} {
		sum := sha256.Sum256([]byte(check.text))
		if hex.EncodeToString(sum[:]) != check.want {
			t.Fatal("fixed original SHA differs")
		}
	}
	if _, _, err := historyChunk("🙂", 1); err == nil {
		t.Fatal("split-rune cursor accepted")
	}
}

func TestToolReceiptVersionChangeDoesNotReturnMixedBody(t *testing.T) {
	actor := strings.Repeat("b", 32)
	a := &SessionArchive{ephemeral: true}
	h := &workspaceHistory{}
	m := &AgentManager{config: t.TempDir()}
	receiptMeta(t, a, actor, 3)
	id := receiptIntent(t, a, "turn", "call", strings.Repeat("输入🙂", 16000))
	receiptAppend(t, a, "tool_progress", ToolReceipt{Key: id, ToolName: "read_file", Output: `{"state":"running","output":"` + strings.Repeat("旧🙂", 24000) + `"}`})
	source := historySource{key: actor, agent: actor, archive: a}
	v := receiptIndexed(t, h, source, id)
	first := receiptMap(t, m, v, toolReceiptRequest{ID: id, ReceiptGeneration: 3})
	receiptAppend(t, a, "tool_progress", ToolReceipt{Key: id, ToolName: "read_file", Output: `{"ok":true,"output":"short final"}`})
	v = receiptIndexed(t, h, source, id)
	r := receiptMap(t, m, v, toolReceiptRequest{ID: id, ReceiptGeneration: 3, ReceiptVersion: first["receipt_version"].(string), InputOffset: first["next_input"].(int), OutputOffset: first["next_output"].(int)})
	if r["code"] != "receipt_changed" || r["changed"] != true || r["reload_required"] != true {
		t.Fatal(r)
	}
	for _, key := range []string{"input", "output", "source", "next_input", "next_output"} {
		if _, exists := r[key]; exists {
			t.Fatal("mixed-version field returned", key)
		}
	}
	latest := receiptMap(t, m, v, toolReceiptRequest{ID: id, ReceiptGeneration: 3})
	if latest["output"] != `{"ok":true,"output":"short final"}` || latest["receipt_version"] == first["receipt_version"] {
		t.Fatal("explicit reread did not see final original")
	}
}

func TestProgramToolReceiptsKeepOriginalsOutOfPublicViews(t *testing.T) {
	m, _ := matrixTestManager(t, nil)
	const actor = "cccccccccccccccccccccccccccccccc"
	const privateTask = "PRIVATE-PROGRAM-INSTRUCTIONS"
	const privateResult = "PRIVATE-PROGRAM-REPLY"
	const brief = "Cota，麻烦核对解析器。"
	for _, tc := range []struct {
		action string
		args   map[string]any
	}{
		{"program_send", map[string]any{"message": privateTask, "brief": brief}},
		{"program_result", map[string]any{"generation": 3, "timeout_ms": 25000}},
	} {
		t.Run(tc.action, func(t *testing.T) {
			tc.args["action"], tc.args["program"] = tc.action, "coding"
			a := &SessionArchive{ephemeral: true}
			receiptMeta(t, a, actor, 1)
			call := ToolCall{ID: "call", Function: FunctionCall{Name: "agents", Arguments: string(rawJSON(tc.args))}}
			receiptAppend(t, a, "tool_intent", ToolIntent{"turn", Message{ToolCalls: []ToolCall{call}}})
			id := "turn:call"
			output := `{"ok":true,"state":"completed","data":{"state":"completed","generation":3,"result":"` + privateResult + `"}}`
			receiptAppend(t, a, "tool_progress", ToolReceipt{Key: id, ToolName: "agents", Output: output})
			v := receiptIndexed(t, &workspaceHistory{}, historySource{key: actor, agent: actor, archive: a}, id)
			page := receiptMap(t, m, v, toolReceiptRequest{ID: id, ReceiptGeneration: 1})
			cache := newAgentActivityCache()
			cache.result(id, call, output)
			activity := cache.items[id]
			public := string(rawJSON(page)) + string(rawJSON(activity))
			if strings.Contains(public, privateTask) || strings.Contains(public, privateResult) {
				t.Fatal("private delegation content reached a presentation surface")
			}
			if !strings.Contains(string(activity.Preview), `"generation":3`) || activity.State != "completed" {
				t.Fatal("missing program receipt lifecycle", activity)
			}
			if tc.action == "program_send" && (!strings.Contains(page["input"].(string), brief) || !strings.Contains(string(activity.InputPreview), brief)) {
				t.Fatal("public delegation Brief was lost")
			}
			if !strings.Contains(string(a.memory), privateResult) {
				t.Fatal("execution record lost its original reply")
			}
		})
	}
}

func TestToolReceiptPartialTailRemainsPendingUntilComplete(t *testing.T) {
	actor := strings.Repeat("c", 32)
	a := &SessionArchive{ephemeral: true}
	h := &workspaceHistory{}
	receiptMeta(t, a, actor, 1)
	id := receiptIntent(t, a, "turn", "call", `{"path":"original"}`)
	line := append(rawJSON(map[string]any{"kind": "tool_progress", "value": ToolReceipt{Key: id, ToolName: "read_file", Output: `{"ok":true}`}}), '\n')
	a.memory = append(a.memory, line[:len(line)/2]...)
	source := historySource{key: actor, agent: actor, archive: a}
	pending, err := h.indexReceiptSources([]historySource{source})
	if err != nil || !pending || h.entries[actor+":"+id].output.size != 0 {
		t.Fatal("partial original consumed", pending, err)
	}
	if r := receiptUnavailable(pending); r["code"] != "receipt_pending" || r["pending"] != true {
		t.Fatal(r)
	}
	a.memory = append(a.memory, line[len(line)/2:]...)
	v := receiptIndexed(t, h, source, id)
	in, out, err := receiptText(v)
	if err != nil || in != `{"path":"original"}` || out != `{"ok":true}` {
		t.Fatal(in, out, err)
	}
}

func TestToolReceiptOriginalIdentitySurvivesLateOutputAndRejectsCollisions(t *testing.T) {
	for _, tc := range []struct {
		name, other string
		generation  int
	}{
		{"other actor same generation", strings.Repeat("e", 32), 1},
		{"same actor next generation", strings.Repeat("d", 32), 2},
	} {
		t.Run(tc.name, func(t *testing.T) {
			actor, session := strings.Repeat("d", 32), strings.Repeat("f", 32)
			a := &SessionArchive{ephemeral: true}
			h := &workspaceHistory{}
			m := &AgentManager{config: t.TempDir()}
			source := historySource{key: session, agent: session, archive: a, managed: true}
			receiptMeta(t, a, actor, 1)
			old := receiptIntent(t, a, "invocation-old", "same-bare-id", "old input")
			receiptMeta(t, a, tc.other, tc.generation)
			newer := receiptIntent(t, a, "invocation-new", "same-bare-id", "new input")
			receiptAppend(t, a, "tool_progress", ToolReceipt{Key: old, Output: `{"ok":true,"result":"late old result"}`})
			v := receiptIndexed(t, h, source, old)
			r := receiptMap(t, m, v, toolReceiptRequest{ID: old, ReceiptGeneration: 1})
			identity := r["source"].(toolReceiptSource)
			if identity.SessionID != session || identity.AgentID != actor || identity.Generation != 1 || identity.CallID != old || r["input"] != "old input" {
				t.Fatal("late output acquired current identity", r)
			}
			if v.output.source.runtimeAgent != actor || v.output.generation != 1 {
				t.Fatal("late output terminal owner changed")
			}
			newEntry := h.entries[session+":"+newer]
			if newEntry.receiptActor != tc.other || newEntry.Generation != tc.generation {
				t.Fatal("different invocation was collapsed")
			}
			receiptIntent(t, a, "invocation-old", "same-bare-id", "colliding input")
			v = receiptIndexed(t, h, source, old)
			if r = receiptMap(t, m, v, toolReceiptRequest{ID: old}); r["unavailable"] != true {
				t.Fatal("ambiguous actor/generation returned a body", r)
			}
		})
	}
}

func TestToolReceiptNestedNeedsRealParentAndKeepsOriginalGeneration(t *testing.T) {
	actor := strings.Repeat("1", 32)
	a := &SessionArchive{ephemeral: true}
	h := &workspaceHistory{}
	m := &AgentManager{config: t.TempDir()}
	receiptMeta(t, a, actor, 4)
	parent := receiptIntent(t, a, "parent-invocation", "parent-call", "parent input")
	root := t.TempDir()
	dir := filepath.Join(root, actor+".shell", "cells")
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	start := cellEvent{Type: "start", Key: parent}
	nested := cellEvent{Type: "nested", Record: &NestedToolRecord{ID: 1, Call: ToolCall{Function: FunctionCall{Name: "read_file", Arguments: "nested exact input"}}, State: "completed", Output: "nested exact output"}}
	data := append(append(append(rawJSON(start), '\n'), rawJSON(nested)...), '\n')
	if err := os.WriteFile(filepath.Join(dir, "cell.jsonl"), data, 0600); err != nil {
		t.Fatal(err)
	}
	source := historySource{key: actor, agent: actor, archive: a, shellRoot: root}
	v := receiptIndexed(t, h, source, "cell:1")
	r := receiptMap(t, m, v, toolReceiptRequest{ID: "cell:1", ReceiptGeneration: 4})
	if r["input"] != "nested exact input" || r["output"] != "nested exact output" || r["source"].(toolReceiptSource).Generation != 4 {
		t.Fatal(r)
	}
	if err := os.WriteFile(filepath.Join(dir, "no-parent.jsonl"), append(rawJSON(nested), '\n'), 0600); err != nil {
		t.Fatal(err)
	}
	v = receiptIndexed(t, h, source, "no-parent:1")
	if r = receiptMap(t, m, v, toolReceiptRequest{ID: "no-parent:1"}); r["unavailable"] != true {
		t.Fatal("guessed nested identity", r)
	}
}

func TestToolReceiptMissingOrForeignMetaCannotClaimCurrentIdentity(t *testing.T) {
	actor := strings.Repeat("2", 32)
	for _, meta := range []bool{false, true} {
		t.Run(map[bool]string{false: "missing", true: "foreign"}[meta], func(t *testing.T) {
			a := &SessionArchive{ephemeral: true}
			h := &workspaceHistory{}
			m := &AgentManager{config: t.TempDir()}
			if meta {
				receiptMeta(t, a, strings.Repeat("3", 32), 7)
			}
			id := receiptIntent(t, a, "original", "call", "original input")
			v := receiptIndexed(t, h, historySource{key: actor, agent: actor, archive: a}, id)
			if r := receiptMap(t, m, v, toolReceiptRequest{ID: id, ReceiptGeneration: 7}); r["unavailable"] != true {
				t.Fatal(r)
			}
			legacy, err := receiptPage(m, v, toolReceiptRequest{ID: id}, false, false)
			if err != nil || legacy["input"] != "original input" {
				t.Fatal("legacy reading changed", legacy, err)
			}
			if _, exists := legacy["source"]; exists {
				t.Fatal("legacy identity invented")
			}
		})
	}
}

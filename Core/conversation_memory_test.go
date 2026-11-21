// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestConversationMemoryCompactionAndReopen; TestAllConversationIdentitiesHaveOwnMemoryWithoutMotherTools
// Impact: python -B scripts/code-atlas.py show Core/conversation_memory_test.go
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
	"slices"
	"strings"
	"sync/atomic"
	"testing"
)

func TestConversationMemoryCompactionAndReopen(t *testing.T) {
	var requests, summaries atomic.Int32
	m, dir := matrixTestManager(t, func(w http.ResponseWriter, req *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
			t.Error(err)
			return
		}
		encoded := string(rawJSON(body))
		if strings.Contains(encoded, "PARENT_PENDING_PRIVATE") {
			t.Error("parent outbox leaked into instance")
		}
		input := body["input"].([]any)
		if strings.Contains(string(rawJSON(input[len(input)-1])), "【工作上下文封存】") {
			summaries.Add(1)
			fixtureAnswer(w, "summary", "用户要求保存 OWN_FACT_114，已保留计划，记忆写入尚未执行；继续记录并回查。", nil)
			return
		}
		seen := map[string]int{}
		for _, raw := range body["tools"].([]any) {
			seen[raw.(map[string]any)["name"].(string)]++
		}
		for name, count := range seen {
			if count != 1 {
				t.Errorf("duplicate tool %s: %d", name, count)
			}
		}
		if seen["memory"] != 1 || seen["project"] != 1 || seen["report"] != 1 {
			t.Error("assigned definitions missing", seen)
		}
		n := requests.Add(1)
		call := func(name, args string) any {
			return map[string]any{"type": "function_call", "id": fmt.Sprint("fc", n), "call_id": fmt.Sprint("call", n), "name": name, "arguments": args}
		}
		switch n {
		case 1:
			fixtureAnswer(w, "plan", "", []any{call("update_plan", string(rawJSON(samplePlanUpdate())))})
		case 2:
			fixtureAnswer(w, "prepare", "", []any{map[string]any{"type": "message", "id": "observed", "role": "assistant", "status": "completed", "content": []any{map[string]any{"type": "output_text", "text": strings.Repeat("已验证的本实例记录与文件位置；", 2400)}}}, call("memory", `{"action":"compact","purpose":"memory_edit"}`)})
		case 3:
			if !strings.Contains(encoded, "completed") {
				t.Error("compaction completion missing")
			}
			fixtureAnswer(w, "record", "", []any{call("memory", `{"action":"record","kind":"fact","scope":"global","request_id":"own-fact","title":"本实例事实","content":"OWN_FACT_114"}`)})
		case 4:
			fixtureAnswer(w, "recall", "", []any{call("memory", `{"action":"history","query":"USER_ORIGINAL_114"}`)})
		default:
			fixtureAnswer(w, "done", "记忆和原文已保留。", nil)
		}
	})
	s, err := Load(m.config)
	if err != nil {
		t.Fatal(err)
	}
	s.MemoryEnabled = true
	zero := 0
	s.APIProfiles[0].CompactAtTokens = &zero
	if err = s.Save(); err != nil {
		t.Fatal(err)
	}
	h := NewWorkspaceHost(m.config, "", "")
	defer h.Close()
	cm, err := h.conversationManager()
	if err != nil {
		t.Fatal(err)
	}
	v, err := h.conversationCall(context.Background(), rawJSON(map[string]any{"action": "create", "request_id": "memory-owner", "model_id": "local-model", "tools": []string{"update_plan", "report", "project"}}))
	if err != nil {
		t.Fatal(err)
	}
	r := v.(AgentRecord)
	parent := modeWorkspace(t, m.config, dir, HostOS)
	parent.service = NewSettingsService(m.config)
	defer parent.service.Close()
	parentOutbox := parent.transcriptOutboxDirectory()
	if err = os.MkdirAll(parentOutbox, 0700); err != nil {
		t.Fatal(err)
	}
	poison := filepath.Join(parentOutbox, "parent-only.json")
	if err = os.WriteFile(poison, []byte("PARENT_PENDING_PRIVATE"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = cm.Send(cm.owner, r.ID, "memory-run", "USER_ORIGINAL_114：记录本实例事实并保留计划。"); err != nil {
		t.Fatal(err)
	}
	r, err = cm.Wait(context.Background(), cm.owner, r.ID, 20000)
	if err != nil || r.State != "completed" {
		t.Fatal(r.State, r.Error, err)
	}
	if summaries.Load() != 1 || requests.Load() != 5 {
		t.Fatal("unexpected model work", summaries.Load(), requests.Load())
	}
	path, _ := SessionPath(filepath.Join(cm.dir, "config.json"), r.ID)
	restored, err := (&SessionArchive{Path: path}).read()
	if err != nil || restored.Checkpoint == nil || restored.Checkpoint.Plan == nil || restored.Compaction == nil || restored.Compaction.State != "completed" {
		t.Fatalf("checkpoint or plan lost: checkpoint=%+v plan=%+v compaction=%+v err=%v", restored.Checkpoint, restored.Plan.State, restored.Compaction, err)
	}
	before := requests.Load()
	h.Close()
	h = NewWorkspaceHost(m.config, "", "")
	defer h.Close()
	cm, err = h.conversationManager()
	if err != nil {
		t.Fatal(err)
	}
	if requests.Load() != before {
		t.Fatal("reopen reexecuted model")
	}
	aw := cm.instanceMemoryWorkspace(r)
	defer aw.service.Close()
	b := r
	b.ID = workspaceID()
	bw := cm.instanceMemoryWorkspace(b)
	defer bw.service.Close()
	for label, scope := range map[string]*Workspace{"owner": aw, "other": bw, "parent": parent} {
		got, e := memoryResult(scope.memory(context.Background(), map[string]any{"action": "search", "query": "OWN_FACT_114"}))
		if e != nil || strings.Contains(string(rawJSON(got)), "OWN_FACT_114") != (label == "owner") {
			t.Fatal("memory isolation", label, got, e)
		}
	}
	for _, query := range []string{"USER_ORIGINAL_114", "记忆和原文已保留"} {
		got, e := aw.pacTool(context.Background(), map[string]any{"action": "history", "query": query})
		if e != nil || !strings.Contains(string(rawJSON(got)), query) {
			t.Fatal("sealed/unsealed original missing", query, got, e)
		}
	}
	if data, e := os.ReadFile(poison); e != nil || string(data) != "PARENT_PENDING_PRIVATE" {
		t.Fatal("instance consumed parent outbox", e)
	}
	if aw.transcriptOutboxDirectory() == bw.transcriptOutboxDirectory() || aw.transcriptOutboxDirectory() == parentOutbox {
		t.Fatal("shared pending originals")
	}
}

func TestAllConversationIdentitiesHaveOwnMemoryWithoutMotherTools(t *testing.T) {
	m, _ := matrixTestManager(t, nil)
	h := NewWorkspaceHost(m.config, "", "")
	defer h.Close()
	cm, err := h.conversationManager()
	if err != nil {
		t.Fatal(err)
	}
	for _, role := range []string{"eyra", "cota", "vaya"} {
		selected := cm.builtinTools(conversationContact{Builtin: role})
		if !slices.Contains(selected, "memory") || slices.Contains(selected, "settings") || slices.Contains(selected, "community") {
			t.Fatal(role, selected)
		}
	}
	for _, selected := range [][]string{nil, {"project", "report"}, {"memory"}} {
		ordinary, e := conversationToolList(selected, false)
		if e != nil || !slices.Contains(ordinary, "memory") {
			t.Fatal(ordinary, e)
		}
		program, e := programToolList(selected)
		if e != nil || !slices.Contains(program, "memory") {
			t.Fatal(program, e)
		}
		if len(selected) == 0 && conversationWorks(ordinary) {
			t.Fatal("memory turned a chat into a coding worker")
		}
	}
}

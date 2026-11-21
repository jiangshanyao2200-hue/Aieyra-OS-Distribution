// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestMotherDirectExecutionDoesNotRequireSpecialistOrTeam; TestMotherTaskComplexityRejectsInventedReferenceAndTakeover
// Impact: python -B scripts/code-atlas.py show Core/workspace_direct_execution_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
)

func TestMotherDirectExecutionDoesNotRequireSpecialistOrTeam(t *testing.T) {
	var requests atomic.Int32
	m, dir := matrixTestManager(t, func(rw http.ResponseWriter, req *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
			t.Error(err)
			return
		}
		if requests.Add(1) == 1 {
			tools := string(rawJSON(body["tools"]))
			if !strings.Contains(tools, `"name":"apply_patch"`) || !strings.Contains(tools, `"name":"terminal"`) {
				t.Error("simple task did not receive direct programming tools")
			}
			fixtureAnswer(rw, "direct-patch", "", []any{map[string]any{"type": "function_call", "id": "fc-direct", "call_id": "direct-patch", "name": "apply_patch", "arguments": string(rawJSON(map[string]any{"patch": "*** Begin Patch\n*** Add File: direct.txt\n+written directly by Eyra\n*** End Patch"}))}})
			return
		}
		if !strings.Contains(string(rawJSON(body["input"])), "direct.txt") {
			t.Error("next request lost the patch receipt")
		}
		fixtureAnswer(rw, "direct-done", "DIRECT-DONE", nil)
	})
	s, err := Load(m.config)
	if err != nil {
		t.Fatal(err)
	}
	off, zero := false, 0
	s.ExecutionEnabled, s.VisionEnabled, s.MemoryEnabled = &off, &off, false
	s.APIProfiles[0].CompactAtTokens = &zero
	if err = s.Save(); err != nil {
		t.Fatal(err)
	}
	h, w := openCoreLinkHome(t, m.config, dir)
	defer h.Close()
	if _, err = w.Send("simple-task", "Create direct.txt containing written directly by Eyra."); err != nil {
		t.Fatal(err)
	}
	waitCoreLink(t, "direct task did not start", func() bool { w.mu.Lock(); defer w.mu.Unlock(); return w.state.Roles[WorkspaceMatrix] != "" })
	w.mu.Lock()
	actor, archivePath := w.state.Roles[WorkspaceMatrix], w.contextArchivePath(w.contextSessionLocked().Archive)
	w.mu.Unlock()
	r, err := w.manager.Wait(context.Background(), w.manager.owner, actor, 20000)
	if err != nil || r.State != "completed" || r.Result != "DIRECT-DONE" || requests.Load() != 2 {
		t.Fatal("direct task did not complete in one tool turn", r.State, r.Error, requests.Load(), err)
	}
	data, err := os.ReadFile(filepath.Join(dir, "direct.txt"))
	if err != nil || string(data) != "written directly by Eyra\n" {
		t.Fatal("no actual file from the mother", string(data), err)
	}
	restored, err := (&SessionArchive{Path: archivePath}).read()
	if err != nil || restored.MotherIdentity != nil || restored.Checkpoint != nil {
		t.Fatal("simple task unnecessarily changed identity or compacted", err)
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.state.Roles[WorkspaceProject] != "" || w.state.Roles[WorkspaceExecution] != "" {
		t.Fatal("simple task launched disabled team members")
	}
}

func TestMotherTaskComplexityRejectsInventedReferenceAndTakeover(t *testing.T) {
	for _, scenario := range []string{"invented-reference", "fabricated-takeover"} {
		t.Run(scenario, func(t *testing.T) {
			var requests atomic.Int32
			m, dir := matrixTestManager(t, func(rw http.ResponseWriter, req *http.Request) {
				var body map[string]any
				_ = json.NewDecoder(req.Body).Decode(&body)
				if requests.Add(1) == 1 {
					command := map[string]any{"trigger": "task_complexity", "user_reference": "current task", "plan": []string{"implement", "verify"}, "success": "verified", "exit": "finished or blocked"}
					if scenario == "invented-reference" {
						command["user_reference"] = "not in user history"
					} else {
						command["failed_agent"], command["failed_generation"] = "unrelated-instance", 1
					}
					args := map[string]any{"action": "identity_enter", "request_id": "invalid-handoff", "contact_id": builtinContactID("cota"), "reason": "focused implementation", "task": "current task", "command": command}
					fixtureAnswer(rw, "denied-handoff", "", []any{map[string]any{"type": "function_call", "id": "fc-denied", "call_id": "denied", "name": "agents", "arguments": string(rawJSON(args))}})
					return
				}
				wire := string(rawJSON(body))
				want := "command.user_reference 需逐字引用实际用户消息"
				if scenario == "fabricated-takeover" {
					want = "不接管其他实例"
				}
				if !strings.Contains(wire, want) {
					t.Error("admission did not return the actual rejection", want)
				}
				fixtureAnswer(rw, "mother-remains", "REJECTED", nil)
			})
			h, w := openCoreLinkHome(t, m.config, dir)
			defer h.Close()
			if _, err := w.Send("invalid-trigger-task", "Please implement the current task."); err != nil {
				t.Fatal(err)
			}
			waitCoreLink(t, "mother did not start", func() bool { w.mu.Lock(); defer w.mu.Unlock(); return w.state.Roles[WorkspaceMatrix] != "" })
			w.mu.Lock()
			actor, archivePath := w.state.Roles[WorkspaceMatrix], w.contextArchivePath(w.contextSessionLocked().Archive)
			w.mu.Unlock()
			result, err := w.manager.Wait(context.Background(), w.manager.owner, actor, 20000)
			if err != nil || result.State != "completed" || requests.Load() != 2 {
				t.Fatal(result.State, result.Error, requests.Load(), err)
			}
			restored, err := (&SessionArchive{Path: archivePath}).read()
			if err != nil || restored.MotherIdentity != nil {
				t.Fatal("invalid task handoff persisted or changed identity", err)
			}
		})
	}
}

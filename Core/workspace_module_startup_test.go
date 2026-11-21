// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestModuleOnlyStartupReconnectRequestsGreetingOnly; TestModuleOnlyStartupAllowsExplicitUserTask; TestModuleOnlyStartupKeepsOfficeNoticePending
// Impact: python -B scripts/code-atlas.py show Core/workspace_module_startup_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"sync/atomic"
	"testing"
)

func TestModuleOnlyStartupReconnectRequestsGreetingOnly(t *testing.T) {
	var calls atomic.Int32
	w, _ := testWorkspace(t, func(rw http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		var body map[string]json.RawMessage
		_ = json.NewDecoder(r.Body).Decode(&body)
		text := "已连接。"
		if strings.Contains(string(body["input"]), "只输出一个 JSON 对象") {
			text = startupFixtureSummary(t, body["input"])
		}
		fixtureAnswer(rw, "module-reconnect", text, nil)
	})
	archive, _ := seedStartupHistory(t, w)
	before, _ := os.ReadFile(archive)
	w.mu.Lock()
	w.startupDeferred = true
	w.mu.Unlock()
	for _, input := range []string{`{}`, `{"skip":true}`, `{}`} {
		result, err := w.greet(json.RawMessage(input))
		if err != nil || result.(WorkspaceGreeting).State != "skipped" {
			t.Fatal("module greeting", result, err)
		}
	}
	w.greetingWG.Wait()
	after, _ := os.ReadFile(archive)
	if calls.Load() != 0 || w.startupStarted || w.startupWorkers != 0 || string(before) != string(after) {
		t.Fatal("module-only startup executed model maintenance or changed original history", calls.Load())
	}
	if _, err := w.greet(json.RawMessage(`{"retry":true}`)); err != nil {
		t.Fatal(err)
	}
	w.greetingWG.Wait()
	if calls.Load() != 1 || w.startupDeferred || w.startupStarted || w.greeting.State != "online" {
		t.Fatal("reconnect did not limit provider activity to the greeting", calls.Load(), w.startupError)
	}
}

func TestModuleOnlyStartupAllowsExplicitUserTask(t *testing.T) {
	var calls atomic.Int32
	w, _ := testWorkspace(t, func(rw http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		fixtureAnswer(rw, "module-task", "已执行明确的用户任务。", nil)
	})
	w.mu.Lock()
	w.startupDeferred = true
	w.mu.Unlock()
	if _, err := w.greet(json.RawMessage(`{}`)); err != nil {
		t.Fatal(err)
	}
	if _, err := w.Send("explicit-module-task", "只回答已收到。"); err != nil {
		t.Fatal(err)
	}
	// Observe the completed real task, including initial package admission.
	// A three-second outbound-request counter mistook slow cold admission for
	// continued startup deferral and did not prove task completion at all.
	waitStartupTask(t, w)
	w.mu.Lock()
	deferred := w.startupDeferred
	w.mu.Unlock()
	if calls.Load() != 1 || deferred {
		t.Fatal("explicit task stayed deferred", calls.Load(), deferred)
	}
}

func TestModuleOnlyStartupKeepsOfficeNoticePending(t *testing.T) {
	w, _ := testWorkspace(t, func(http.ResponseWriter, *http.Request) {
		t.Error("office notice called a model during module startup")
	})
	w.host = &WorkspaceHost{mode: HostOS}
	w.startupDeferred = true
	if _, err := w.linkNotice("link-pending", "[Link office notice] read inbox", "Link · 同事 找你"); err == nil {
		t.Fatal("implicit office wake accepted before an explicit user task")
	}
	if len(w.state.Messages) != 0 {
		t.Fatal("deferred notice entered the execution queue")
	}
}

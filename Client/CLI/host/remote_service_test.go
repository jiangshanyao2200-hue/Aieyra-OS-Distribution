// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/CLI/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: TestSessionCommandsShareDesktopStateAndRestore; TestRemoteManagementPreservesPartialFailureWithoutRetry; TestRemoteDiscoveryAndInputFailBeforeRequests
// Impact: python -B scripts/code-atlas.py show Client/CLI/host/remote_service_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package cli

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"
	"testing"

	agent "github.com/aieyra/aieyra-os/CORE"
)

func TestSessionCommandsShareDesktopStateAndRestore(t *testing.T) {
	config, project := fixture(t, func(http.ResponseWriter, *http.Request) { t.Error("management called a model") })
	open := func() (*agent.WorkspaceHost, map[string]any) {
		h := agent.NewWorkspaceHost(config, "", "")
		if err := h.SetMode(agent.HostOS); err != nil {
			t.Fatal(err)
		}
		h.SetControl(false)
		d, err := h.Open("", project)
		if err != nil {
			h.Close()
			t.Fatal(err)
		}
		t.Cleanup(h.Close)
		return h, d
	}
	h, d := open()
	call := func(command string, args map[string]any) map[string]any {
		t.Helper()
		raw, _ := json.Marshal(args)
		out, _, err := runTest(t, []string{command, "--discovery", d["discovery"].(string)}, string(raw))
		if err != nil {
			t.Fatal(command, args["action"], err)
		}
		var r map[string]any
		if err = json.Unmarshal([]byte(out), &r); err != nil {
			t.Fatal(err)
		}
		if strings.Contains(out, d["token"].(string)) {
			t.Fatal("discovery token leaked")
		}
		return r
	}
	first := call("context", map[string]any{"action": "view"})
	created := call("context", map[string]any{"action": "new", "source": first["source"], "title": "终端管理的桌面会话", "auto_memory": false})
	id := created["session_id"]
	// This exceeds the old Agent command cap while staying within the context
	// domain's limit; CLI must preserve the complete Unicode draft.
	text := strings.Repeat("跨端原文\n", 16000)
	edited := call("context", map[string]any{"action": "edit", "source": created["source"], "text": text, "auto_memory": false})
	direct := newClient(d)
	var desktop map[string]any
	if err := direct.call(context.Background(), "workspace.context", map[string]any{"action": "view"}, &desktop); err != nil {
		t.Fatal(err)
	}
	if desktop["session_id"] != id || !strings.Contains(desktop["text"].(string), text) || desktop["source"] != edited["source"] {
		t.Fatal("clients disagree about the same context")
	}
	stale, _ := json.Marshal(map[string]any{"action": "edit", "source": created["source"], "text": "stale overwrite"})
	if _, _, err := runTest(t, []string{"context", "--discovery", d["discovery"].(string)}, string(stale)); err == nil {
		t.Fatal("stale editor overwrote current context")
	}
	contact := call("contacts", map[string]any{"action": "contact_create", "name": "终端联系人", "model_id": "test-model", "request_id": "cross-client-contact", "prompt_text": "Independent contact context."})
	contactID := contact["id"]
	second := call("contacts", map[string]any{"action": "session_create", "contact_id": contactID, "request_id": "cross-client-contact-session"})
	if second["id"] == contactID || second["contact_id"] != contactID {
		t.Fatal("contact session identity lost")
	}
	call("contacts", map[string]any{"action": "session_delete", "id": second["id"], "request_id": "cross-client-delete"})
	h.Close()
	_, d = open()
	reopened := call("context", map[string]any{"action": "view"})
	if reopened["session_id"] != id || !strings.Contains(reopened["text"].(string), text) {
		t.Fatal("reopen lost the shared context")
	}
	restored := call("contacts", map[string]any{"action": "contact", "id": contactID})
	if restored["name"] != "终端联系人" || len(restored["sessions"].([]any)) != 1 {
		t.Fatal("contact deletion/reopen lost scope", restored)
	}
	if _, _, err := runTest(t, []string{"workflows", "--discovery", d["discovery"].(string)}, `{"action":"list","package":"invalid"}`); err == nil {
		t.Fatal("CLI bypassed Workbox package checks")
	}
}

func TestRemoteManagementPreservesPartialFailureWithoutRetry(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		var p struct {
			Action string `json:"action"`
		}
		if json.NewDecoder(r.Body).Decode(&p) != nil || p.Action != "workspace.conversation" {
			t.Error("wrong service")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true,"data":{"ok":false,"error":"pending cleanup","cleanup":{"pending":["original-archive"]}}}`))
	}))
	defer server.Close()
	file := filepath.Join(t.TempDir(), "discovery.json")
	data, _ := json.Marshal(map[string]any{"session_id": strings.Repeat("a", 32), "url": server.URL + "/v1/rpc", "token": strings.Repeat("t", 40)})
	if err := os.WriteFile(file, data, 0600); err != nil {
		t.Fatal(err)
	}
	out, _, err := runTest(t, []string{"contacts", "--discovery", file}, `{"action":"session_delete","id":"existing","request_id":"stable"}`)
	if err == nil || !strings.Contains(out, `"pending":["original-archive"]`) || calls.Load() != 1 {
		t.Fatal("partial receipt lost or mutation retried", out, err, calls.Load())
	}
}

func TestRemoteDiscoveryAndInputFailBeforeRequests(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1); t.Error("invalid input sent a request") }))
	defer server.Close()
	file := filepath.Join(t.TempDir(), "discovery.json")
	good := map[string]any{"session_id": strings.Repeat("b", 32), "url": server.URL + "/v1/rpc", "token": strings.Repeat("z", 40)}
	write := func(value map[string]any, suffix string) {
		t.Helper()
		data, _ := json.Marshal(value)
		if err := os.WriteFile(file, append(data, []byte(suffix)...), 0600); err != nil {
			t.Fatal(err)
		}
	}
	for _, change := range []map[string]any{{"url": "https://example.org/v1/rpc"}, {"url": server.URL + "/v1/rpc?x=1"}, {"session_id": strings.Repeat("x", 32)}, {"token": "short"}} {
		value := map[string]any{}
		for k, v := range good {
			value[k] = v
		}
		for k, v := range change {
			value[k] = v
		}
		write(value, "")
		if _, _, err := runTest(t, []string{"context", "--discovery", file}, `{"action":"view"}`); err == nil {
			t.Fatal("invalid discovery accepted")
		}
	}
	write(good, "{}")
	if _, err := discoveryClient(file); err == nil {
		t.Fatal("multiple discovery documents accepted")
	}
	write(good, "")
	for _, raw := range []string{"null", "[]", "{}{}", strings.Repeat(" ", 2<<20) + "{}"} {
		if _, _, err := runTest(t, []string{"context", "--discovery", file}, raw); err == nil {
			t.Fatal("invalid command accepted")
		}
	}
	link := file + ".link"
	if err := os.Symlink(file, link); err == nil {
		if _, err = discoveryClient(link); err == nil {
			t.Fatal("linked discovery accepted")
		}
	} else {
		t.Log("symlink unavailable; POSIX coverage required")
	}
	if runtime.GOOS != "windows" {
		if err := os.Chmod(file, 0644); err != nil {
			t.Fatal(err)
		}
		if _, err := discoveryClient(file); err == nil {
			t.Fatal("public discovery accepted")
		}
	}
	if calls.Load() != 0 {
		t.Fatal("invalid input reached transport")
	}
}

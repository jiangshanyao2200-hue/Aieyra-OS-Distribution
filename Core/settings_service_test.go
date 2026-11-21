// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestSettingsServicePersistentProbeConfigure
// Impact: python -B scripts/code-atlas.py show Core/settings_service_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// 运行真实本地设置服务，确保探测证明跨 RPC 保留，并随聊天客户端关闭。
func TestSettingsServicePersistentProbeConfigure(t *testing.T) {
	root, err := filepath.Abs("..")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(filepath.Join(root, "Client/Desktop", "node_modules", "electron", "dist", "electron.exe")); err != nil {
		t.Skip("bundled Electron unavailable")
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/models" {
			json.NewEncoder(w).Encode(map[string]any{"data": []any{map[string]string{"id": "relay-test"}}})
			return
		}
		var b struct {
			Input []map[string]any `json:"input"`
			Tools []struct {
				Parameters struct {
					Properties struct {
						Token struct {
							Enum []string `json:"enum"`
						} `json:"token"`
					} `json:"properties"`
				} `json:"parameters"`
			} `json:"tools"`
			ToolChoice any `json:"tool_choice"`
		}
		if json.NewDecoder(r.Body).Decode(&b) != nil || len(b.Tools) == 0 {
			http.Error(w, "bad body", 400)
			return
		}
		if b.ToolChoice != "auto" {
			t.Error("probe must preserve the verified auto tool choice")
			http.Error(w, "unexpected tool choice", 400)
			return
		}
		if len(b.Input) > 0 && b.Input[len(b.Input)-1]["type"] == "function_call_output" {
			if b.Input[len(b.Input)-1]["call_id"] != "c1" {
				t.Error("probe lost original tool call identity")
			}
			content := map[string]any{"type": "output_text", "text": b.Input[len(b.Input)-1]["output"]}
			message := map[string]any{"type": "message", "role": "assistant", "content": []any{content}}
			json.NewEncoder(w).Encode(map[string]any{"id": "r2", "status": "completed", "output": []any{message}})
			return
		}
		args, _ := json.Marshal(map[string]string{"token": b.Tools[0].Parameters.Properties.Token.Enum[0]})
		json.NewEncoder(w).Encode(map[string]any{"id": "r1", "status": "completed", "output": []any{map[string]any{"type": "function_call", "call_id": "c1", "name": "aieyra_probe", "arguments": string(args)}}})
	}))
	defer srv.Close()
	file := filepath.Join(t.TempDir(), "config.json")
	s := Defaults()
	s.APIKey = "sk-original-test"
	s.SetPath(file)
	if err = s.Save(); err != nil {
		t.Fatal(err)
	}
	client := &SettingsService{config: file, root: root}
	defer client.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	call := func(action string, args any) map[string]any {
		t.Helper()
		raw, _ := json.Marshal(args)
		out, e := client.Call(ctx, "session-test", action, raw)
		if e != nil {
			t.Fatal(e)
		}
		var result map[string]any
		if json.Unmarshal(out, &result) != nil || result["ok"] != true {
			t.Fatalf("%s failed: %s", action, out)
		}
		return result
	}
	initial := call("read", map[string]any{})
	proof := call("probe", map[string]any{"base_url": srv.URL, "api_key": "sk-relay-test", "model": "relay-test", "api_protocol": "responses"})
	firstPID := client.cmd.Process.Pid
	saved := call("configure", map[string]any{"probe_id": proof["probe_id"], "id": "relay", "context_window": 128000, "expected_version": initial["version"], "activate": true})
	if saved["settings"].(map[string]any)["model"] != "relay-test" || client.cmd.Process.Pid != firstPID {
		t.Fatal("service/configuration did not persist")
	}
	client.Close()
	if _, err = client.Call(ctx, "session-test", "read", nil); err == nil {
		t.Fatal("closed service accepted call")
	}
}

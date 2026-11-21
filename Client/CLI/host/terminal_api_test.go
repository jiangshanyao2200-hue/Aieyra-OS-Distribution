// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/CLI/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: sharedSettingsRoot; settingsRPC; settingsOK; configObject; writeConfigObject; profileObject; TestTerminalSettingsTransportForwardsRawJSONAndReceiptScope; TestTerminalAPISavePreservesExactActiveOSProfile; TestTerminalSettingsReadTestSaveAndIndependentRoles; TestTerminalSettingsCASAndCredentialOrigin; TestTerminalSettingsCapacityAndCompactionAgreeWithCore; TestTerminalSettingsMissingAndMalformedConfigRemainUnchanged
// Impact: python -B scripts/code-atlas.py show Client/CLI/host/terminal_api_test.go
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
	"github.com/aieyra/aieyra-os/CORE/platform"
	"github.com/aieyra/aieyra-os/contracts/protocol"
)

func sharedSettingsRoot(t *testing.T) string {
	t.Helper()
	root, err := filepath.Abs("../../..")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(platform.ElectronPath(root)); err != nil {
		t.Skip("shared settings runtime unavailable")
	}
	t.Setenv("AIEYRA_ROOT", root)
	t.Setenv("AIEYRA_CONFIG_URL", "")
	return root
}
func settingsRPC(t *testing.T, s *terminalSettings, action string, args any) map[string]any {
	t.Helper()
	raw, err := json.Marshal(args)
	if err != nil {
		t.Fatal(err)
	}
	if args == nil {
		raw = []byte("{}")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	out, err := s.call(ctx, protocol.TerminalSettingsRequest{Version: protocol.TerminalSettingsVersion, Action: action, Arguments: raw})
	if err != nil {
		t.Fatalf("%s transport failed: %v", action, err)
	}
	if out.Version != protocol.TerminalSettingsVersion {
		t.Fatal("wrong transport version")
	}
	if bytes.Contains(out.Result, []byte("local-fixture-key")) || bytes.Contains(out.Result, []byte("second-fixture-key")) {
		t.Fatalf("%s exposed a fixture credential", action)
	}
	var result map[string]any
	if json.Unmarshal(out.Result, &result) != nil {
		t.Fatalf("%s invalid service JSON", action)
	}
	return result
}
func settingsOK(t *testing.T, s *terminalSettings, action string, args any) map[string]any {
	t.Helper()
	result := settingsRPC(t, s, action, args)
	if result["ok"] != true {
		t.Fatalf("%s failed: %v", action, result["errors"])
	}
	return result
}
func configObject(t *testing.T, path string) map[string]any {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var value map[string]any
	if json.Unmarshal(raw, &value) != nil {
		t.Fatal("invalid fixture config")
	}
	return value
}
func writeConfigObject(t *testing.T, path string, value map[string]any) {
	t.Helper()
	raw, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if os.WriteFile(path, raw, 0600) != nil {
		t.Fatal("write fixture failed")
	}
}
func profileObject(t *testing.T, value map[string]any, id string) map[string]any {
	t.Helper()
	for _, p := range value["api_profiles"].([]any) {
		row := p.(map[string]any)
		if row["id"] == id {
			return row
		}
	}
	t.Fatal("profile not found", id)
	return nil
}

func TestTerminalSettingsTransportForwardsRawJSONAndReceiptScope(t *testing.T) {
	var count atomic.Int32
	var sessions []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var input struct {
			Method  string
			Payload struct {
				Action    string
				Arguments json.RawMessage
				Session   string `json:"session_id"`
			}
		}
		if json.NewDecoder(r.Body).Decode(&input) != nil || input.Method != "system:settings" || input.Payload.Action != "future_settings_action" || !bytes.Contains(input.Payload.Arguments, []byte(`"opaque"`)) {
			t.Error("settings payload changed")
		}
		sessions = append(sessions, input.Payload.Session)
		count.Add(1)
		_, _ = io.WriteString(w, `{ "ok": false, "code":"fixture_conflict", "opaque": {"future":[1,null]} }`)
	}))
	defer server.Close()
	t.Setenv("AIEYRA_CONFIG_URL", server.URL+"/cap/renderer/index.html")
	s := newTerminalSettings(filepath.Join(t.TempDir(), "absent.json"))
	defer s.close()
	r := protocol.TerminalSettingsRequest{Version: 1, Action: "future_settings_action", Arguments: json.RawMessage(`{"opaque":true}`)}
	for range 2 {
		out, err := s.call(context.Background(), r)
		if err != nil || string(out.Result) != `{ "ok": false, "code":"fixture_conflict", "opaque": {"future":[1,null]} }` {
			t.Fatal("raw service result rewritten", err)
		}
	}
	if len(sessions) != 2 || sessions[0] == "" || sessions[0] != sessions[1] {
		t.Fatal("receipt scope not persistent")
	}
	r.Version = 99
	if _, err := s.call(context.Background(), r); err == nil || count.Load() != 2 {
		t.Fatal("unknown transport version reached service")
	}
	s.close()
	r.Version = 1
	if _, err := s.call(context.Background(), r); err == nil || count.Load() != 2 {
		t.Fatal("closed editor accepted a call")
	}
}

func TestTerminalAPISavePreservesExactActiveOSProfile(t *testing.T) {
	sharedSettingsRoot(t)
	var calls atomic.Int32
	path, _ := fixture(t, func(http.ResponseWriter, *http.Request) { calls.Add(1); t.Error("ordinary settings edit called model") })
	raw := configObject(t, path)
	base := raw["api_profiles"].([]any)[0].(map[string]any)
	base["id"], base["name"], base["provider"] = "os-active", "OS Active", "custom"
	base["context_window_source"], base["compact_at_tokens"] = "reviewed_os_source", float64(32768)
	base["enabled"], base["output_limit"], base["vision"] = true, float64(8192), true
	base["parameters"] = map[string]any{"stream": true, "max_tokens": float64(1024), "model_options": map[string]any{"fixture_option": "high"}}
	base["parameter_specs"] = []any{map[string]any{"key": "stream", "type": "boolean"}, map[string]any{"key": "max_tokens", "type": "integer", "min": float64(1), "max": float64(8192)}, map[string]any{"key": "fixture_option", "type": "enum", "values": []any{"low", "high"}}}
	base["future_extension"] = map[string]any{"owner": "os-active"}
	otherBytes, _ := json.Marshal(base)
	var other map[string]any
	_ = json.Unmarshal(otherBytes, &other)
	other["id"], other["name"], other["api_protocol"] = "os-other", "OS Other", "chat_completions"
	other["future_extension"] = map[string]any{"owner": "os-other"}
	raw["api_profiles"] = []any{other, base}
	raw["active_profile"] = "os-active"
	raw["matrix_profile"] = "os-other"
	raw["subconscious_profile"] = "os-other"
	raw["custom_prompt"] = "personal fixture prompt"
	raw["desktop_extension"] = map[string]any{"keep": true}
	connection := raw["provider_connections"].([]any)[0].(map[string]any)
	connection["future_connection"] = true
	connection["request_timeout_seconds"] = float64(417)
	writeConfigObject(t, path, raw)
	s := newTerminalSettings(path)
	defer s.close()
	main := settingsOK(t, s, "connection_draft", nil)
	if main["profile_id"] != "os-other" {
		t.Fatal("current main does not follow OS matrix identity")
	}
	draft := settingsOK(t, s, "connection_draft", map[string]any{"id": "os-active"})
	if draft["profile_id"] != "os-active" || draft["api_protocol"] != "responses" {
		t.Fatal("same-model profiles lost exact identity")
	}
	settingsOK(t, s, "model_update", map[string]any{"id": "os-active", "expected_version": draft["version"], "parameters": map[string]any{"max_tokens": 2048}, "compact_at_tokens": 0})
	saved := configObject(t, path)
	for _, key := range []string{"active_profile", "matrix_profile", "subconscious_profile", "custom_prompt", "desktop_extension"} {
		a, _ := json.Marshal(raw[key])
		b, _ := json.Marshal(saved[key])
		if !bytes.Equal(a, b) {
			t.Fatalf("ordinary edit changed %s", key)
		}
	}
	active := profileObject(t, saved, "os-active")
	for _, key := range []string{"id", "name", "api_protocol", "provider", "future_extension", "context_window_source", "vision"} {
		a, _ := json.Marshal(base[key])
		b, _ := json.Marshal(active[key])
		if !bytes.Equal(a, b) {
			t.Fatalf("profile changed %s", key)
		}
	}
	if active["compact_at_tokens"] != float64(0) || active["parameters"].(map[string]any)["max_tokens"] != float64(2048) || active["parameters"].(map[string]any)["model_options"].(map[string]any)["fixture_option"] != "high" {
		t.Fatal("parameter or automatic-compaction edit lost values")
	}
	if profileObject(t, saved, "os-other")["api_protocol"] != "chat_completions" {
		t.Fatal("edited the wrong same-model profile")
	}
	updated := saved["provider_connections"].([]any)[0].(map[string]any)
	if updated["future_connection"] != true || updated["request_timeout_seconds"] != float64(417) {
		t.Fatal("connection metadata lost")
	}
	read := settingsOK(t, s, "read", nil)
	if read["settings"].(map[string]any)["subconscious_profile"] != "os-other" || calls.Load() != 0 {
		t.Fatal("OS readback changed roles or requested model")
	}
}

func TestTerminalSettingsReadTestSaveAndIndependentRoles(t *testing.T) {
	sharedSettingsRoot(t)
	var models, catalogs atomic.Int32
	path, _ := fixture(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			catalogs.Add(1)
			_ = json.NewEncoder(w).Encode(map[string]any{"data": []any{map[string]any{"id": "fixture-new", "context_window": 128000}}})
			return
		}
		models.Add(1)
		body, _ := io.ReadAll(r.Body)
		if !bytes.Contains(body, []byte("Reply with one short greeting.")) || bytes.Contains(body, []byte("aieyra_probe")) {
			t.Error("detection was not one short text request")
		}
		answer(w, "verified", "hello", nil)
	})
	s := newTerminalSettings(path)
	defer s.close()
	before, _ := os.ReadFile(path)
	for _, action := range []string{"read", "connections", "pool", "onboarding_status", "connection_draft"} {
		settingsOK(t, s, action, nil)
	}
	settingsOK(t, s, "catalog", map[string]any{"connection_id": "test", "offset": 0, "limit": 30, "refresh": false})
	after, _ := os.ReadFile(path)
	if models.Load() != 0 || catalogs.Load() != 0 || !bytes.Equal(before, after) {
		t.Fatal("opening settings invoked upstream or saved")
	}
	draft := settingsOK(t, s, "connection_draft", nil)
	base := draft["base_url"]
	proof := settingsOK(t, s, "response_test", map[string]any{"connection_id": "test", "base_url": base, "model": "fixture-new", "api_protocol": "responses", "compact_at_tokens": 0})
	if models.Load() != 1 || proof["response_received"] != true || proof["tool_roundtrip"] != false {
		t.Fatal("unexpected response-test request count or claim")
	}
	foreign := &terminalSettings{service: s.service, session: "different-settings-session"}
	if result := settingsRPC(t, foreign, "response_save", map[string]any{"test_id": proof["test_id"], "expected_version": proof["version"], "roles": []string{"subconscious"}}); result["ok"] != false {
		t.Fatal("foreign session used a receipt")
	}
	saved := settingsOK(t, s, "response_save", map[string]any{"test_id": proof["test_id"], "expected_version": proof["version"], "roles": []string{"subconscious"}})
	savedBytes, _ := os.ReadFile(path)
	if replay := settingsRPC(t, s, "response_save", map[string]any{"test_id": proof["test_id"], "expected_version": proof["version"], "roles": []string{"main"}}); replay["ok"] != false {
		t.Fatal("a consumed receipt was saved again")
	}
	replayBytes, _ := os.ReadFile(path)
	if !bytes.Equal(savedBytes, replayBytes) || models.Load() != 1 {
		t.Fatal("receipt replay changed configuration or called the model")
	}
	read := settingsOK(t, s, "read", nil)["settings"].(map[string]any)
	if read["active_profile"] != "test-model" || read["matrix_profile"] != "test-model" || read["subconscious_profile"] != saved["model_id"] || models.Load() != 1 {
		t.Fatal("subconscious-only save changed main or called model")
	}
	draft = settingsOK(t, s, "connection_draft", map[string]any{"id": saved["model_id"]})
	if draft["context_window"] != float64(8192) || draft["context_limit"] != nil || draft["compact_at_tokens"] != float64(0) {
		t.Fatal("saved budget not returned by OS draft")
	}
	settingsOK(t, s, "pool_action", map[string]any{"operation": "toggle", "id": saved["model_id"], "expected_version": draft["version"]})
	pool := settingsOK(t, s, "pool", nil)
	if pool["subconscious_profile"] != "" {
		t.Fatal("disabled role remained referenced")
	}
	settingsOK(t, s, "pool_action", map[string]any{"operation": "remove", "id": saved["model_id"], "expected_version": pool["version"]})
	pool = settingsOK(t, s, "pool", nil)
	settingsOK(t, s, "pool_action", map[string]any{"operation": "subconscious", "id": "", "expected_version": pool["version"]})
	if models.Load() != 1 {
		t.Fatal("pool operations called model")
	}
}

func TestTerminalSettingsCASAndCredentialOrigin(t *testing.T) {
	sharedSettingsRoot(t)
	var requests atomic.Int32
	path, _ := fixture(t, func(w http.ResponseWriter, r *http.Request) { requests.Add(1); answer(w, "probe", "hello", nil) })
	s := newTerminalSettings(path)
	defer s.close()
	draft := settingsOK(t, s, "connection_draft", nil)
	for _, p := range []map[string]any{{"profile_id": "test-model", "base_url": "http://127.0.0.1:1/other", "model": "fixture", "api_protocol": "responses"}, {"connection_id": "unknown", "base_url": draft["base_url"], "model": "fixture", "api_protocol": "responses"}} {
		if result := settingsRPC(t, s, "response_test", p); result["ok"] != false {
			t.Fatal("unbound endpoint reused a credential")
		}
	}
	if requests.Load() != 0 {
		t.Fatal("credential-origin failure reached model")
	}
	proof := settingsOK(t, s, "response_test", map[string]any{"profile_id": "test-model", "base_url": draft["base_url"], "model": "fixture", "api_protocol": "responses"})
	raw := configObject(t, path)
	raw["desktop_extension"] = map[string]any{"new": "OS edit"}
	writeConfigObject(t, path, raw)
	before, _ := os.ReadFile(path)
	for _, test := range []struct {
		action string
		args   map[string]any
	}{{"response_save", map[string]any{"test_id": proof["test_id"], "expected_version": proof["version"], "roles": []string{"main"}}}, {"model_update", map[string]any{"id": "test-model", "expected_version": draft["version"], "parameters": map[string]any{"max_tokens": 2048}}}} {
		result := settingsRPC(t, s, test.action, test.args)
		if result["ok"] != false || result["code"] != "version_conflict" {
			t.Fatal("stale writer not rejected")
		}
	}
	after, _ := os.ReadFile(path)
	if !bytes.Equal(before, after) || requests.Load() != 1 {
		t.Fatal("CAS rejection overwrote or retried detection")
	}
}

func TestTerminalSettingsCapacityAndCompactionAgreeWithCore(t *testing.T) {
	sharedSettingsRoot(t)
	path, _ := fixture(t, func(http.ResponseWriter, *http.Request) { t.Error("capacity settings called a provider") })
	config := configObject(t, path)
	p := profileObject(t, config, "test-model")
	p["model"], p["context_window"], p["context_window_source"] = "gemini-4-argon", 380000, "user_config"
	p["compact_at_tokens"] = 1234
	writeConfigObject(t, path, config)
	s := newTerminalSettings(path)
	defer s.close()
	before, _ := os.ReadFile(path)
	draft := settingsOK(t, s, "connection_draft", map[string]any{"id": "test-model"})
	if draft["context_window"] != float64(1048576) || draft["context_limit"] != float64(1048576) || draft["compact_at_tokens"] != float64(1234) {
		t.Fatal("shared settings did not migrate only the old budget", draft["context_window"], draft["context_limit"], draft["compact_at_tokens"])
	}
	for _, raw := range draft["fields"].([]any) {
		if raw.(map[string]any)["key"] == "__param_context_window" {
			t.Fatal("shared service still advertises editable model capacity")
		}
	}
	failed := settingsRPC(t, s, "model_update", map[string]any{"id": "test-model", "expected_version": draft["version"], "context_window": 200000})
	after, _ := os.ReadFile(path)
	if failed["ok"] != false || !bytes.Equal(before, after) {
		t.Fatal("capacity edit wrote configuration")
	}
	saved := settingsOK(t, s, "model_update", map[string]any{"id": "test-model", "expected_version": draft["version"], "compact_at_tokens": 0})
	loaded, err := agent.Load(path)
	if err != nil || loaded.ContextBudget().Window != 1048576 || loaded.ContextBudget().Threshold() != 0 {
		t.Fatal("Core and shared settings disagree on capacity or zero", err)
	}
	stored, _ := os.ReadFile(path)
	conflict := settingsRPC(t, s, "model_update", map[string]any{"id": "test-model", "expected_version": draft["version"], "compact_at_tokens": 2000})
	after, _ = os.ReadFile(path)
	if saved["version"] == draft["version"] || conflict["code"] != "version_conflict" || !bytes.Equal(stored, after) {
		t.Fatal("stale shared settings edit changed the saved trigger")
	}
}

func TestTerminalSettingsMissingAndMalformedConfigRemainUnchanged(t *testing.T) {
	sharedSettingsRoot(t)
	for _, data := range []string{"", "{broken", `{"model":"","api_profiles":[],"active_profile":"","matrix_profile":""}`} {
		path := filepath.Join(t.TempDir(), "config.json")
		if data != "" {
			_ = os.WriteFile(path, []byte(data), 0600)
		}
		s := newTerminalSettings(path)
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		out, err := s.call(ctx, protocol.TerminalSettingsRequest{Version: 1, Action: "connections", Arguments: json.RawMessage(`{}`)})
		cancel()
		s.close()
		if data == "{broken" {
			if err != nil {
				t.Fatalf("malformed config hid its actual error behind startup failure: %v", err)
			}
			var result map[string]any
			_ = json.Unmarshal(out.Result, &result)
			if result["ok"] != false || !strings.Contains(string(out.Result), "解析失败") {
				t.Fatal("malformed config reason missing")
			}
		} else if err != nil {
			t.Fatal("empty settings unavailable", err)
		}
		current, e := os.ReadFile(path)
		if data == "" && !os.IsNotExist(e) || data != "" && (e != nil || string(current) != data) {
			t.Fatal("settings read modified invalid config")
		}
	}
}

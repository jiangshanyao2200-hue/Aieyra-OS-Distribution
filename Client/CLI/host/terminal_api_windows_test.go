// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/CLI/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: prepareCLIAPINativeFixture; handleCLIAPINativeFixture; runCLIAPINativeObservations; observeCLINativeSettingsChild
// Impact: python -B scripts/code-atlas.py show Client/CLI/host/terminal_api_windows_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

//go:build windows

package cli

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
	"unsafe"

	agent "github.com/aieyra/aieyra-os/CORE"
	"golang.org/x/sys/windows"
)

func prepareCLIAPINativeFixture(t *testing.T, path string) {
	t.Helper()
	s, err := agent.Load(path)
	if err != nil {
		t.Fatal(err)
	}
	independent := s.APIProfiles[0]
	independent.ID = "independent-role"
	s.APIProfiles = append(s.APIProfiles, independent)
	s.MatrixProfile, s.SubconsciousProfile = independent.ID, independent.ID
	if err := s.Save(); err != nil {
		t.Fatal(err)
	}
	// OS fields unfamiliar to Go must survive successful shared-service writes.
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var raw map[string]any
	if err := json.Unmarshal(data, &raw); err != nil {
		t.Fatal(err)
	}
	raw["native_extension"] = map[string]any{"preserve": "OS-owned-fixture"}
	// Exercise the complete native editor against an explicit Desktop schema.
	// Legacy Go null/omitted-field interoperability stays covered, unchanged,
	// by TestTerminalAPISavePreservesExactActiveOSProfile and the host RPC test.
	for _, connection := range raw["provider_connections"].([]any) {
		connection.(map[string]any)["api_key_history"] = []any{}
	}
	for _, profile := range raw["api_profiles"].([]any) {
		profile.(map[string]any)["native_profile_extension"] = "preserve-profile"
		profile.(map[string]any)["enabled"] = true
	}
	data, _ = json.MarshalIndent(raw, "", "  ")
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
}

func handleCLIAPINativeFixture(t *testing.T, w http.ResponseWriter, r *http.Request, startup, probes, catalogs *atomic.Int32) {
	t.Helper()
	if r.Method == http.MethodGet && r.URL.Path == "/models" {
		catalogs.Add(1)
		var models []any
		for i := 0; i < 35; i++ {
			models = append(models, map[string]any{"id": fmt.Sprintf("fixture-%02d", i), "name": fmt.Sprintf("合成模型 %02d", i), "context_window": 128000})
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"data": models})
		return
	}
	body, err := io.ReadAll(r.Body)
	if err != nil {
		t.Error(err)
	}
	if r.URL.Path != "/responses" {
		t.Error("unexpected local API path", r.URL.Path)
		http.Error(w, "invalid fixture route", http.StatusBadRequest)
		return
	}
	if bytes.Contains(body, []byte("[Startup connection greeting; no tools or task execution.]")) {
		startup.Add(1)
		answer(w, "startup", "STARTUP_READY", nil)
		return
	}
	probes.Add(1)
	var request struct {
		Tools []any `json:"tools"`
	}
	if json.Unmarshal(body, &request) != nil || len(request.Tools) > 0 || !bytes.Contains(body, []byte("Reply with one short greeting.")) || bytes.Contains(body, []byte("function_call_output")) {
		t.Error("settings verification was not a single short response without tools")
		http.Error(w, "invalid local verification", http.StatusBadRequest)
		return
	}
	answer(w, "api-confirmed", "FIXTURE_RESPONSE_OK", nil)
}

func runCLIAPINativeObservations(t *testing.T, config string, send func(string), output func() string, wait func(string, int), capture func(string) string, resize func(windows.Coord), probes, startup, catalogs *atomic.Int32, bridgePID uint32) {
	t.Helper()
	initial, err := os.ReadFile(config)
	if err != nil {
		t.Fatal(err)
	}
	open := func() {
		t.Helper()
		before := len(output())
		for _, r := range "/api" {
			send(string(r))
			time.Sleep(40 * time.Millisecond)
		}
		send("\r")
		wait("与 Aieyra OS 共用配置", before)
	}
	viewport := windows.Coord{X: 100, Y: 30}
	nativeResize := resize
	resize = func(size windows.Coord) {
		nativeResize(size)
		viewport = size
	}
	var observations []map[string]any
	t.Cleanup(func() {
		if dir := os.Getenv("AIEYRA_CLI_TEST_OUT"); dir != "" {
			data, _ := json.MarshalIndent(map[string]any{"frames": observations, "real_provider_calls": 0}, "", "  ")
			if err := os.WriteFile(filepath.Join(dir, "api-frame-observations.json"), data, 0600); err != nil {
				t.Error(err)
			}
		}
	})
	frame := func(label string, tokens ...string) string {
		t.Helper()
		// Idle resize polling is 250ms. Observe two matching native frames rather
		// than assuming a fixed delay is sufficient. Every request needs a unique
		// label: the bridge and capture reader both cache completed requests.
		start := time.Now()
		deadline := start.Add(3 * time.Second)
		matches, attempts := 0, 0
		var text string
		var missing []string
		for time.Now().Before(deadline) {
			attempts++
			name := label
			if attempts > 1 {
				name = fmt.Sprintf("%s-settle-%02d", label, attempts)
			}
			text = capture(name)
			missing = nil
			for _, token := range tokens {
				if !strings.Contains(text, token) {
					missing = append(missing, token)
				}
			}
			if len(strings.Split(text, "\n")) != int(viewport.Y) {
				missing = append(missing, fmt.Sprintf("viewport height %d", viewport.Y))
			}
			if len(missing) == 0 {
				matches++
			} else {
				matches = 0
			}
			if matches == 2 {
				observations = append(observations, map[string]any{"label": label, "first_capture": label + ".json", "accepted_capture": name + ".json", "attempts": attempts, "expected_tokens": tokens, "viewport": viewport, "elapsed_ms": time.Since(start).Milliseconds(), "accepted_at_utc": time.Now().UTC()})
				return text
			}
			time.Sleep(60 * time.Millisecond)
		}
		observations = append(observations, map[string]any{"label": label, "first_capture": label + ".json", "attempts": attempts, "missing": missing, "viewport": viewport, "elapsed_ms": time.Since(start).Milliseconds(), "passed": false})
		t.Fatalf("%s did not settle; missing %q after %d captures: %s", label, missing, attempts, text)
		return ""
	}
	paste := func(value string) { send("\x1b[200~" + value + "\x1b[201~") }
	unchanged := func() {
		t.Helper()
		after, err := os.ReadFile(config)
		if err != nil || !bytes.Equal(initial, after) {
			t.Fatal("read/cancel/invalid draft changed synthetic config", err)
		}
	}
	open()
	frame("api-overview-wide", "Eyra API", "主意识", "潜意识", "independent-role", "test-model")
	verifySettingsExit := observeCLINativeSettingsChild(t, bridgePID)
	if probes.Load() != 0 || catalogs.Load() != 0 {
		t.Fatal("opening settings contacted the local model")
	}
	send("\x1b1\t\t")
	paste("fixture-draft-not-a-real-key")
	masked := frame("api-key-masked", "API Key", "•")
	if strings.Contains(masked, "fixture-draft-not-a-real-key") {
		t.Fatal("API page exposed a synthetic credential")
	}
	resize(windows.Coord{X: 40, Y: 8})
	frame("api-short-key", "API Key", "•", "草稿已修改")
	send("\x1b2")
	paste("中文 👩‍💻 é " + strings.Repeat("完整中文片段", 8) + "模型名字")
	frame("api-unicode-caret", "模型", "模型名字")
	send("\x1b")
	time.Sleep(100 * time.Millisecond)
	unchanged()
	resize(windows.Coord{X: 100, Y: 30})
	open()
	send("\r") // Exact main draft; active_profile has a separate identity.
	wait("按精确档案编辑", 0)
	send("\x1b3")
	frame("api-budget-wide", "上下文窗口", "128000", "开始压缩")
	paste("bad")
	before := len(output())
	send("\x1bOS")
	wait("上下文窗口需在", before)
	resize(windows.Coord{X: 40, Y: 8})
	frame("api-context-invalid", "上下文", "bad", "8192")
	unchanged()
	if probes.Load() != 0 || catalogs.Load() != 0 {
		t.Fatal("invalid budget made a model/catalog request")
	}
	paste("96000")
	send("\t")
	paste("0")
	frame("api-compact-disabled", "0", "草稿已修改")
	before = len(output())
	send("\x1bOS") // Shared model_update, no network test for this exact identity.
	wait("已保存到共享 OS 配置", before)
	frame("api-parameters-saved-short", "主意识", "已保存")
	s, err := agent.Load(config)
	if err != nil || s.MatrixProfile != "independent-role" || s.ActiveProfile != "test-model" || s.SubconsciousProfile != "independent-role" {
		t.Fatal("budget update changed independent roles", err)
	}
	for _, p := range s.APIProfiles {
		if p.ID == "independent-role" && (p.ContextWindow != 96000 || p.CompactAtTokens == nil || *p.CompactAtTokens != 0) {
			t.Fatal("Go readback lost the exact budget", p)
		}
	}
	resize(windows.Coord{X: 100, Y: 30})
	send("\x1b0")
	frame("api-overview-after-update", "independent-role", "test-model")
	send("\x1b2\x1bOQ") // F2: cached read, zero provider requests.
	frame("api-cache-empty", "0/0", "没有匹配模型")
	if probes.Load() != 0 || catalogs.Load() != 0 {
		t.Fatal("cached catalog read made a network request")
	}
	send("\x1b") // Close picker only, then observe it before another ESC sequence.
	frame("api-cache-closed", "Eyra API", "联网更新目录")
	before = len(output())
	send("\x1b[1;3Q") // Alt+F2: explicit network refresh.
	wait("模型 1/35", before)
	frame("api-models-first", "1/35", "fixture-00")
	send("\x1b[F")
	frame("api-models-last", "35/35", "fixture-34")
	paste("fixture-2")
	frame("api-models-filtered", "1/10", "fixture-2")
	send("\x1b[F")
	frame("api-models-filtered-last", "10/10", "fixture-29")
	send("\r")
	wait("参数来自共享设置", 0)
	frame("api-model-applied", "上下文窗口", "128000", "流式", "开启")
	paste("96000")
	send("\t")
	paste("0")
	send("\t\x1b[C") // Explicitly change the shared default: true -> false.
	frame("api-parameter-edited", "96000", "0", "流式", "关闭")
	before = len(output())
	send("\x1bOR") // F3: exactly one response call, no tool roundtrip.
	wait("文字响应通过", before)
	frame("api-response-roles-wide", "[✓] 主意识", "[✓] 潜意识", "文字响应通过", "工具/图片未检测")
	send(" ") // Only assign subconscious.
	frame("api-subconscious-only", "[ ] 主意识", "[✓] 潜意识")
	before = len(output())
	send("\x1bOS") // F4: receipt save, zero new generation.
	wait("已保存到共享 OS 配置", before)
	resize(windows.Coord{X: 40, Y: 8})
	frame("api-save-short", "[ ] 主意识", "[✓] 潜意识", "已保存")
	resize(windows.Coord{X: 100, Y: 30})
	send("\x1b2")
	frame("api-save-model-wide", "fixture-29", "responses")
	send("\x1b3")
	frame("api-save-budget-wide", "96000", "开始压缩", "流式", "关闭")
	s, err = agent.Load(config)
	if err != nil || s.Model != "fixture" || s.MatrixProfile != "independent-role" || s.ActiveProfile != "test-model" || s.SubconsciousProfile == "independent-role" || s.APIKey != "local-fixture-key" {
		t.Fatal("subconscious-only save changed main or the wrong profile", err)
	}
	found := false
	for _, p := range s.APIProfiles {
		if p.ID == s.SubconsciousProfile {
			var params map[string]any
			_ = json.Unmarshal(p.Parameters, &params)
			found = p.Model == "fixture-29" && p.ContextWindow == 96000 && p.CompactAtTokens != nil && *p.CompactAtTokens == 0 && params["stream"] == false
		}
	}
	if !found {
		t.Fatal("Go readback lost the new profile, budget or parameters")
	}
	raw, err := os.ReadFile(config)
	if err != nil || !bytes.Contains(raw, []byte("OS-owned-fixture")) || bytes.Count(raw, []byte("preserve-profile")) != 2 {
		t.Fatal("shared save lost unfamiliar OS fields", err)
	}
	if startup.Load() != 1 || probes.Load() != 1 || catalogs.Load() != 1 {
		t.Fatal("unexpected synthetic request counts", startup.Load(), probes.Load(), catalogs.Load())
	}
	if strings.Contains(output(), "fixture-draft-not-a-real-key") || strings.Contains(output(), "local-fixture-key") {
		t.Fatal("API stream exposed a synthetic credential")
	}
	send("\x1b")
	time.Sleep(100 * time.Millisecond)
	send("\x15\x11")
	wait("CONSOLE_MODES_RESTORED", 0)
	wait("CONSOLE_MAIN_BUFFER_EXITED", 0)
	verifySettingsExit()
	t.Log("actual shared CLI API: exact identities, grouped settings, masked/cancelled Key, Unicode caret, 40x8/100x30, cached-only read, explicit refresh, pagination/filter/End, parameters/budget, one-response receipt, subconscious-only save, Go/Desktop readback, restored console and owned child release passed; real provider calls 0")
}

// A retained kernel handle distinguishes graceful close from eventual harness
// job cleanup. Inspect only the exact owned CLI process tree, never kill others.
func observeCLINativeSettingsChild(t *testing.T, bridgePID uint32) func() {
	t.Helper()
	snapshot, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer windows.CloseHandle(snapshot)
	entry := windows.ProcessEntry32{Size: uint32(unsafe.Sizeof(windows.ProcessEntry32{}))}
	parents := map[uint32]uint32{}
	names := map[uint32]string{}
	for err = windows.Process32First(snapshot, &entry); err == nil; err = windows.Process32Next(snapshot, &entry) {
		parents[entry.ProcessID] = entry.ParentProcessID
		names[entry.ProcessID] = windows.UTF16ToString(entry.ExeFile[:])
	}
	var cliPID, settingsPID uint32
	for pid, parent := range parents {
		if parent == bridgePID && strings.Contains(strings.ToLower(names[pid]), "aieyra-cli") {
			if cliPID != 0 {
				t.Fatal("ambiguous owned CLI child")
			}
			cliPID = pid
		}
	}
	for pid, parent := range parents {
		if parent == cliPID && strings.EqualFold(names[pid], "electron.exe") {
			if settingsPID != 0 {
				t.Fatal("ambiguous directly owned settings child")
			}
			settingsPID = pid
		}
	}
	if cliPID == 0 || settingsPID == 0 {
		t.Fatal("missing real CLI/settings process", cliPID, settingsPID)
	}
	handle, err := windows.OpenProcess(windows.SYNCHRONIZE|windows.PROCESS_QUERY_LIMITED_INFORMATION, false, settingsPID)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { windows.CloseHandle(handle) })
	var created, exited, kernel, user windows.Filetime
	if err := windows.GetProcessTimes(handle, &created, &exited, &kernel, &user); err != nil {
		t.Fatal(err)
	}
	return func() {
		t.Helper()
		state, err := windows.WaitForSingleObject(handle, 0)
		var code uint32
		codeErr := windows.GetExitCodeProcess(handle, &code)
		if err != nil || state != windows.WAIT_OBJECT_0 || codeErr != nil || code != 0 {
			t.Fatal("CLI returned before graceful settings child exit", state, code, err, codeErr)
		}
		proof := map[string]any{"bridge_pid": bridgePID, "cli_pid": cliPID, "settings_pid": settingsPID, "created_at_utc": time.Unix(0, created.Nanoseconds()).UTC(), "kernel_wait": state, "exit_code": code, "observed_before_job_cleanup": true}
		if dir := os.Getenv("AIEYRA_CLI_TEST_OUT"); dir != "" {
			data, _ := json.MarshalIndent(proof, "", "  ")
			if err := os.WriteFile(filepath.Join(dir, "api-settings-child-release.json"), data, 0600); err != nil {
				t.Fatal(err)
			}
		}
		t.Logf("native settings release pid=%d exit=%d kernel wait=%d before job cleanup", settingsPID, code, state)
	}
}

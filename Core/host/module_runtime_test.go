// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/host/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestRuntimeLaunchAuthenticatesAndForwardsModule; TestRuntimeExclusionReleasesWithoutDeletingLockFile; TestDesktopModuleValidationUsesPublicCatalog; TestDesktopModuleValidationIncludesActualProgramNavigation
// Impact: python -B scripts/code-atlas.py show Core/host/module_runtime_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package host

import (
	"encoding/json"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRuntimeLaunchAuthenticatesAndForwardsModule(t *testing.T) {
	dir := t.TempDir()
	config := filepath.Join(dir, "config.json")
	runtimeDir := filepath.Join(dir, "runtime", "modules")
	_ = os.MkdirAll(runtimeDir, 0700)
	server, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()
	token := strings.Repeat("a", 64)
	record := map[string]any{"protocol": "aieyra-module/1", "id": "os", "pid": 123, "port": server.Addr().(*net.TCPAddr).Port, "token": token}
	data, _ := json.Marshal(record)
	_ = os.WriteFile(filepath.Join(runtimeDir, "os.json"), data, 0600)
	received := make(chan map[string]any, 1)
	go func() {
		conn, err := server.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		dec, enc := json.NewDecoder(conn), json.NewEncoder(conn)
		var hello, request map[string]any
		if dec.Decode(&hello) != nil || hello["token"] != token {
			return
		}
		_ = enc.Encode(map[string]any{"type": "welcome", "module": "os", "pid": 123})
		if dec.Decode(&request) != nil {
			return
		}
		received <- request
		_ = enc.Encode(map[string]any{"type": "response", "id": "launch", "ok": true, "result": map[string]any{"ok": true}})
	}()
	reused, err := reuseModuleRuntime(config, "browser")
	if err != nil || !reused {
		t.Fatalf("reuse=%v err=%v", reused, err)
	}
	request := <-received
	params := request["params"].(map[string]any)
	if request["method"] != "module_action" || params["module"] != "browser" || params["action"] != "detach" {
		t.Fatalf("wrong request: %#v", request)
	}
}

func TestRuntimeExclusionReleasesWithoutDeletingLockFile(t *testing.T) {
	file := filepath.Join(t.TempDir(), "runtime.lock")
	first, err := os.OpenFile(file, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		t.Fatal(err)
	}
	defer first.Close()
	second, err := os.OpenFile(file, os.O_RDWR, 0600)
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()
	if err = lockModuleRuntime(first); err != nil {
		t.Fatal(err)
	}
	if lockModuleRuntime(second) == nil {
		t.Fatal("two owners acquired one runtime")
	}
	_ = first.Close()
	if err = lockModuleRuntime(second); err != nil {
		t.Fatal(err)
	}
}

func TestDesktopModuleValidationUsesPublicCatalog(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "Client/Desktop", "host")
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(dir, "module-catalog.json")
	if err := os.WriteFile(file, []byte(`[{"id":"home","detachable":false},{"id":"browser"},{"id":"future-module"}]`), 0600); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"", "browser", "future-module"} {
		if err := ValidateDesktopModule(root, id); err != nil {
			t.Fatalf("catalog entry %q rejected: %v", id, err)
		}
	}
	if ValidateDesktopModule(root, "home") == nil {
		t.Fatal("fixed Home accepted as standalone")
	}
	if ValidateDesktopModule(root, "workspace") == nil {
		t.Fatal("unregistered module accepted")
	}
	if err := os.WriteFile(file, []byte(`broken`), 0600); err != nil {
		t.Fatal(err)
	}
	if ValidateDesktopModule(root, "browser") == nil {
		t.Fatal("malformed catalog accepted")
	}
	if err := ValidateDesktopModule(root, ""); err != nil {
		t.Fatal("ordinary launch must not depend on module catalog validation", err)
	}
}

func TestDesktopModuleValidationIncludesActualProgramNavigation(t *testing.T) {
	root, err := filepath.Abs("../..")
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"browser", "servers", "link", "contacts", "settings", "together"} {
		if err := ValidateDesktopModule(root, id); err != nil {
			t.Fatalf("real launcher module %q: %v", id, err)
		}
	}
	if ValidateDesktopModule(root, "notes") == nil {
		t.Fatal("retired notes Program admitted")
	}
	if ValidateDesktopModule(root, "unregistered-program") == nil {
		t.Fatal("unknown Program admitted")
	}
	isolated := t.TempDir()
	for _, name := range []string{"Client/Desktop/host/module-catalog.json", "Program/official/catalog.json", "Program/official/browser/manifest.json", "Program/official/browser/program.json"} {
		data, err := os.ReadFile(filepath.Join(root, name))
		if err != nil {
			t.Fatal(err)
		}
		target := filepath.Join(isolated, name)
		if err := os.MkdirAll(filepath.Dir(target), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(target, data, 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err := ValidateDesktopModule(isolated, "browser"); err != nil {
		t.Fatal(err)
	}
	manifest := filepath.Join(isolated, "Program/official/browser/manifest.json")
	data, _ := os.ReadFile(manifest)
	data = []byte(strings.Replace(string(data), `"aieyra.browser"`, `"aieyra.other"`, 1))
	if err := os.WriteFile(manifest, data, 0600); err != nil {
		t.Fatal(err)
	}
	if ValidateDesktopModule(isolated, "browser") == nil {
		t.Fatal("mismatched Program identity admitted")
	}
	if err := os.WriteFile(filepath.Join(isolated, "Program/official/catalog.json"), []byte(`["../browser"]`), 0600); err != nil {
		t.Fatal(err)
	}
	if ValidateDesktopModule(isolated, "../browser") == nil {
		t.Fatal("traversing Program catalogue admitted")
	}
}

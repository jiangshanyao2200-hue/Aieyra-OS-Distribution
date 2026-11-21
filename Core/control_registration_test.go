// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestControlRegistrationExistingStorage
// Impact: python -B scripts/code-atlas.py show Core/control_registration_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// 登记必须复用真实存储，缺失和错误定位不能悄悄创建第二个工位。
func TestControlRegistrationExistingStorage(t *testing.T) {
	root := t.TempDir()
	app := filepath.Join(root, "Control", "app")
	if err := os.MkdirAll(filepath.Join(app, "service"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(app, "service", "main.py"), []byte("fixture"), 0600); err != nil {
		t.Fatal(err)
	}
	locator := filepath.Join(root, "storage.json")
	t.Setenv("AIEYRA_ROOT", root)
	t.Setenv("AIEYRA_CONTROL_DATA_DIR", "")
	t.Setenv("AIEYRA_CONTROL_DATA", "")
	t.Setenv("AIEYRA_CONTROL_STORAGE", locator)
	exe := filepath.Join(root, "Aieyra OS.exe")
	if got, err := controlRegistrationDirectory(exe); err != nil || got != "" {
		t.Fatalf("missing store: %q, %v", got, err)
	}
	if _, err := os.Stat(filepath.Join(root, "Control", "共享库")); !os.IsNotExist(err) {
		t.Fatal("missing store created a new office")
	}
	data := filepath.Join(root, "Control", "共享库", "private", "data")
	shared := filepath.Join(data, "shared")
	if err := os.MkdirAll(shared, 0700); err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(map[string]any{"schema_version": 1, "data_root": data})
	if err := os.WriteFile(locator, append([]byte{0xef, 0xbb, 0xbf}, raw...), 0600); err != nil {
		t.Fatal(err)
	}
	if got, err := controlRegistrationDirectory(exe); err != nil || got != shared {
		t.Fatalf("existing store: %q, %v", got, err)
	}
	for _, raw := range []string{"{", `{"schema_version":2,"data_root":"/example"}`, `{"schema_version":1,"data_root":"relative"}`} {
		if err := os.WriteFile(locator, []byte(raw), 0600); err != nil {
			t.Fatal(err)
		}
		if _, err := controlRegistrationDirectory(exe); err == nil {
			t.Fatal("invalid locator accepted")
		}
	}
	// Python's data-root override and Go's shared-directory override have
	// different meanings, but must resolve the same existing office.
	t.Setenv("AIEYRA_CONTROL_DATA", data)
	if got, err := controlRegistrationDirectory(exe); err != nil || got != shared {
		t.Fatalf("data root override: %q, %v", got, err)
	}
	missingRoot := filepath.Join(root, "missing-root")
	t.Setenv("AIEYRA_CONTROL_DATA", missingRoot)
	if _, err := controlRegistrationDirectory(exe); err == nil {
		t.Fatal("missing data root accepted")
	}
	if _, err := os.Stat(missingRoot); !os.IsNotExist(err) {
		t.Fatal("missing data root created a new office")
	}
	t.Setenv("AIEYRA_CONTROL_DATA", "relative")
	if _, err := controlRegistrationDirectory(exe); err == nil {
		t.Fatal("relative data root accepted")
	}
	t.Setenv("AIEYRA_CONTROL_DATA", data)
	t.Setenv("AIEYRA_CONTROL_DATA_DIR", filepath.Join(root, "missing"))
	if _, err := controlRegistrationDirectory(exe); err == nil || !strings.Contains(err.Error(), "拒绝新建空工位") {
		t.Fatal("missing explicit data accepted", err)
	}
	t.Setenv("AIEYRA_CONTROL_DATA_DIR", app)
	if _, err := controlRegistrationDirectory(exe); err == nil {
		t.Fatal("private data inside software accepted")
	}
	redirect := filepath.Join(root, "redirect")
	if err := os.Symlink(app, redirect); err != nil {
		t.Log("symlink unavailable; direct isolation already verified")
	} else {
		t.Setenv("AIEYRA_CONTROL_DATA_DIR", redirect)
		if _, err := controlRegistrationDirectory(exe); err == nil {
			t.Fatal("redirect into software accepted")
		}
	}
	if err := os.Remove(filepath.Join(app, "service", "main.py")); err != nil {
		t.Fatal(err)
	}
	if got, err := controlRegistrationDirectory(exe); err != nil || got != "" {
		t.Fatalf("missing internal module: %q, %v", got, err)
	}
}

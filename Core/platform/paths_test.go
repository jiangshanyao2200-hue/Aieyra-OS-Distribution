// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/platform/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestDefaultOSWorkdirHonoursOverrideAndCreatesIt; TestReadOnlyInstallationUsesWritableUserWorkspace; TestExplicitUnwritableWorkspaceNeverFallsBack; TestDefaultOSWorkdirLivesBesideTheApp
// Impact: python -B scripts/code-atlas.py show Core/platform/paths_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package platform

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestDefaultOSWorkdirHonoursOverrideAndCreatesIt(t *testing.T) {
	want := filepath.Join(t.TempDir(), "产物", "Aieyra")
	t.Setenv("AIEYRA_WORKDIR", want)
	got, err := DefaultOSWorkdir()
	if err != nil || got != want {
		t.Fatalf("DefaultOSWorkdir() = %q, %v; want %q", got, err, want)
	}
	if info, err := os.Stat(want); err != nil || !info.IsDir() {
		t.Fatalf("workdir not created: %v", err)
	}
}

func TestReadOnlyInstallationUsesWritableUserWorkspace(t *testing.T) {
	base := t.TempDir()
	app := filepath.Join(base, "read-only-installation")
	user := filepath.Join(base, "user")
	got, err := defaultOSWorkdir(app, "", func() (string, error) { return user, nil }, func(dir string) error {
		if dir == filepath.Join(app, "工作目录") {
			return os.ErrPermission
		}
		return writableWorkdir(dir)
	})
	if err != nil || got != filepath.Join(user, "AieyraOS", "工作目录") {
		t.Fatal(got, err)
	}
	entries, err := os.ReadDir(got)
	if err != nil || len(entries) != 0 {
		t.Fatal("workspace probe leaked files", entries, err)
	}
	if _, err := os.Stat(app); !os.IsNotExist(err) {
		t.Fatal("read-only installation changed", err)
	}
}

func TestExplicitUnwritableWorkspaceNeverFallsBack(t *testing.T) {
	explicit := filepath.Join(t.TempDir(), "selected")
	got, err := defaultOSWorkdir("unused", explicit, func() (string, error) {
		t.Fatal("explicit selection attempted fallback")
		return "", nil
	}, func(dir string) error {
		if dir != explicit {
			t.Fatal("wrong write target", dir)
		}
		return os.ErrPermission
	})
	if got != "" || !errors.Is(err, os.ErrPermission) {
		t.Fatal(got, err)
	}
}

func TestDefaultOSWorkdirLivesBesideTheApp(t *testing.T) {
	root := t.TempDir()
	t.Setenv("AIEYRA_WORKDIR", "")
	t.Setenv("AIEYRA_ROOT", root)
	got, err := DefaultOSWorkdir()
	if want := filepath.Join(root, "工作目录"); err != nil || got != want {
		t.Fatalf("DefaultOSWorkdir() = %q, %v; want %q", got, err, want)
	}
}

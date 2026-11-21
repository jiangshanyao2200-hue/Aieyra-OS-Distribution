// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/internal/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestCredentialReplacementAndFailedWriteKeepOriginal
// Impact: python -B scripts/code-atlas.py show Core/internal/privatefile/file_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package privatefile

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestCredentialReplacementAndFailedWriteKeepOriginal(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "credential.json")
	for _, text := range []string{"first synthetic credential", "updated synthetic credential"} {
		if err := Write(path, []byte(text)); err != nil {
			t.Fatal(err)
		}
		b, err := os.ReadFile(path)
		if err != nil || string(b) != text {
			t.Fatal("credential did not persist", err)
		}
		info, err := os.Stat(path)
		if err != nil {
			t.Fatal(err)
		}
		if runtime.GOOS != "windows" && info.Mode().Perm() != 0600 {
			t.Fatal("credential permissions", info.Mode())
		}
	}
	target := filepath.Join(dir, "existing-directory")
	if err := os.Mkdir(target, 0700); err != nil {
		t.Fatal(err)
	}
	if err := Write(target, []byte("must not replace directory")); err == nil {
		t.Fatal("overwrote a directory")
	}
	if b, err := os.ReadFile(path); err != nil || string(b) != "updated synthetic credential" {
		t.Fatal("unrelated credential changed", err)
	}
	if files, _ := filepath.Glob(filepath.Join(dir, ".aieyra-private-*.tmp")); len(files) != 0 {
		t.Fatal("private temporary file was left behind")
	}
}

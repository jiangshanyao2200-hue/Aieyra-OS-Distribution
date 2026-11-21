// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/CLI/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: TestConfigureBeforeConfigAndPromptsAreUsable; TestModelOptionIsNeverSilentlyIgnored
// Impact: python -B scripts/code-atlas.py show Client/CLI/host/settings_entry_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package cli

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/aieyra/aieyra-os/contracts/protocol"
)

func TestConfigureBeforeConfigAndPromptsAreUsable(t *testing.T) {
	for _, data := range []string{"", `{broken`, `{"prompt_dir":"missing-prompts"}`} {
		t.Run(data, func(t *testing.T) {
			file := filepath.Join(t.TempDir(), "config.json")
			if data != "" {
				if err := os.WriteFile(file, []byte(data), 0600); err != nil {
					t.Fatal(err)
				}
			}
			called := false
			err := ConfigureWithTerminal(context.Background(), file, "test", strings.NewReader(""), io.Discard, func(_ context.Context, o protocol.TerminalOptions) (bool, error) {
				called = true
				if !o.SettingsOnly || o.Open != nil || o.Settings == nil || o.API != nil {
					t.Fatal("settings editor opened an executor")
				}
				return true, nil
			})
			if err != nil || !called {
				t.Fatal("settings bootstrap unavailable", err)
			}
			b, err := os.ReadFile(file)
			if data == "" && !os.IsNotExist(err) || data != "" && (err != nil || string(b) != data) {
				t.Fatal("settings changed without save")
			}
		})
	}
}

func TestModelOptionIsNeverSilentlyIgnored(t *testing.T) {
	_, _, err := runTest(t, []string{"run", "--model", "fixture", "--config", filepath.Join(t.TempDir(), "absent.json"), "-p", "task"}, "")
	if err == nil || !strings.Contains(err.Error(), "--model is supported by init") {
		t.Fatal(err)
	}
}

// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Link/app/link-core/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: TestPrivatePromptFile; TestPromptFileFlagsFailBeforeIdentityOrNetwork
// Impact: python -B scripts/code-atlas.py show Link/app/link-core/link/cli_prompt_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package link

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPrivatePromptFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "prompt.txt")
	for _, tc := range []struct {
		name  string
		text  []byte
		valid bool
	}{
		{"unicode-and-newlines", []byte("一张图，保留换行\n第二行 😊"), true},
		{"limit", []byte(strings.Repeat("x", 16000)), true},
		{"over-limit", []byte(strings.Repeat("x", 16001)), false},
		{"invalid-utf8", []byte{0xff}, false},
		{"nul", []byte("secret\x00text"), false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if err := os.WriteFile(path, tc.text, 0600); err != nil {
				t.Fatal(err)
			}
			text, err := readPromptFile(path)
			if (err == nil) != tc.valid {
				t.Fatalf("valid=%v, err=%v", tc.valid, err)
			}
			if tc.valid && text != string(tc.text) {
				t.Fatal("prompt bytes changed")
			}
			if err != nil && strings.Contains(err.Error(), "secret") {
				t.Fatal("private prompt leaked in diagnostic")
			}
		})
	}
	if _, err := readPromptFile(dir); err == nil {
		t.Fatal("accepted a directory")
	}
	if _, err := readPromptFile(filepath.Join(dir, "missing")); err == nil {
		t.Fatal("accepted a missing file")
	}
}

func TestPromptFileFlagsFailBeforeIdentityOrNetwork(t *testing.T) {
	for _, args := range [][]string{
		{"send", "--prompt-file", "missing", "-p", ""},
		{"answer", "--prompt-file", "missing", "-p", "private prompt"},
		{"answer", "--prompt-file", "missing", "--option", "approved"},
		{"answer", "-p", "private prompt", "--option", "approved"},
		{"status", "--prompt-file", "missing"},
		{"send", "--prompt-file", "missing"},
	} {
		err := Run(context.Background(), args, io.Discard, io.Discard)
		if err == nil || !strings.Contains(err.Error(), "prompt-file") && !strings.Contains(err.Error(), "prompt file") && !strings.Contains(err.Error(), "mutually exclusive") {
			t.Fatalf("args=%v, err=%v", args[:1], err)
		}
		if strings.Contains(err.Error(), "private prompt") {
			t.Fatal("prompt leaked")
		}
	}
}

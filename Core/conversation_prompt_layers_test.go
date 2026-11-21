// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestBuiltinEyraConversationUsesSharedPromptLayers
// Impact: python -B scripts/code-atlas.py show Core/conversation_prompt_layers_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"crypto/sha256"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestBuiltinEyraConversationUsesSharedPromptLayers(t *testing.T) {
	defaults := map[string]string{
		PromptFileSelf:     "DEFAULT_SELF",
		PromptFileWork:     "DEFAULT_WORK",
		PromptFileBoundary: "DEFAULT_BOUNDARY",
		PromptFileThinking: "DEFAULT_THINKING",
	}
	defaultText := "DEFAULT_SELF\n\nDEFAULT_WORK\n\nDEFAULT_BOUNDARY\n\nDEFAULT_THINKING"
	for _, tc := range []struct {
		name     string
		personal map[string]string
		restore  bool
		want     string
	}{
		{name: "missing_uses_defaults", want: defaultText},
		{name: "mixed_missing_custom_and_empty", personal: map[string]string{PromptFileWork: "\uFEFFCUSTOM_WORK\r\n", PromptFileBoundary: ""}, want: "DEFAULT_SELF\n\nCUSTOM_WORK\n\nDEFAULT_THINKING"},
		{name: "all_empty_stays_empty", personal: map[string]string{PromptFileSelf: "", PromptFileWork: "", PromptFileBoundary: "", PromptFileThinking: ""}},
		{name: "restored_files_use_defaults", personal: map[string]string{PromptFileSelf: "CUSTOM_SELF", PromptFileWork: "CUSTOM_WORK", PromptFileBoundary: "", PromptFileThinking: "CUSTOM_THINKING"}, restore: true, want: defaultText},
	} {
		t.Run(tc.name, func(t *testing.T) {
			root, personal := t.TempDir(), t.TempDir()
			t.Setenv("AIEYRA_RESOURCE_ROOT", root)
			write := func(name string, data []byte) {
				t.Helper()
				if err := os.MkdirAll(filepath.Dir(name), 0700); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(name, data, 0600); err != nil {
					t.Fatal(err)
				}
			}
			var resources []map[string]any
			for name, text := range defaults {
				path := "Agent/official/Eyra/prompts/default/" + name
				write(filepath.Join(root, filepath.FromSlash(path)), []byte(text))
				resources = append(resources, map[string]any{"file": "Matrix/默认/" + name, "path": path, "legacy_sha256": fmt.Sprintf("%x", sha256.Sum256([]byte(text))), "read_only": true})
			}
			identity := "INDEPENDENT_EYRA_SESSION"
			identityPath := "Agent/official/Eyra/prompts/delegation/Eyra会话.txt"
			write(filepath.Join(root, filepath.FromSlash(identityPath)), []byte(identity))
			resources = append(resources, map[string]any{"file": "子代/模板/Eyra会话.txt", "path": identityPath, "legacy_sha256": fmt.Sprintf("%x", sha256.Sum256([]byte(identity)))})
			write(filepath.Join(root, "Config", "提示词索引.json"), rawJSON(map[string]any{"version": 1, "resources": resources}))
			write(filepath.Join(root, "Config", "默认设置.json"), []byte("{}"))
			for name, text := range tc.personal {
				write(filepath.Join(personal, name), []byte(text))
			}
			if tc.restore {
				for name := range tc.personal {
					if err := os.Remove(filepath.Join(personal, name)); err != nil {
						t.Fatal(err)
					}
				}
			}
			config := filepath.Join(t.TempDir(), "config.json")
			write(config, rawJSON(map[string]any{"prompt_dir": personal}))
			m := &AgentManager{config: config, dir: t.TempDir()}
			id := builtinContactID("eyra")
			if err := m.writeContact(conversationContact{ID: id, Builtin: "eyra"}); err != nil {
				t.Fatal(err)
			}
			got, err := m.conversationPrompt(AgentRecord{Spec: AgentSpec{ProfileID: id}})
			if err != nil {
				t.Fatal(err)
			}
			if want := tc.want + "\n" + identity; got != want {
				t.Fatalf("contact prompt disagrees with missing/custom/empty semantics:\n got: %q\nwant: %q", got, want)
			}
			if strings.Count(got, identity) != 1 {
				t.Fatal("independent session identity duplicated")
			}
			entries, err := os.ReadDir(personal)
			if err != nil {
				t.Fatal(err)
			}
			count := len(tc.personal)
			if tc.restore {
				count = 0
			}
			if len(entries) != count {
				t.Fatal("reading the prompt created personal layers")
			}
			for name, text := range tc.personal {
				data, err := os.ReadFile(filepath.Join(personal, name))
				if tc.restore {
					if !os.IsNotExist(err) {
						t.Fatal("restored layer was recreated")
					}
				} else if err != nil || string(data) != text {
					t.Fatalf("reading modified personal layer %s", name)
				}
			}
		})
	}
}

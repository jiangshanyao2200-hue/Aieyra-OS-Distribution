// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestFixedTeamReadsEveryEditablePromptLayer; TestEditedRuntimePromptHasNoEmbeddedFallbackOrFormatArtifacts
// Impact: python -B scripts/code-atlas.py show Core/runtime_prompt_edit_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestFixedTeamReadsEveryEditablePromptLayer(t *testing.T) {
	root := t.TempDir()
	t.Setenv("AIEYRA_RESOURCE_ROOT", root)
	for _, row := range []struct{ name, role string }{{"Cota", WorkspaceExecution}, {"Vaya", WorkspaceProject}} {
		file := filepath.Join(root, "Prompt", row.name, "提示词.txt")
		if err := os.MkdirAll(filepath.Dir(file), 0700); err != nil {
			t.Fatal(err)
		}
		text := "用户前言\n## 角色\nSELF_EDIT\n## 协定\nWORK_EDIT\n## 安全与边界\nBOUNDARY_EDIT\n## 思考方式\nTHINKING_EDIT\n## 自定义附录\nUNKNOWN_EDIT\n"
		if err := os.WriteFile(file, []byte(text), 0600); err != nil {
			t.Fatal(err)
		}
		if got := teamRolePrompt(row.role); got != text {
			t.Fatalf("%s lost edited layers: %q", row.name, got)
		}
		w := &Workspace{}
		if got := w.teamContract(row.role); strings.Contains(got, "WORK_EDIT") || strings.Contains(got, "SELF_EDIT") {
			t.Fatalf("role prompt was injected twice: %q", got)
		}
		if err := os.WriteFile(file, nil, 0600); err != nil {
			t.Fatal(err)
		}
		if got := teamRolePrompt(row.role); got != "" {
			t.Fatalf("empty override restored instructions: %q", got)
		}
	}
}

func TestEditedRuntimePromptHasNoEmbeddedFallbackOrFormatArtifacts(t *testing.T) {
	root := t.TempDir()
	t.Setenv("AIEYRA_RESOURCE_ROOT", root)
	file := filepath.Join(root, "Prompt", "custom.txt")
	if err := os.MkdirAll(filepath.Dir(file), 0700); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct{ text, want string }{
		{"目标 %s 完成 %d 项", "目标 demo 完成 3 项"},
		{"用户自己的文字，完成度 100%", "用户自己的文字，完成度 100%"},
		{"", ""},
		{"保留 %% 和 %unknown", "保留 % 和 %unknown"},
	} {
		if err := os.WriteFile(file, []byte(tc.text), 0600); err != nil {
			t.Fatal(err)
		}
		if got := formatPromptText(runtimePrompt("custom.txt"), "demo", 3); got != tc.want {
			t.Fatalf("edited prompt: got %q, want %q", got, tc.want)
		}
	}
	if err := os.Remove(file); err != nil {
		t.Fatal(err)
	}
	if _, err := readPromptResource("custom.txt"); err == nil {
		t.Fatal("missing file not reported")
	}
	if got := runtimePrompt("custom.txt"); got != "" {
		t.Fatal("embedded fallback", got)
	}
}

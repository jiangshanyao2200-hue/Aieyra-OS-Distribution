// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestRuntimeResourcesAndChildPromptReload; TestCompanionContractUsesEditableResourceRoot
// Impact: python -B scripts/code-atlas.py show Core/runtime_resources_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRuntimeResourcesAndChildPromptReload(t *testing.T) {
	root := t.TempDir()
	t.Setenv("AIEYRA_RESOURCE_ROOT", root)
	write := func(name, text string) {
		t.Helper()
		file := filepath.Join(root, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(file), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(file, []byte(text), 0600); err != nil {
			t.Fatal(err)
		}
	}
	write("Config/默认设置.json", `{}`)
	write("Config/模型资料.json", `{}`)
	write("Config/OpenCode模型.json", `{}`)
	write("Config/运行参数.json", `{}`)
	write("Config/模型目录.json", `{"models":[{"id":"fixture"}]}`)
	write("Config/提示词索引.json", `{"resources":[{"file":"子代/模板/提示词.txt"}]}`)
	write("Prompt/子代/模板/提示词.txt", "template")
	if err := validateRuntimeResources(); err != nil {
		t.Fatal(err)
	}
	config := filepath.Join(root, "Config", "config.json")
	if got := DataDir(config); got != filepath.Join(root, "Data") {
		t.Fatal(got)
	}
	id := strings.Repeat("a", 32)
	first, err := loadChildPrompt(config, id, "original task")
	if err != nil || !strings.Contains(first, "template\n\noriginal task") {
		t.Fatalf("create: %q %v", first, err)
	}
	child, _ := childPromptFile(config, id)
	if err := os.WriteFile(child, []byte("edited child"), 0600); err != nil {
		t.Fatal(err)
	}
	second, err := loadChildPrompt(config, id, "must not overwrite")
	if err != nil || second != "edited child" {
		t.Fatalf("reload: %q %v", second, err)
	}
	if _, err = childPromptFile(config, "../escape"); err == nil {
		t.Fatal("accepted invalid child id")
	}
	write("Prompt/子代/模板/提示词.txt", "new template")
	if got, err := readPromptResource("子代/模板/提示词.txt"); err != nil || got != "new template" {
		t.Fatalf("prompt reload: %q %v", got, err)
	}
	write("Config/模型目录.json", `broken json`)
	if err := validateRuntimeResources(); err == nil {
		t.Fatal("corrupt catalog silently accepted")
	}
	write("Config/模型目录.json", `{"models":[{"id":"fixture"}]}`)
	if err := os.Remove(filepath.Join(root, "Prompt", "子代", "模板", "提示词.txt")); err != nil {
		t.Fatal(err)
	}
	if _, err := loadChildPrompt(config, strings.Repeat("b", 32), "new task"); err == nil {
		t.Fatal("missing template silently accepted")
	}
	if err := os.WriteFile(child, []byte{0xff}, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := loadChildPrompt(config, id, "new task"); err == nil {
		t.Fatal("invalid UTF-8 silently accepted")
	}
}

func TestCompanionContractUsesEditableResourceRoot(t *testing.T) {
	root := t.TempDir()
	t.Setenv("AIEYRA_RESOURCE_ROOT", root)
	t.Setenv("AIEYRA_ROOT", t.TempDir())
	dir := filepath.Join(root, "Prompt", "Matrix", "运行协定")
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	write := func(name, text string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(dir, name+".txt"), []byte(text), 0600); err != nil {
			t.Fatal(err)
		}
	}
	write("桌面说明", "桌面隔离说明")
	write("命令行说明", "命令行隔离说明")
	previous := baseToolMode
	baseToolMode = true
	t.Cleanup(func() { baseToolMode = previous })
	if got := companionContract(false); got != "命令行隔离说明" {
		t.Fatalf("CLI resource root: %q", got)
	}
	if got := companionContract(true); got != "桌面隔离说明" {
		t.Fatalf("team resource root: %q", got)
	}
	write("桌面说明", "人工修改的桌面说明")
	baseToolMode = false
	if got := companionContract(false); got != "人工修改的桌面说明" {
		t.Fatalf("desktop reload: %q", got)
	}
}

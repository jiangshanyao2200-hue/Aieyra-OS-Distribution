// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestFourPromptCategoriesAndOptionalThinking; TestPromptDefaultsPreserveExplicitEmptyAndCustomFiles
// Impact: python -B scripts/code-atlas.py show Core/prompt_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// 覆盖真实读盘和旧三文件目录的兼容性，避免只测手工排好序的 Layer 切片。
func TestFourPromptCategoriesAndOptionalThinking(t *testing.T) {
	t.Setenv("AIEYRA_RESOURCE_ROOT", t.TempDir())
	dir := t.TempDir()
	files := map[string]string{
		PromptFileThinking: "\uFEFF<!-- 仅供人阅读 -->\r\n先查证。\r\n",
		PromptFileSelf:     "测试身份",
		PromptFileWork:     "测试做法",
		PromptFileBoundary: "测试边界",
	}
	for name, body := range files {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0600); err != nil {
			t.Fatal(err)
		}
	}
	check := func(want string) {
		t.Helper()
		st, err := LoadPrompts(dir)
		if err != nil {
			t.Fatal(err)
		}
		if st.Text != want {
			t.Fatalf("提示词顺序或空层处理不符：%q", st.Text)
		}
		var ids []string
		for _, layer := range st.Layers {
			ids = append(ids, layer.ID)
		}
		if strings.Join(ids, ",") != "self,work,boundary,thinking" {
			t.Fatalf("装载清单不符：%v", ids)
		}
	}
	legacy := "测试身份\n\n测试做法\n\n测试边界"
	check(legacy + "\n\n先查证。")
	thinking := filepath.Join(dir, PromptFileThinking)
	if err := os.Remove(thinking); err != nil {
		t.Fatal(err)
	}
	check(legacy)
	if _, err := os.Stat(thinking); !os.IsNotExist(err) {
		t.Fatal("装载不能补建思考方式文件")
	}
	if err := os.WriteFile(thinking, []byte("<!-- 仅保留说明 -->\n "), 0600); err != nil {
		t.Fatal(err)
	}
	check(legacy)
	for name, body := range files {
		if name == PromptFileThinking {
			continue
		}
		got, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil || string(got) != body {
			t.Fatalf("装载改动了已有文件 %s", name)
		}
	}
}

func TestPromptDefaultsPreserveExplicitEmptyAndCustomFiles(t *testing.T) {
	dir, defaults := t.TempDir(), t.TempDir()
	os.WriteFile(filepath.Join(defaults, PromptFileThinking), []byte("默认思考"), 0600)
	os.WriteFile(filepath.Join(defaults, PromptFileWork), []byte("默认工作"), 0600)
	os.WriteFile(filepath.Join(dir, PromptFileWork), []byte(""), 0600)
	os.WriteFile(filepath.Join(dir, PromptFileSelf), []byte("\uFEFF个人\r\n"), 0600)
	layers, err := LoadPromptLayersWithDefaults(dir, defaults)
	if err != nil {
		t.Fatal(err)
	}
	if layers[3].Body != "默认思考" || layers[3].Source != "default" || layers[1].Source != "custom" || !layers[1].Empty() {
		t.Fatal(layers)
	}
	if layers[0].Body != "个人" || layers[2].Source != "missing" {
		t.Fatal(layers)
	}
	entries, _ := os.ReadDir(dir)
	if len(entries) != 2 {
		t.Fatal("read created files")
	}
	for _, bad := range [][]byte{{0xff}, []byte(strings.Repeat("x", (256<<10)+1))} {
		os.WriteFile(filepath.Join(dir, PromptFileSelf), bad, 0600)
		if _, err := LoadPromptLayersWithDefaults(dir, defaults); err == nil {
			t.Fatal("invalid override silently fell back")
		}
	}
}

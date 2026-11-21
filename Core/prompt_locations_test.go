// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestDefaultLayersResolveIndividuallyAndKeepEmptyOverrides; TestMappedPromptsUsePackageBytesAndPreserveLegacyOverrides
// Impact: python -B scripts/code-atlas.py show Core/prompt_locations_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

func TestDefaultLayersResolveIndividuallyAndKeepEmptyOverrides(t *testing.T) {
	root := t.TempDir()
	t.Setenv("AIEYRA_RESOURCE_ROOT", root)
	put := func(name, text string) string {
		t.Helper()
		file := filepath.Join(root, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(file), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(file, []byte(text), 0600); err != nil {
			t.Fatal(err)
		}
		return file
	}
	rows := []map[string]any{}
	for _, id := range LayerIDs() {
		name, _, _ := layerSpec(id)
		old, target := "Prompt/Matrix/默认/"+name, "Agent/official/Eyra/prompts/default/"+name
		put(old, "original "+id)
		put(target, "packaged "+id)
		rows = append(rows, map[string]any{"file": "Matrix/默认/" + name, "path": target, "legacy_sha256": fmt.Sprintf("%x", sha256.Sum256([]byte("original "+id))), "read_only": true})
	}
	index, _ := json.Marshal(map[string]any{"resources": rows})
	put("Config/提示词索引.json", string(index))
	// Four distinct cases coexist: personal blank, personal text, modified old
	// default blank, and an untouched old default superseded by package text.
	put("personal/自我.txt", "")
	put("personal/工作.txt", "personal work")
	put("Prompt/Matrix/默认/边界.txt", "")
	status, err := LoadPrompts(filepath.Join(root, "personal"))
	if err != nil {
		t.Fatal(err)
	}
	want := []struct{ body, source, path string }{
		{"", "custom", "personal/自我.txt"},
		{"personal work", "custom", "personal/工作.txt"},
		{"", "default", "Prompt/Matrix/默认/边界.txt"},
		{"packaged thinking", "default", "Agent/official/Eyra/prompts/default/思考方式.txt"},
	}
	for i, expected := range want {
		layer := status.Layers[i]
		if layer.Body != expected.body || layer.Source != expected.source || layer.Path != filepath.Join(root, filepath.FromSlash(expected.path)) {
			t.Fatalf("layer %s = %#v", layer.ID, layer)
		}
	}
	if err := os.Remove(filepath.Join(root, "Prompt", "Matrix", "默认", "思考方式.txt")); err != nil {
		t.Fatal(err)
	}
	status, err = LoadPrompts(filepath.Join(root, "personal"))
	if err != nil || status.Layers[3].Body != "packaged thinking" {
		t.Fatalf("without retired legacy: %#v, %v", status, err)
	}
	put("Agent/official/Eyra/prompts/default/思考方式.txt", string([]byte{0xff}))
	if _, err := LoadPrompts(filepath.Join(root, "personal")); err == nil {
		t.Fatal("invalid mapped default silently accepted")
	}
}

func TestMappedPromptsUsePackageBytesAndPreserveLegacyOverrides(t *testing.T) {
	for _, mapping := range [][2]string{{"Vaya/提示词.txt", "Agent/official/Vaya/prompts/提示词.txt"}, {"Matrix/工具说明/持久计划.txt", "Tool/base/official/update_plan/manual.txt"}} {
		t.Run(mapping[1], func(t *testing.T) {
			root := t.TempDir()
			t.Setenv("AIEYRA_RESOURCE_ROOT", root)
			write := func(name string, data []byte) {
				t.Helper()
				file := filepath.Join(root, filepath.FromSlash(name))
				if err := os.MkdirAll(filepath.Dir(file), 0700); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(file, data, 0600); err != nil {
					t.Fatal(err)
				}
			}
			legacy, target := "Prompt/"+mapping[0], mapping[1]
			old := []byte("## 角色\noriginal public text\n")
			index := map[string]any{"resources": []any{map[string]any{"file": mapping[0] + "#角色", "path": target, "legacy_sha256": fmt.Sprintf("%x", sha256.Sum256(old))}}}
			data, _ := json.Marshal(index)
			write("Config/提示词索引.json", data)
			write(legacy, old)
			write(target, []byte("## 角色\npackage revision\n"))
			check := func(want string) {
				t.Helper()
				got, err := readPromptResource(mapping[0] + "#角色")
				if err != nil || got != want {
					t.Fatalf("got %q, %v; want %q", got, err, want)
				}
			}
			check("package revision")
			write(legacy, []byte("## 角色\nuser override\n"))
			check("user override")
			write(legacy, nil)
			check("")
			if err := os.Remove(filepath.Join(root, filepath.FromSlash(legacy))); err != nil {
				t.Fatal(err)
			}
			check("package revision")
			write("Data/Overrides/"+target, []byte("## 角色\nprivate module override\n"))
			check("private module override")
			if err := os.Remove(filepath.Join(root, "Data", "Overrides", filepath.FromSlash(target))); err != nil {
				t.Fatal(err)
			}
			write(target, []byte{0xff})
			if _, err := readPromptResource(mapping[0] + "#角色"); err == nil {
				t.Fatal("invalid package UTF-8 was accepted")
			}
			write("Config/提示词索引.json", []byte(`{"resources":[{"file":"Vaya/提示词.txt","path":"Data/private.txt"}]}`))
			if _, err := readPromptResource(mapping[0] + "#角色"); err == nil {
				t.Fatal("invalid mapping silently fell back")
			}
		})
	}
}

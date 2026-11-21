// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Contracts/resources/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestPromptIndexMapsFragmentsAndRejectsConflicts; TestToolPromptPathsAreBoundedAndMapped
// Impact: python -B scripts/code-atlas.py show Contracts/resources/prompts_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package resources

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestPromptIndexMapsFragmentsAndRejectsConflicts(t *testing.T) {
	row := map[string]string{"file": "Vaya/提示词.txt#角色", "path": "Agent/official/Vaya/prompts/提示词.txt", "legacy_sha256": strings.Repeat("a", 64)}
	parse := func(rows ...map[string]string) (*PromptIndex, error) {
		data, _ := json.Marshal(map[string]any{"resources": rows})
		return ParsePromptIndex(data)
	}
	index, err := parse(row)
	if err != nil {
		t.Fatal(err)
	}
	loc, err := index.Lookup("Vaya/提示词.txt#协定")
	if err != nil || loc.Path != row["path"] || loc.Legacy != "Prompt/Vaya/提示词.txt" || len(index.Files()) != 1 {
		t.Fatal(loc, err)
	}
	for _, target := range []string{"Data/private.txt", "Agent/third-party/other/prompts/text.txt", "Agent/official/Vaya/prompts/../private.txt", "Agent/official/Vaya/prompts/a.txt.backup", "/outside.txt"} {
		bad := map[string]string{"file": row["file"], "path": target, "legacy_sha256": row["legacy_sha256"]}
		if _, err := parse(bad); err == nil {
			t.Fatal("accepted target", target)
		}
	}
	other := map[string]string{"file": "Vaya/提示词.txt#协定", "path": "Agent/official/Vaya/prompts/another.txt", "legacy_sha256": row["legacy_sha256"]}
	if _, err := parse(row, other); err == nil {
		t.Fatal("ambiguous fragment mapping")
	}
	for _, name := range []string{"../Data/private.txt", "a//b.txt", "a/./b.txt", "file.txt#"} {
		if _, err := index.Lookup(name); err == nil {
			t.Fatal("accepted logical name", name)
		}
	}
}

func TestToolPromptPathsAreBoundedAndMapped(t *testing.T) {
	for _, target := range []string{"Tool/base/official/web_search/manual/method.txt", "Tool/base/official/web_search/prompts/search.txt", "Tool/toolbox/official/imagegen/manual.txt"} {
		data, _ := json.Marshal(map[string]any{"resources": []map[string]string{{"file": "Matrix/工具说明/查询.txt", "path": target, "legacy_sha256": strings.Repeat("b", 64)}}})
		idx, err := ParsePromptIndex(data)
		if err != nil {
			t.Fatal(target, err)
		}
		loc, err := idx.Lookup("Matrix/工具说明/查询.txt")
		if err != nil || loc.Path != target {
			t.Fatal(loc, err)
		}
	}
	for _, target := range []string{"Tool/base/third-party/search/manual.txt", "Tool/base/official/web_search/private.txt", "Tool/base/official/web_search/manual/../private.txt", "Tool/base/official/web_search/manual/deep/part.txt", "Tool/base/official/web_search/manual/method.txt.backup", "Tool/base/official/web_search/prompts/space .txt"} {
		if ToolManual(target) {
			t.Fatal("unsafe prompt admitted", target)
		}
	}
}

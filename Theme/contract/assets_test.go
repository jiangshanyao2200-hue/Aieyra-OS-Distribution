// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Theme/contract/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: TestThemeAssetBytesAndReferences
// Impact: python -B scripts/code-atlas.py show Theme/contract/assets_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package contract

import (
	"os"
	"path/filepath"
	"testing"
)

func TestThemeAssetBytesAndReferences(t *testing.T) {
	root := filepath.Join("..", "..", "SDK", "examples", "theme-assets")
	raw, err := os.ReadFile(filepath.Join(root, "theme.json"))
	if err != nil {
		t.Fatal(err)
	}
	p, err := Decode(raw)
	if err != nil {
		t.Fatal(err)
	}
	files := map[string][]byte{}
	for _, a := range p.Assets {
		files[a.Path], err = os.ReadFile(filepath.Join(root, filepath.FromSlash(a.Path)))
		if err != nil {
			t.Fatal(err)
		}
	}
	if err = p.ValidateFiles(files); err != nil {
		t.Fatal(err)
	}
	for name, change := range map[string]func(map[string][]byte){
		"missing":                      func(f map[string][]byte) { delete(f, "assets/paper.png") },
		"script masquerading as image": func(f map[string][]byte) { f["assets/paper.png"] = []byte(`<svg onload="alert(1)"/>`) },
		"truncated image":              func(f map[string][]byte) { f["assets/paper.png"] = f["assets/paper.png"][:32] },
		"truncated font":               func(f map[string][]byte) { f["assets/inter.woff2"] = f["assets/inter.woff2"][:48] },
		"oversize":                     func(f map[string][]byte) { f["assets/paper.png"] = make([]byte, 8*1024*1024+1) },
	} {
		t.Run(name, func(t *testing.T) {
			f := map[string][]byte{}
			for k, v := range files {
				f[k] = v
			}
			change(f)
			if p.ValidateFiles(f) == nil {
				t.Fatal("accepted invalid asset bytes")
			}
		})
	}
	for _, raw := range []string{
		`{"schema":"aieyra.theme/1","elements":"1.0.0","assets":{"picture":{"path":"assets/../secret.png","mime":"image/png"}}}`,
		`{"schema":"aieyra.theme/1","elements":"1.0.0","styles":[{"element":"body","properties":{"background":"asset(missing)"}}]}`,
		`{"schema":"aieyra.theme/1","elements":"1.0.0","assets":{"picture":{"path":"assets/a.png","mime":"image/png"}},"styles":[{"element":"body","properties":{"font-family":"asset(picture)"}}]}`,
		`{"schema":"aieyra.theme/1","elements":"1.0.0","tokens":{"--ui-image":"asset (picture)"}}`,
	} {
		if _, err := Decode([]byte(raw)); err == nil {
			t.Fatalf("accepted invalid asset reference: %s", raw)
		}
	}
}

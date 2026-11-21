// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Contracts/storage/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestOriginMappingPreservesUnicodeSuffixAndExternalPaths; TestPreviousPathsExcludeShadowedMappingsAndRetainAllMovedIdentities
// Impact: python -B scripts/code-atlas.py show Contracts/storage/origins_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package storage

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestOriginMappingPreservesUnicodeSuffixAndExternalPaths(t *testing.T) {
	config := profileFixture(t)
	p, err := Inspect(config)
	if err != nil {
		t.Fatal(err)
	}
	d := OriginDocument{Schema: 1, ProfileID: p.ID, Mappings: []Origin{{From: `C:\fixtures\Kelvin\旧资料`, To: "Assets", Directory: true, Windows: true}}}
	b, _ := json.Marshal(d)
	if err = os.WriteFile(filepath.Join(p.Root, OriginsFile), b, 0600); err != nil {
		t.Fatal(err)
	}
	p, err = Bind(config)
	if err != nil {
		t.Fatal(err)
	}
	if got := p.Relocate(`c:\fixtures\kelvin\旧资料\İmage\Case.PNG`); got != filepath.Join(p.Root, "Assets", "İmage", "Case.PNG") {
		t.Fatal(got)
	}
	if got := p.PreviousPaths(filepath.Join(p.Root, "Assets", "İmage", "Case.PNG")); !reflect.DeepEqual(got, []string{`C:\fixtures\Kelvin\旧资料\İmage\Case.PNG`}) {
		t.Fatal("former identity lost original case or Unicode", got)
	}
	if got := p.PreviousPaths(filepath.Join(p.Root, "Assets-sibling", "Case.PNG")); len(got) != 0 {
		t.Fatal("sibling inherited unrelated identity", got)
	}
	for _, old := range []string{`C:\fixtures\elsewhere\file.PNG`, `C:\fixtures\Kelvin\旧资料-sibling\file.PNG`} {
		if p.Relocate(old) != old {
			t.Fatal("external path changed")
		}
	}
	d.Mappings[0].To = "../outside"
	if ValidateOrigins(d, p.ID) == nil {
		t.Fatal("mapping escaped root")
	}
}

func TestPreviousPathsExcludeShadowedMappingsAndRetainAllMovedIdentities(t *testing.T) {
	config := profileFixture(t)
	p, err := Inspect(config)
	if err != nil {
		t.Fatal(err)
	}
	d := OriginDocument{Schema: 1, ProfileID: p.ID, Mappings: []Origin{
		{From: "/old", To: "Legacy", Directory: true},
		{From: "/old/separate", To: "Assets", Directory: true},
		{From: "/second", To: ".", Directory: true},
		{From: "/third", To: ".", Directory: true},
	}}
	data, _ := json.Marshal(d)
	if err = os.WriteFile(filepath.Join(p.Root, OriginsFile), data, 0600); err != nil {
		t.Fatal(err)
	}
	p, err = Bind(config)
	if err != nil {
		t.Fatal(err)
	}
	got := p.PreviousPaths(filepath.Join(p.Root, "Legacy", "separate", "file"))
	want := []string{"/second/Legacy/separate/file", "/third/Legacy/separate/file"}
	if !reflect.DeepEqual(got, want) {
		t.Fatal("shadowed former path was admitted", got)
	}
	if got = p.PreviousPaths(filepath.Join(p.Root, "Legacy", "project")); !reflect.DeepEqual(got, []string{"/old/project", "/second/Legacy/project", "/third/Legacy/project"}) {
		t.Fatal(got)
	}
}

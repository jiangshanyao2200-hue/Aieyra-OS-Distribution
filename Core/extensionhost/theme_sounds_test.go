// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/extensionhost/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestThemeSoundPackageAdmission
// Impact: python -B scripts/code-atlas.py show Core/extensionhost/theme_sounds_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package extensionhost

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/aieyra/aieyra-os/CORE/modules"
)

func TestThemeSoundPackageAdmission(t *testing.T) {
	source, err := filepath.Abs(filepath.Join("..", "..", "SDK", "examples", "theme-sounds"))
	if err != nil {
		t.Fatal(err)
	}
	m := New(t.TempDir(), Desktop())
	p, err := m.Inspect(context.Background(), source)
	if err != nil || !p.Compatibility.Compatible {
		t.Fatalf("sound example invalid: %+v %v", p, err)
	}
	old := Desktop()
	old.Contracts["theme"] = "1.3.0"
	p, err = New(t.TempDir(), old).Inspect(context.Background(), source)
	if err != nil || p.Compatibility.Compatible {
		t.Fatalf("old host admitted sound contract: %+v %v", p, err)
	}
	pkg, err := modules.Load(context.Background(), source)
	if err != nil {
		t.Fatal(err)
	}
	pkg.Files["assets/complete.wav"] = []byte("invalid WAV")
	if m.ValidatePackage(pkg) == nil {
		t.Fatal("corrupt theme sound admitted")
	}
}

// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/extensionhost/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestOfficialBrowserUpgradePreLifecycle104Bindings; TestOfficialBrowserUpgradePreRecovery104Bindings; verifyFrozenBrowserUpgrade
// Impact: python -B scripts/code-atlas.py show Core/extensionhost/official_browser_lifecycle104_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package extensionhost

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"testing"

	"github.com/aieyra/aieyra-os/CORE/modules"
)

func TestOfficialBrowserUpgradePreLifecycle104Bindings(t *testing.T) {
	verifyFrozenBrowserUpgrade(t, "testdata/browser-before-lifecycle104.json", "1.1.2", "afabd8548844efa68ee10a0f21206dfa0e65ebec1490f4893eb21fbbb296f380")
}

func TestOfficialBrowserUpgradePreRecovery104Bindings(t *testing.T) {
	verifyFrozenBrowserUpgrade(t, "testdata/browser-before-recovery104.json", "1.1.3", "c8f0409605ef6d156b7a70698c6f75150c88407054dd95a5155ab27888c1ba3f")
}

func verifyFrozenBrowserUpgrade(t *testing.T, fixture, version, expectedSHA string) {
	t.Helper()
	raw, err := os.ReadFile(fixture)
	if err != nil {
		t.Fatal(err)
	}
	// Frozen payloads are the actual prior packages, with every file SHA verified.
	hash := sha256.Sum256(raw)
	if hex.EncodeToString(hash[:]) != expectedSHA {
		t.Fatal("frozen pre-fix browser payload changed")
	}
	var files map[string][]byte
	if err := json.Unmarshal(raw, &files); err != nil {
		t.Fatal(err)
	}
	prior, err := modules.FromFiles(files)
	if err != nil {
		t.Fatal(err)
	}
	if prior.Manifest.ID != "aieyra.browser" || prior.Manifest.Version != version {
		t.Fatal("historical browser fixture differs from the verified source backup")
	}
	t.Log("verified pre-fix browser manifest digest", prior.Digest)
	verifyOfficialProgramUpgrade(t, prior, "service/browser-runtime.cjs")
}

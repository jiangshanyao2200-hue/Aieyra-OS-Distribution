// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/CLI/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: TestAgentCommandsUseExistingCoreWithoutModelCall
// Impact: python -B scripts/code-atlas.py show Client/CLI/host/agents_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package cli

import (
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"testing"

	agent "github.com/aieyra/aieyra-os/CORE"
)

func TestAgentCommandsUseExistingCoreWithoutModelCall(t *testing.T) {
	config, project := fixture(t, func(http.ResponseWriter, *http.Request) { t.Error("management called a model") })
	h := agent.NewWorkspaceHost(config, "", "")
	h.SetTerminal()
	if err := h.SetMode(agent.HostCLI); err != nil {
		t.Fatal(err)
	}
	defer h.Close()
	d, err := h.Open("", project)
	if err != nil {
		t.Fatal(err)
	}
	for _, action := range []string{"sources", "list", "models"} {
		out, _, err := runTest(t, []string{"agents", "--discovery", d["discovery"].(string)}, `{"action":"`+action+`"}`)
		if err != nil || !json.Valid([]byte(out)) {
			t.Fatal(action, out, err)
		}
		if strings.Contains(out, d["token"].(string)) {
			t.Fatal("discovery secret leaked")
		}
	}
	data, _ := json.Marshal(map[string]any{"session_id": d["session_id"], "token": d["token"], "url": "https://example.org/v1/rpc"})
	file := t.TempDir() + "/untrusted.json"
	if err = os.WriteFile(file, data, 0600); err != nil {
		t.Fatal(err)
	}
	if _, _, err := runTest(t, []string{"agents", "--discovery", file}, `{"action":"list"}`); err == nil {
		t.Fatal("remote credential forwarding allowed")
	}
}

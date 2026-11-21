// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/CLI/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: catalogReference; terminalCatalogReference; terminalReferences; loadTerminalReferences
// Impact: python -B scripts/code-atlas.py show Client/CLI/host/terminal_catalog.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package cli

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"

	agent "github.com/aieyra/aieyra-os/CORE"
)

type catalogReference struct {
	Name, Protocol string
	Context        int
}

// CLI and desktop read one editable catalog. Actual provider responses still
// decide which models exist; these rows only supply reviewed metadata.
func terminalCatalogReference(baseURL, model string) (catalogReference, bool) {
	provider := ""
	switch strings.TrimRight(baseURL, "/") {
	case "https://openrouter.ai/api/v1":
		provider = "openrouter"
	case "https://opencode.ai/zen/v1":
		provider = "opencode"
	case "https://opencode.ai/zen/go/v1":
		provider = "opencode-go"
	default:
		return catalogReference{}, false
	}
	stamp := agent.ResourceRoot()
	for _, name := range []string{"OpenCode模型.json", "模型资料.json"} {
		info, err := os.Stat(filepath.Join(agent.ResourceRoot(), "Config", name))
		if err != nil {
			return catalogReference{}, false
		}
		stamp += fmt.Sprintf("|%s:%d:%d", name, info.ModTime().UnixNano(), info.Size())
	}
	terminalReferences.Lock()
	defer terminalReferences.Unlock()
	if terminalReferences.stamp != stamp {
		rows, err := loadTerminalReferences()
		if err != nil {
			return catalogReference{}, false
		}
		terminalReferences.stamp, terminalReferences.rows = stamp, rows
	}
	row, ok := terminalReferences.rows[provider][model]
	return row, ok
}

var terminalReferences = struct {
	sync.Mutex
	stamp string
	rows  map[string]map[string]catalogReference
}{}

func loadTerminalReferences() (map[string]map[string]catalogReference, error) {
	type metadata struct {
		Name     string                `json:"name"`
		Protocol string                `json:"api_protocol"`
		Context  int                   `json:"context_window"`
		Limit    struct{ Context int } `json:"limit"`
		Provider struct{ NPM string }  `json:"provider"`
	}
	rows := map[string]map[string]catalogReference{}
	for _, name := range []string{"OpenCode模型.json", "模型资料.json"} {
		var bundle struct {
			Providers map[string]map[string]metadata
		}
		if err := agent.ReadRuntimeConfig(name, &bundle); err != nil {
			return nil, err
		}
		for provider, models := range bundle.Providers {
			if rows[provider] == nil {
				rows[provider] = map[string]catalogReference{}
			}
			for id, row := range models {
				result := rows[provider][id]
				if row.Context == 0 {
					row.Context = row.Limit.Context
				}
				if provider == "openrouter" {
					row.Protocol = agent.ProtocolChat
				} else if protocol := map[string]string{"@ai-sdk/openai": agent.ProtocolResponses, "@ai-sdk/openai-compatible": agent.ProtocolChat, "@ai-sdk/anthropic": agent.ProtocolMessages, "@ai-sdk/google": agent.ProtocolGoogle}[row.Provider.NPM]; protocol != "" {
					row.Protocol = protocol
				}
				if row.Protocol == "" {
					row.Protocol = result.Protocol
				}
				if row.Context < 8192 || row.Context > 10000000 {
					continue
				}
				switch row.Protocol {
				case agent.ProtocolChat, agent.ProtocolResponses, agent.ProtocolMessages, agent.ProtocolGoogle:
					rows[provider][id] = catalogReference{Name: row.Name, Protocol: row.Protocol, Context: row.Context}
				}
			}
		}
	}
	return rows, nil
}

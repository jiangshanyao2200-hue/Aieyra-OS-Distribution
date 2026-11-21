// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/CLI/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: terminalSettings; newTerminalSettings; call; close
// Impact: python -B scripts/code-atlas.py show Client/CLI/host/terminal_api.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package cli

import (
	"context"
	"fmt"

	agent "github.com/aieyra/aieyra-os/CORE"
	"github.com/aieyra/aieyra-os/contracts/protocol"
)

// A settings editor has its own receipt scope, independent of work tasks. The
// shared service starts on its first Call and is closed by the owning CLI.
type terminalSettings struct {
	service *agent.SettingsService
	session string
}

func newTerminalSettings(config string) *terminalSettings {
	return &terminalSettings{service: agent.NewSettingsService(config), session: "cli-settings-" + identifier()}
}

func (s *terminalSettings) call(ctx context.Context, r protocol.TerminalSettingsRequest) (protocol.TerminalSettingsResponse, error) {
	if r.Version != protocol.TerminalSettingsVersion {
		return protocol.TerminalSettingsResponse{}, fmt.Errorf("unsupported terminal settings transport version %d", r.Version)
	}
	result, err := s.service.Call(ctx, s.session, r.Action, r.Arguments)
	return protocol.TerminalSettingsResponse{Version: protocol.TerminalSettingsVersion, Result: result}, err
}

func (s *terminalSettings) close() { s.service.Close() }

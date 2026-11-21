// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/CLI/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: interactiveHost; open; close
// Impact: python -B scripts/code-atlas.py show Client/CLI/host/interactive.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package cli

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	agent "github.com/aieyra/aieyra-os/CORE"
	"github.com/aieyra/aieyra-os/contracts/protocol"
)

// 设置先于执行器可用；核心启动失败不会封死修复 API 的入口。
type interactiveHost struct {
	mu      sync.Mutex
	options options
	version string
	host    *agent.WorkspaceHost
	closed  bool
	primary *client
}

func (h *interactiveHost) open(ctx context.Context, id string) (protocol.TerminalSession, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed {
		return protocol.TerminalSession{}, fmt.Errorf("终端已关闭")
	}
	if err := ctx.Err(); err != nil {
		return protocol.TerminalSession{}, err
	}
	o := h.options
	if h.host == nil {
		s, err := agent.Load(o.config)
		if err != nil {
			return protocol.TerminalSession{}, fmt.Errorf("共享配置无法读取；输入 /api 打开 Eyra API")
		}
		if err = s.Validate(); err != nil {
			return protocol.TerminalSession{}, fmt.Errorf("模型配置尚未就绪；输入 /api 打开 Eyra API")
		}
		if o.promptDir != "" {
			s.PromptDir = o.promptDir
		}
		prompts, err := agent.LoadPrompts(s.PromptDir)
		if err != nil {
			return protocol.TerminalSession{}, err
		}
		s.SetLoadedPrompt(prompts.Text)
		if o.workdir == "" {
			o.workdir, err = os.Getwd()
		} else {
			o.workdir, err = filepath.Abs(o.workdir)
		}
		if err != nil {
			return protocol.TerminalSession{}, err
		}
		h.options.workdir = o.workdir
		host := agent.NewWorkspaceHost(s.Path(), s.EffectiveSystemPrompt(), agent.ResolvePromptDir(s.PromptDir))
		host.SetVersion(h.version)
		host.SetTerminal()
		if err = host.SetMode(agent.HostCLI); err != nil {
			host.Close()
			return protocol.TerminalSession{}, err
		}
		host.SetControl(o.control)
		h.host = host
	}
	if h.primary == nil {
		d, err := h.host.Open("", h.options.workdir)
		if err != nil {
			return protocol.TerminalSession{}, err
		}
		h.primary = newClient(d)
		if err = h.primary.call(ctx, "workspace.greet", nil, nil); err != nil {
			return protocol.TerminalSession{}, err
		}
	}
	next := *h.primary
	if id != "" {
		next.session = id
	}
	if err := next.call(ctx, "workspace.snapshot", nil, nil); err != nil {
		return protocol.TerminalSession{}, err
	}
	return terminalSession(&next), nil
}
func (h *interactiveHost) close() {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.closed = true
	if h.host != nil {
		h.host.Close()
		h.host = nil
	}
}

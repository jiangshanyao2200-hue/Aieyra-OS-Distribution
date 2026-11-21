// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/host/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: RunWorkspace
// Impact: python -B scripts/code-atlas.py show Core/host/workspace.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package host

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"

	agent "github.com/aieyra/aieyra-os/CORE"
	"github.com/aieyra/aieyra-os/CORE/platform"
	"github.com/aieyra/aieyra-os/contracts/storage"
)

// RunWorkspace is the default graphical application. CORE owns all work; the
// Electron child only owns windows. -workspace-core exposes the same runtime
// to an explicitly supervised host over the existing authenticated local API.
func RunWorkspace(s *agent.Settings, resume, workdir string, headless bool) error {
	if workdir == "" {
		// The graphical host chooses a writable product workspace. Supervised
		// headless callers retain their explicit starting-directory contract.
		if !headless {
			var err error
			if p := storage.Bound(s.Path()); p.Unified && os.Getenv("AIEYRA_WORKDIR") == "" {
				workdir = filepath.Join(p.Root, "Workspace")
				err = os.MkdirAll(workdir, 0700)
			} else {
				workdir, err = platform.DefaultOSWorkdir()
			}
			if err != nil {
				return err
			}
		}
		if workdir == "" {
			workdir, _ = os.Getwd()
		}
	}
	if !headless {
		release, reused, err := acquireModuleRuntime(s.Path(), os.Getenv("AIEYRA_OS_OPEN_MODULE"))
		if err != nil {
			return err
		}
		if reused {
			return nil
		}
		defer release()
	}
	host := agent.NewWorkspaceHost(s.Path(), s.EffectiveSystemPrompt(), agent.ResolvePromptDir(s.PromptDir))
	host.SetVersion(Version)
	if !headless && os.Getenv("AIEYRA_OS_OPEN_MODULE") != "" {
		if err := host.SetModuleOnly(); err != nil {
			return err
		}
	}
	// Explicit supervised diagnostics retain their archive contract.
	if !headless {
		if resume != "" {
			return fmt.Errorf("OS 与 CLI 共用唯一 Eyra；普通会话不再恢复，请使用当前主任务和分裂任务。历史文件保留")
		}
		if err := host.SetMode(agent.HostOS); err != nil {
			return err
		}
	}
	defer host.Close()
	descriptor, err := host.Open(resume, workdir)
	if err != nil {
		return err
	}
	descriptor["build"] = BuildProvenance()
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	if headless {
		if err = json.NewEncoder(os.Stdout).Encode(descriptor); err != nil {
			return err
		}
		done := make(chan struct{})
		go func() { _, _ = io.Copy(io.Discard, os.Stdin); close(done) }()
		select {
		case <-ctx.Done():
		case <-done:
		}
		return nil
	}
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	root := os.Getenv("AIEYRA_ROOT")
	if root == "" {
		root = filepath.Dir(exe)
	}
	electron := platform.ElectronPath(root)
	entry := filepath.Join(root, "Client/Desktop", "host", "main.cjs")
	for _, file := range []string{electron, entry} {
		if _, err = os.Stat(file); err != nil {
			return fmt.Errorf("桌面运行文件缺失：%s；请执行 Desktop 的依赖准备与 CORE 构建", file)
		}
	}
	descriptor["root"], descriptor["config"], descriptor["executable"] = root, s.Path(), exe
	descriptor["parent_owned"] = true
	descriptor["parent_pid"] = os.Getpid()
	port, token, closeLease, err := workspaceParentLease()
	if err != nil {
		return err
	}
	defer closeLease()
	descriptor["parent_port"], descriptor["parent_token"] = port, token
	data, _ := json.Marshal(descriptor)
	// Own the process tree before Electron starts. If the Core is terminated
	// before the renderer installs its parent lease, no native child may survive.
	releaseLifetime, err := ownWorkspaceLifetime()
	if err != nil {
		return fmt.Errorf("own desktop process lifetime: %w", err)
	}
	defer releaseLifetime()
	command := exec.CommandContext(ctx, electron, entry)
	command.Dir = root
	for _, value := range os.Environ() {
		name, _, _ := strings.Cut(value, "=")
		switch strings.ToUpper(name) {
		case "ELECTRON_RUN_AS_NODE", "AIEYRA_WORKSPACE_BRIDGE", "AIEYRA_WORKSPACE_OFFSCREEN", "AIEYRA_WORKSPACE_TEST_CDP_PORT", "AIEYRA_MODULE_OFFSCREEN", "AIEYRA_MODULE_TEST_CDP_PORT":
		default:
			command.Env = append(command.Env, value)
		}
	}
	command.Env = append(command.Env, "AIEYRA_ROOT="+root, "AIEYRA_WORKSPACE_BRIDGE="+string(data))
	hideWorkspaceProcess(command)
	command.Stderr = os.Stderr
	if err = command.Start(); err != nil {
		return fmt.Errorf("Electron 主界面启动失败：%w", err)
	}
	return command.Wait()
}

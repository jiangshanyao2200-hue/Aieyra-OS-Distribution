// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/CLI/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: help; options; Run; ConfigureWithTerminal; resolveConfig; RunWithTerminal; terminalSession; recoverHuman; identifier; inputLine; readLines; nextLine; pause
// Impact: python -B scripts/code-atlas.py show Client/CLI/host/cli.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Package cli is a terminal client of the same Workspace runtime as the desktop.
package cli

import (
	"bufio"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"github.com/aieyra/aieyra-os/contracts/storage"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	agent "github.com/aieyra/aieyra-os/CORE"
	apphost "github.com/aieyra/aieyra-os/CORE/host"
	"github.com/aieyra/aieyra-os/CORE/host/linkclient"
	"github.com/aieyra/aieyra-os/contracts/protocol"
)

const help = `Aieyra CLI — the Aieyra OS core in your terminal

Usage: aieyra-cli [chat|run|serve|init|config|profile|link|mods|agents|context|contacts|workflows|version] [options]
  chat                 Current-state screen; /api configures, Ctrl+Q closes
  run -p "task"        Execute a task, including tools, then exit
  run                  Read one task from standard input
  serve                Keep the primary task available until SIGINT/SIGTERM
  init                 Verify a model connection and create a new configuration
  config               Show configuration identity, without credentials
  agents               Manage Agent instances on a running Core (agents --help)
  context              Manage primary Desktop context and memory (context --help)
  contacts             Manage contacts on a running Core (contacts --help)
  workflows            Inspect/control Workbox runs on a running Core (workflows --help)
  profile              Initialize, inspect or migrate private data (profile --help)
  mods                 Manage local Mod packages through the shared Core (mods --help)
  link ...             Pair devices and use Aieyra Link (link help)

Options: --config FILE, --workdir DIR, --prompt-dir DIR,
         --json (JSON output), --plain (line-based chat),
         --request-id ID (idempotent run submission),
         --control (explicitly participate in the configured Control station)
Init: --base-url URL --model NAME
      [--protocol responses|chat_completions|anthropic_messages|google_generate]
      [--key-env AIEYRA_API_KEY] (read from environment; saved with mode 0600)
      Model capacity comes from model metadata; the legacy --context-window is ignored.

Interactive chat: / lists primary/split tasks; type /api to open Eyra API; Alt+1/2/3 opens tool details,
                  Alt+P opens the plan; PgUp/PgDn reads details, Esc closes.
                  Alt+Left/Right pages original receipts; Alt+R refreshes.
Plain chat: / lists tasks, / TASK_ID selects a task; /status, /help, /exit.
OS and CLI share one Eyra identity and global memory. Split tasks use the same core.
Serve waits for events; idle cores do not call a model. Ctrl-C stops this core.
The desktop executable also accepts "cli ...". Control is off by default.
`

type options struct {
	config, resume, workdir, promptDir, prompt, requestID string
	baseURL, model, protocol, keyEnv                      string
	contextWindow                                         int
	json, control, plain                                  bool
}

func Run(ctx context.Context, args []string, in io.Reader, out, diagnostic io.Writer, version string) error {
	return RunWithTerminal(ctx, args, in, out, diagnostic, version, nil)
}

// ConfigureWithTerminal exposes the shared API editor without opening a task.
func ConfigureWithTerminal(ctx context.Context, config, version string, in io.Reader, out io.Writer, terminal protocol.TerminalRunner) error {
	if terminal == nil {
		return fmt.Errorf("API settings require an interactive terminal")
	}
	var err error
	config, err = resolveConfig(config)
	if err != nil {
		return err
	}
	settings := newTerminalSettings(config)
	defer settings.close()
	handled, err := terminal(ctx, protocol.TerminalOptions{
		Input: in, Output: out, Version: version, SettingsOnly: true, Settings: settings.call,
	})
	if err != nil {
		return err
	}
	if !handled {
		return fmt.Errorf("API settings require an interactive terminal; use Aieyra CLI init for automation")
	}
	return nil
}

func resolveConfig(explicit string) (string, error) {
	if explicit != "" {
		return storage.ResolveConfig(explicit)
	}
	return apphost.DefaultConfigPath()
}

// RunWithTerminal keeps presentation optional and assembles it at the entrypoint.
// Pipes, automation and --plain retain the original line-oriented protocol.
func RunWithTerminal(ctx context.Context, args []string, in io.Reader, out, diagnostic io.Writer, version string, terminal protocol.TerminalRunner) error {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	command := "chat"
	if len(args) > 0 && !strings.HasPrefix(args[0], "-") {
		command, args = args[0], args[1:]
	}
	if command == "help" || command == "--help" {
		_, err := io.WriteString(out, help)
		return err
	}
	if command == "profile" {
		return runProfile(ctx, args, out, diagnostic)
	}
	if command == "context" || command == "contacts" || command == "workflows" {
		return runSessionService(ctx, command, args, in, out, diagnostic)
	}
	if command == "agents" {
		return runAgents(ctx, args, in, out, diagnostic)
	}
	if command == "mods" {
		return runMods(ctx, args, in, out, diagnostic)
	}
	if command == "link" {
		return linkclient.Run(ctx, args, in, out, diagnostic)
	}
	if command == "version" || len(args) == 1 && (args[0] == "-version" || args[0] == "--version") {
		_, err := fmt.Fprintln(out, "Aieyra CLI", version)
		return err
	}
	var o options
	fs := flag.NewFlagSet("aieyra-cli", flag.ContinueOnError)
	fs.SetOutput(diagnostic)
	fs.StringVar(&o.config, "config", "", "configuration file")
	fs.StringVar(&o.resume, "resume", "", "retired; use split tasks")
	fs.StringVar(&o.workdir, "workdir", "", "working directory")
	fs.StringVar(&o.promptDir, "prompt-dir", "", "personal prompt directory")
	fs.StringVar(&o.prompt, "p", "", "task to execute")
	fs.StringVar(&o.requestID, "request-id", "", "idempotent task ID")
	fs.BoolVar(&o.json, "json", false, "JSON output")
	fs.BoolVar(&o.plain, "plain", false, "line-based chat without terminal rendering")
	fs.BoolVar(&o.control, "control", false, "join the configured Control station")
	fs.StringVar(&o.baseURL, "base-url", "", "model endpoint")
	fs.StringVar(&o.model, "model", "", "model name")
	fs.StringVar(&o.protocol, "protocol", agent.ProtocolResponses, "model protocol")
	fs.StringVar(&o.keyEnv, "key-env", "AIEYRA_API_KEY", "credential environment variable")
	fs.IntVar(&o.contextWindow, "context-window", 0, "legacy compatibility flag; capacity comes from model metadata")
	fs.Usage = func() { _, _ = io.WriteString(out, help) }
	if err := fs.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return nil
		}
		return err
	}
	if fs.NArg() != 0 {
		return fmt.Errorf("unexpected arguments: use -p for a task")
	}
	switch command {
	case "chat", "run", "sessions", "serve", "init", "config":
	default:
		return fmt.Errorf("unknown command %q; use help", command)
	}
	if command == "chat" && o.prompt != "" {
		command = "run"
	}
	var err error
	o.config, err = resolveConfig(o.config)
	if err != nil {
		return err
	}
	releaseProfile, err := agent.UsePrivateProfile(o.config)
	if err != nil {
		return err
	}
	defer releaseProfile()
	if command == "init" {
		return initialize(ctx, o, out)
	}
	if o.model != "" {
		return fmt.Errorf("--model is supported by init; use /api to select and verify the shared Eyra model")
	}
	if command == "sessions" || o.resume != "" {
		return fmt.Errorf("saved-session commands are retired; chat opens the single Eyra primary task, and / lists split tasks; historical files are preserved")
	}
	if command == "chat" && terminal != nil && !o.plain && !o.json {
		h := &interactiveHost{options: o, version: version}
		defer h.close()
		settings := newTerminalSettings(o.config)
		defer settings.close()
		handled, err := terminal(ctx, protocol.TerminalOptions{
			Input: in, Output: out, Version: version, Control: o.control,
			Open: h.open, Settings: settings.call,
		})
		if handled || err != nil {
			return err
		}
	}
	if _, err := os.Stat(o.config); err != nil {
		return fmt.Errorf("configuration unavailable; run init or specify --config: %w", err)
	}
	s, err := agent.Load(o.config)
	if err != nil {
		return err
	}
	if command == "config" {
		return json.NewEncoder(out).Encode(map[string]any{"path": s.Path(), "model": s.Model, "profile": s.ActiveProfile, "protocol": s.Protocol(), "credential_present": s.APIKey != "", "context_window": s.ModelContextWindow})
	}
	if o.promptDir != "" {
		s.PromptDir = o.promptDir
	}
	if s.PromptDir != "" {
		info, e := os.Stat(s.PromptDir)
		if e != nil || !info.IsDir() {
			return fmt.Errorf("prompt directory does not exist")
		}
	}
	prompts, err := agent.LoadPrompts(s.PromptDir)
	if err != nil {
		return err
	}
	s.SetLoadedPrompt(prompts.Text)
	if o.workdir == "" {
		o.workdir, err = os.Getwd()
	} else {
		o.workdir, err = filepath.Abs(o.workdir)
	}
	if err != nil {
		return err
	}
	if command == "run" && o.prompt == "" {
		data, e := io.ReadAll(io.LimitReader(in, (64<<10)+1))
		if e != nil {
			return e
		}
		if len(data) > 64<<10 {
			return fmt.Errorf("task exceeds 64 KiB")
		}
		o.prompt = string(data)
	}
	if command == "run" && strings.TrimSpace(o.prompt) == "" {
		return fmt.Errorf("task is empty")
	}
	host := agent.NewWorkspaceHost(s.Path(), s.EffectiveSystemPrompt(), agent.ResolvePromptDir(s.PromptDir))
	host.SetVersion(version)
	host.SetTerminal()
	if err := host.SetMode(agent.HostCLI); err != nil {
		return err
	}
	host.SetControl(o.control)
	defer host.Close()
	descriptor, err := host.Open(o.resume, o.workdir)
	if err != nil {
		return err
	}
	client := newClient(descriptor)
	if command == "serve" {
		// The bearer token remains solely in the existing private discovery file.
		if err := json.NewEncoder(out).Encode(map[string]any{"state": "ready", "session_id": client.session, "version": version, "mode": descriptor["mode"], "discovery": descriptor["discovery"]}); err != nil {
			return err
		}
		<-ctx.Done()
		return nil
	}
	_, _ = fmt.Fprintln(diagnostic, "Aieyra CLI ·", version, "·", terminalText(s.Model))
	_, _ = fmt.Fprintln(diagnostic, "Eyra 已就绪")
	if command == "run" {
		return client.run(ctx, o.requestID, o.prompt, out, diagnostic, o.json, nil)
	}
	lines := readLines(ctx, in)
	_, _ = fmt.Fprintln(diagnostic, "/ 查看任务 · / TASK_ID 切换任务 · /api · /status · /help · /exit")
	if err := client.recoverHuman(ctx, lines, out, diagnostic, o.json); err != nil {
		return err
	}
	pending, err := client.startup(ctx, lines, diagnostic)
	if err != nil {
		return err
	}
	for {
		_, _ = fmt.Fprint(diagnostic, "› ")
		var line string
		if pending != nil {
			line, err, pending = pending.text, pending.err, nil
		} else {
			line, err = nextLine(ctx, lines)
		}
		if errors.Is(err, io.EOF) {
			return nil
		}
		if err != nil {
			return err
		}
		fields := strings.Fields(line)
		if len(fields) == 0 {
			continue
		}
		switch fields[0] {
		case "/exit", "/quit":
			return nil
		case "/help":
			_, err = io.WriteString(diagnostic, help)
		case "/status":
			var data json.RawMessage
			if err = client.call(ctx, "matrix.status", nil, &data); err == nil {
				err = json.NewEncoder(out).Encode(data)
			}
		case "/history":
			err = client.history(ctx, out, o.json)
		case "/new", "/resume", "/switch", "/sessions":
			err = fmt.Errorf("普通会话制度已移除；输入 / 查看主任务和分裂任务，历史文件仍保留")
		case "/api":
			_, err = fmt.Fprintln(diagnostic, "请使用交互终端的 /api 配置界面，或通过 init 配置连接。")
		case "/":
			if len(fields) == 1 {
				var rows any
				if err = client.call(ctx, "workspace.tasks", nil, &rows); err == nil {
					err = json.NewEncoder(out).Encode(rows)
				}
			} else if len(fields) == 2 {
				next := *client
				next.session = fields[1]
				if err = next.call(ctx, "workspace.snapshot", nil, nil); err == nil {
					client = &next
					err = client.recoverHuman(ctx, lines, out, diagnostic, o.json)
				}
			} else {
				err = fmt.Errorf("use / or / TASK_ID")
			}
		default:
			if strings.HasPrefix(fields[0], "/") {
				err = fmt.Errorf("unknown command; use /help")
			} else {
				err = client.run(ctx, "", line, out, diagnostic, o.json, lines)
			}
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if err != nil {
			_, _ = fmt.Fprintln(diagnostic, err)
		}
	}
}

func terminalSession(c *client) protocol.TerminalSession {
	return protocol.TerminalSession{ID: c.session, Call: c.call}
}

func (client *client) recoverHuman(ctx context.Context, lines <-chan inputLine, out, diagnostic io.Writer, asJSON bool) error {
	var snapshot struct {
		Roles []struct {
			ID, State  string
			Generation int
			Humans     []agent.HumanRequest `json:"human_requests"`
		}
	}
	if err := client.call(ctx, "workspace.snapshot", nil, &snapshot); err != nil {
		return err
	}
	var pending []agent.HumanRequest
	for _, role := range snapshot.Roles {
		if role.State != "waiting_user" {
			continue
		}
		for _, h := range role.Humans {
			if h.Generation == role.Generation && h.AgentID == role.ID {
				pending = append(pending, h)
			}
		}
	}
	for _, human := range pending {
		if human.State == "waiting_user" {
			var state struct {
				Requests []struct {
					ID         string `json:"request_id"`
					Generation int
					State      string
				}
			}
			if err := client.call(ctx, "matrix.status", nil, &state); err != nil {
				return err
			}
			request := ""
			for _, item := range state.Requests {
				if item.Generation == human.Generation && item.State == "running" {
					request = item.ID
					break
				}
			}
			if request == "" {
				return fmt.Errorf("pending decision is not bound to an active workspace task")
			}
			if err := client.answer(ctx, human, lines, diagnostic); err != nil {
				return err
			}
			if err := client.wait(ctx, request, out, diagnostic, asJSON, lines); err != nil {
				return err
			}
		}
	}
	return nil
}

func identifier() string { var b [16]byte; _, _ = rand.Read(b[:]); return hex.EncodeToString(b[:]) }

type inputLine struct {
	text string
	err  error
}

func readLines(ctx context.Context, in io.Reader) <-chan inputLine {
	lines := make(chan inputLine)
	go func() {
		defer close(lines)
		s := bufio.NewScanner(in)
		s.Buffer(make([]byte, 4096), 64<<10)
		for s.Scan() {
			select {
			case lines <- inputLine{text: s.Text()}:
			case <-ctx.Done():
				return
			}
		}
		if err := s.Err(); err != nil {
			select {
			case lines <- inputLine{err: err}:
			case <-ctx.Done():
			}
		}
	}()
	return lines
}
func nextLine(ctx context.Context, lines <-chan inputLine) (string, error) {
	select {
	case <-ctx.Done():
		return "", ctx.Err()
	case v, ok := <-lines:
		if !ok {
			return "", io.EOF
		}
		return v.text, v.err
	}
}

func pause(ctx context.Context) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-time.After(180 * time.Millisecond):
		return nil
	}
}

// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/cmd/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: main; fail; promptDirLabel
// Impact: python -B scripts/code-atlas.py show Core/cmd/aieyra-config/main.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Command aieyra-config opens desktop or shared terminal settings.
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"strings"
	"syscall"

	agent "github.com/aieyra/aieyra-os/CORE"
	app "github.com/aieyra/aieyra-os/CORE/host"
	"github.com/aieyra/aieyra-os/client/CLI/host"
	"github.com/aieyra/aieyra-os/client/CLI/terminal"
)

func main() {
	fs := flag.NewFlagSet("aieyra-config", flag.ExitOnError)
	var (
		cfgPath    = fs.String("config", "", "配置文件路径（默认 %APPDATA%\\AieyraOS\\config.json）")
		promptDir  = fs.String("prompt-dir", "", "外部提示词目录（仅供命令行查询使用）")
		showVer    = fs.Bool("version", false, "打印版本号")
		tui        = fs.Bool("tui", false, "改用终端版配置界面，不打开图形界面")
		check      = fs.Bool("check", false, "校验当前配置是否合法后退出")
		prompts    = fs.Bool("prompts", false, "只看提示词装载情况后退出")
		showPrompt = fs.Bool("show-prompt", false, "打印本次实际会发送的 system 正文")
		dump       = fs.Bool("dump", false, "打印脱敏配置摘要后退出")
	)
	fs.Int("dump-width", 110, "兼容参数；配置摘要随终端换行")
	fs.Int("dump-height", 32, "兼容参数；配置摘要不截断")
	fs.Usage = func() {
		fmt.Fprintf(os.Stderr, "Aieyra OS 配置中心 %s\n\n", app.Version)
		fmt.Fprintf(os.Stderr, "不加任何选项时打开图形配置中心（Electron）。\n\n")
		fmt.Fprintf(os.Stderr, "用法：aieyra-config.exe [选项]\n\n选项：\n")
		fs.PrintDefaults()
	}

	// 必须先接管控制台再 Parse：-h / 参数写错时 Usage 是从这里打印出去的。
	if len(os.Args) > 1 {
		app.AttachParentConsole()
		app.EnsureConsoleUTF8()
	}
	_ = fs.Parse(os.Args[1:])

	if *showVer {
		fmt.Println("Aieyra OS 配置中心", app.Version)
		return
	}

	// 设置入口先于配置和提示词校验，便于修复不可用的连接。
	cliMode := *check || *prompts || *showPrompt || *dump || *tui

	if !cliMode {
		if *promptDir != "" {
			fail(fmt.Errorf("-prompt-dir 只对 -check / -prompts / -show-prompt / -dump 有效；\n" +
				"图形界面请直接在配置中心里设置提示词目录"))
		}
		// 图形模式下不预先读取配置：配置文件即使损坏，用户也要能打开界面去修。
		if err := app.LaunchConfigGUI(*cfgPath); err != nil {
			fail(err)
		}
		return
	}

	if *tui {
		restore, err := app.PrepareTerminalConsole()
		if err != nil {
			fail(err)
		}
		defer restore()
		ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
		defer stop()
		if err := cli.ConfigureWithTerminal(ctx, *cfgPath, app.Version, os.Stdin, os.Stdout, terminal.Run); err != nil {
			fail(err)
		}
		return
	}

	s, err := app.LoadSettings(*cfgPath)
	if err != nil {
		fail(err)
	}
	if *promptDir != "" {
		s.PromptDir = *promptDir
	}
	if _, err := app.LoadPrompts(s); err != nil {
		fail(err)
	}

	switch {
	case *prompts:
		if err := app.PrintPrompts(s); err != nil {
			fail(err)
		}
	case *showPrompt:
		app.ShowPrompt(s)
	case *dump:
		fmt.Println("配置文件：", s.Path())
		fmt.Println("当前参数：", s.Summary())
		fmt.Println("提示词目录：", promptDirLabel(s))
	case *check:
		fmt.Println("配置文件：", s.Path())
		fmt.Println("当前参数：", s.Summary())
		fmt.Println("提示词目录：", promptDirLabel(s))
		if err := s.Validate(); err != nil {
			fmt.Fprintln(os.Stderr, "✖ 配置不合法：", err)
			os.Exit(1)
		}
		fmt.Println("✔ 配置合法")
		for _, w := range s.Warnings() {
			fmt.Println("  ⚠", w)
		}
	}
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, "错误：", err)
	os.Exit(1)
}

// promptDirLabel 显示显式目录或实际自动查找结果。
func promptDirLabel(s *agent.Settings) string {
	if configured := strings.TrimSpace(s.PromptDir); configured != "" {
		return configured
	}
	resolved := agent.ResolvePromptDir("")
	if info, err := os.Stat(resolved); err == nil && info.IsDir() {
		return fmt.Sprintf("（未配置，自动使用 %s）", resolved)
	}
	return fmt.Sprintf("（未配置，自动查找也没找到；把提示词 .txt 放到 %s）", resolved)
}

// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/cmd/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: main; fail
// Impact: python -B scripts/code-atlas.py show Core/cmd/aieyra-os/main.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Command aieyra-os 是Go 核心与 Electron 工作屏的统一入口。
//
// 用法：
//
//	aieyra-os.exe                       # 启动对话界面
//	aieyra-os.exe -p "你好"             # 一次性提问，流式打印到 stdout
//	aieyra-os.exe -config D:\my.json    # 指定配置文件
//	aieyra-os.exe -prompt-dir D:\Prompt # 指定外部提示词目录
//	aieyra-os.exe -list-models          # 列出官方模型
//	aieyra-os.exe -list-prompts         # 查看外部提示词装载情况
//
// 默认启动图形工作屏；-direct-tui 仅作兼容诊断，-workspace-core 用于受信任宿主。
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"

	app "github.com/aieyra/aieyra-os/CORE/host"
	"github.com/aieyra/aieyra-os/CORE/host/linkclient"
	"github.com/aieyra/aieyra-os/client/CLI/host"
	"github.com/aieyra/aieyra-os/client/CLI/terminal"
)

func main() {
	if handled, err := app.RunDesktopWorker(os.Args[1:], os.Stdin, os.Stdout); handled {
		if err != nil {
			os.Exit(1)
		}
		return
	}
	if handled, err := app.RunDesktopMaintenance(os.Args[1:]); handled {
		if err != nil {
			fail(err)
		}
		return
	}
	app.AttachParentConsole()
	// 先切控制台到 UTF-8 再打印任何东西：conhost 默认 GBK，否则中文全是乱码。
	// 没有控制台（管道/WT）时调用无操作或静默失败，不影响后续流程。
	app.EnsureConsoleUTF8()
	args := os.Args[1:]
	explicitCLI := len(args) > 0 && args[0] == "cli"
	legacy := false
	for _, arg := range args {
		name := strings.TrimLeft(strings.SplitN(arg, "=", 2)[0], "-")
		switch name {
		case "workspace-core", "apply-update", "recover-update", "update-probe", "direct-tui":
			legacy = true
		}
	}
	if explicitCLI || (runtime.GOOS == "linux" || runtime.GOOS == "android") && !legacy {
		if explicitCLI {
			args = args[1:]
		}
		ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
		defer stop()
		if err := cli.RunWithTerminal(ctx, args, os.Stdin, os.Stdout, os.Stderr, app.Version, terminal.Run); err != nil {
			if code, child := linkclient.ExitCode(err); child {
				os.Exit(code)
			}
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		return
	}
	fs := flag.NewFlagSet("aieyra-os", flag.ExitOnError)
	var (
		cfgPath    = fs.String("config", "", "配置文件路径（默认 %APPDATA%\\AieyraOS\\config.json）")
		resume     = fs.String("resume", "", "仅受监督的无界面诊断宿主支持；OS/CLI 不恢复普通会话")
		directTUI  = fs.Bool("direct-tui", false, "在当前终端直接启动对话")
		headless   = fs.Bool("workspace-core", false, "运行无界面核心，由受信任宿主管理")
		workdir    = fs.String("workdir", "", "工作区目录（默认安装旁可写目录，否则使用用户目录；可用 AIEYRA_WORKDIR 指定）")
		promptDir  = fs.String("prompt-dir", "", "外部提示词目录（默认自动查找）")
		prompt     = fs.String("p", "", "一次性提问，流式输出后退出")
		model      = fs.String("model", "", "一次性问答或显示诊断的模型覆盖；交互模式请使用 /api")
		showVer    = fs.Bool("version", false, "打印版本号")
		moduleGUI  = fs.String("module", "", "独立打开模块：home/browser/contacts/settings/link")
		controlGUI = fs.Bool("control", false, "打开内置指挥中心")
		listModels = fs.Bool("list-models", false, "列出官方支持的模型")
		listPrompt = fs.Bool("list-prompts", false, "查看外部提示词装载情况")
		showPrompt = fs.Bool("show-prompt", false, "打印本次实际会发送的 system 正文")
		dumpChat   = fs.Bool("dump-chat", false, "把对话页渲染成纯文本后退出（排查排版）")
		noReason   = fs.Bool("no-reasoning", false, "一次性问答时不把思考链打印到 stderr")
		dumpWidth  = fs.Int("dump-width", 110, "配合 -dump-* 使用的终端宽度")
		dumpHeight = fs.Int("dump-height", 32, "配合 -dump-* 使用的终端高度")
	)
	fs.Usage = func() {
		fmt.Fprintf(os.Stderr, "Aieyra OS %s —— Go 核心 + Electron 工作屏\n\n", app.Version)
		fmt.Fprintf(os.Stderr, "用法：aieyra-os.exe [选项]\n\n选项：\n")
		fs.PrintDefaults()
		fmt.Fprintf(os.Stderr, "\n提示词从外部目录读取，程序内不内嵌任何基准提示词。\n")
	}
	_ = fs.Parse(os.Args[1:])

	if *showVer {
		fmt.Println("Aieyra OS", app.Version)
		return
	}
	if *listModels {
		app.PrintModels()
		return
	}
	_ = os.Unsetenv("AIEYRA_OS_OPEN_MODULE")
	if *moduleGUI != "" {
		if err := os.Setenv("AIEYRA_OS_OPEN_MODULE", *moduleGUI); err != nil {
			fail(err)
		}
	}
	if *controlGUI {
		if err := os.Setenv("AIEYRA_OS_OPEN_CONTROL", "1"); err != nil {
			fail(err)
		}
	}

	root := os.Getenv("AIEYRA_ROOT")
	if root == "" {
		executable, _ := os.Executable()
		root = filepath.Dir(executable)
	}
	if err := app.ValidateDesktopModule(root, *moduleGUI); err != nil {
		fail(err)
	}
	if handled, recoveryErr := app.RecoverManagedUpdate(root); recoveryErr != nil {
		fail(recoveryErr)
	} else if handled {
		return
	}
	if *directTUI && !*headless && *prompt == "" && !*listPrompt && !*showPrompt && !*dumpChat {
		if err := runTUI(*cfgPath, *resume, *workdir, *promptDir, *model); err != nil {
			fail(err)
		}
		return
	}
	if *model != "" && *prompt == "" && !*dumpChat {
		fail(fmt.Errorf("-model 仅用于一次性问答或显示诊断；请在共享 Eyra API 中选择并验证交互模型"))
	}
	s, releaseProfile, err := app.OpenDesktopSettings(*cfgPath, *promptDir)
	if err != nil {
		fail(err)
	}
	defer releaseProfile()

	if *listPrompt {
		if err := app.PrintPrompts(s); err != nil {
			fail(err)
		}
		return
	}
	if *showPrompt {
		app.ShowPrompt(s)
		return
	}
	if err := app.ApplyModelOverride(s, *model); err != nil {
		fail(err)
	}
	if *dumpChat {
		renderChatDump(s, *dumpWidth, *dumpHeight)
		return
	}

	if *prompt != "" {
		if err := app.RunOnce(s, *prompt, !*noReason); err != nil {
			fail(err)
		}
		return
	}

	if !*directTUI {
		if err := app.RunWorkspace(s, *resume, *workdir, *headless); err != nil {
			fail(err)
		}
		return
	}
	if err := runTUI(s.Path(), *resume, *workdir, s.PromptDir, *model); err != nil {
		fail(err)
	}
}

func fail(err error) {
	app.ReportStartupError(err)
	os.Exit(1)
}

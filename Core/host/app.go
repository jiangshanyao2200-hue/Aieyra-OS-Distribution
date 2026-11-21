// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/host/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: Version; BuildID; SourceDigest; BuiltAt; BuildProvenance; LoadSettings; DefaultConfigPath; LoadChatSettings; ConfigCandidates; ApplyModelOverride; PrintModels; LoadPrompts; ShowPrompt; PrintPrompts; RunOnce; loadResolvedSettings
// Impact: python -B scripts/code-atlas.py show Core/host/app.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Package host owns application startup and desktop hosting, not UI rendering.
package host

import (
	"context"
	"fmt"
	"github.com/aieyra/aieyra-os/CORE/userdata"
	"github.com/aieyra/aieyra-os/contracts/storage"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"

	agent "github.com/aieyra/aieyra-os/CORE"
	"github.com/aieyra/aieyra-os/CORE/platform"
)

// Version 由构建脚本通过 -ldflags 注入。
var Version = "0.2.85"

// Build identity is frozen by the linker. Empty values identify an unstamped
// build; reading current files on disk must never fill these fields.
var BuildID string
var SourceDigest string
var BuiltAt string

func BuildProvenance() map[string]string {
	return map[string]string{"build_id": BuildID, "source_digest": SourceDigest, "built_at": BuiltAt}
}

// LoadSettings 依次尝试候选路径，保证既有配置能被自动发现。
//
// 优先级见 ConfigCandidates 的说明。
func LoadSettings(explicit string) (*agent.Settings, error) {
	if explicit != "" {
		// 显式路径打错字必须报错，不能静默回退到默认配置：
		// 否则用户以为修好了真实配置，实际在错路径新建了文件（F3）。
		abs := agent.ResolvePath(explicit)
		if _, err := os.Stat(abs); err != nil {
			if os.IsNotExist(err) {
				return nil, fmt.Errorf("指定的配置文件不存在：%s\n请检查 --config 路径是否写错", abs)
			}
			return nil, fmt.Errorf("读取配置文件失败 %s: %w", abs, err)
		}
		return loadResolvedSettings(abs)
	}
	file, err := DefaultConfigPath()
	if err != nil {
		return nil, err
	}
	return loadResolvedSettings(file)
}

// DefaultConfigPath is shared by graphical and explicit CLI entrypoints.
func DefaultConfigPath() (string, error) {
	if runtime.GOOS == "windows" {
		profile, err := userdata.PreparePortable(platform.AppRoot())
		return profile.Config, err
	}
	for _, c := range ConfigCandidates() {
		if _, err := os.Stat(c); err == nil {
			return storage.ResolveConfig(c)
		}
	}
	// 都不存在：用用户配置目录的默认目标位置（首次运行会在那里创建）。
	return storage.ResolveConfig(agent.UserConfigPath())
}

// 集成宿主传入的是已解析的保存位置，首次设置前文件允许不存在。
// 用户显式 --config 仍走严格校验，避免路径输错时悄悄创建另一份配置。
func LoadChatSettings(explicit string) (*agent.Settings, error) {
	if explicit == "" && os.Getenv("AIEYRA_TERMINAL") == "1" {
		if inherited := os.Getenv("AIEYRA_CONFIG_FILE"); inherited != "" {
			return loadResolvedSettings(agent.ResolvePath(inherited))
		}
	}
	return LoadSettings(explicit)
}

// ConfigCandidates 返回配置文件的候选路径，按优先级排列（先命中者胜出）：
//
//  1. 安装根 Data/Config/config.json（统一资料）
//  2. 安装根 Config/config.json（旧布局）
//  3. 兼容旧 exe 相邻 config.json
//  4. 用户目录 AieyraOS/Config/config.json
//  5. 当前工作目录 config.json（兼容）
//
// Windows 默认启动由 PreparePortable 完整检查，不跨安装回退到全局资料。
// 结果依赖运行环境（exe 位置、用户配置目录、工作目录），因此抽成独立函数，
// 使「顺序」这件事可被测试直接断言。
func ConfigCandidates() []string {
	var out []string
	out = append(out, filepath.Join(platform.AppRoot(), "Data", "Config", "config.json"))
	out = append(out, filepath.Join(platform.AppRoot(), "Config", "config.json"))
	if exe, err := os.Executable(); err == nil {
		out = append(out, filepath.Join(filepath.Dir(exe), "config.json"))
	}
	out = append(out, agent.UserConfigPath())
	if cwd, err := os.Getwd(); err == nil {
		out = append(out, filepath.Join(cwd, "config.json"))
	}
	return out
}

// ApplyModelOverride 处理命令行传入的模型覆盖。
func ApplyModelOverride(s *agent.Settings, model string) error {
	if model == "" {
		return nil
	}
	if _, ok := agent.LookupModel(model); !ok {
		if replacement, legacy := agent.LegacyModelAliases[model]; legacy {
			return fmt.Errorf("%s 是已下线的旧模型名，请改用 %s", model, replacement)
		}
		return fmt.Errorf("未知模型 %q，可选：%s", model, strings.Join(agent.ModelIDs(), " / "))
	}
	s.Model = model
	return nil
}

// PrintModels 打印官方在售模型。
func PrintModels() {
	fmt.Println("DeepSeek 官方模型：")
	for _, m := range agent.Models {
		vision := "不支持图像理解"
		if m.Vision {
			vision = "支持图像理解"
		}
		fmt.Printf("  %-18s %-22s %s · 并发上限 %d\n", m.ID, m.Version, vision, m.Concurrency)
	}
	fmt.Println()
	fmt.Println("注意：旧的 deepseek-chat / deepseek-reasoner 已不在官方在售清单中。")
	fmt.Println("     实测仍可调用（由在售模型接管），但建议直接使用上面的新名字。")
}

// LoadPrompts 从外部目录装载提示词并记录到配置。
//
// 程序内不内嵌任何基准提示词：找不到文件就是没有提示词，
// 此时请求不携带 system 消息，而不是偷偷用一份写死的人格顶上。
// 例外：命令行显式 --prompt-dir 指向不存在的目录时直接报错——
// 打错路径却“本次不带 system”是静默失败，必须响亮（M3）。
func LoadPrompts(s *agent.Settings) (agent.PromptStatus, error) {
	if s.PromptDir != "" {
		dir := agent.ResolvePromptDir(s.PromptDir)
		if st, err := os.Stat(dir); err != nil || !st.IsDir() {
			return agent.PromptStatus{Dir: dir}, fmt.Errorf("指定的提示词目录不存在：%s", dir)
		}
	}
	st, err := agent.LoadPrompts(s.PromptDir)
	if err != nil {
		return st, err
	}
	s.SetLoadedPrompt(st.Text)
	return st, nil
}

// ShowPrompt 打印本次会话实际会发送的 system 正文。
//
// 存在的意义：外部提示词可能来自手填、外部文件、或两者都没有，
// 这个开关让人不必猜——直接把真正要发出去的东西打出来。
func ShowPrompt(s *agent.Settings) {
	text := s.EffectiveSystemPrompt()
	fmt.Println("提示词目录：", agent.ResolvePromptDir(s.PromptDir))
	switch {
	case strings.TrimSpace(s.SystemPrompt) != "":
		fmt.Println("来源：配置中手填的「系统提示词」（已压制外部文件）")
	case strings.TrimSpace(s.LoadedPrompt()) != "":
		fmt.Println("来源：外部文件装载")
	default:
		fmt.Println("来源：无（本次对话不会携带 system 消息）")
	}
	fmt.Println("长度：", len([]rune(text)), "字")
	fmt.Println(strings.Repeat("─", 60))
	if strings.TrimSpace(text) == "" {
		fmt.Println("(空)")
	} else {
		fmt.Println(text)
	}
	fmt.Println(strings.Repeat("─", 60))
}

// PrintPrompts 打印提示词装载情况。返回 error 而不是直接 os.Exit(1)：
// 库函数直接退出进程会让测试与复用方无法捕获（M8）。
func PrintPrompts(s *agent.Settings) error {
	st, err := LoadPrompts(s)
	if err != nil {
		fmt.Fprintln(os.Stderr, "读取提示词失败：", err)
		return err
	}

	fmt.Println("提示词目录：", st.Dir)
	fmt.Println()
	fmt.Println("提示词层（按此顺序拼装，空层整层跳过）：")
	for _, l := range st.Layers {
		state := "缺失"
		if !l.Empty() {
			state = fmt.Sprintf("已装载 %d 字", len([]rune(l.Body)))
			if l.Path != "" {
				state += "  " + l.Path
			}
		}
		fmt.Printf("  %-4s %-10s %s\n", l.Title, l.File, state)
	}
	fmt.Println()
	if strings.TrimSpace(st.Text) == "" {
		fmt.Println("结果：没有任何提示词会被发送，本次对话不携带 system 消息。")
	} else {
		fmt.Printf("结果：拼装后 %d 字，将作为 system 消息发送。\n", len([]rune(st.Text)))
	}
	fmt.Println()
	fmt.Println("程序内不内嵌任何基准提示词，全部从此目录读取。")
	fmt.Println("搜索顺序：--prompt-dir > 可执行文件同级 Prompt/ > 当前目录 Prompt/ > 用户配置目录")
	return nil
}

// RunOnce 执行一次非交互式问答，便于脚本化与连通性验证。
func RunOnce(s *agent.Settings, prompt string, reasoningToStderr bool) error {
	if err := s.Validate(); err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	var msgs []agent.Message
	if sp := s.EffectiveSystemPrompt(); strings.TrimSpace(sp) != "" {
		msgs = append(msgs, agent.Message{Role: agent.RoleSystem, Content: sp})
	}
	msgs = append(msgs, agent.Message{Role: agent.RoleUser, Content: prompt})

	client := agent.New(s)
	start := time.Now()

	if !s.StreamEnabled() {
		ctx2, cancel := context.WithTimeout(ctx, time.Duration(s.RequestTimeout)*time.Second)
		defer cancel()
		msg, usage, err := client.Complete(ctx2, s, msgs)
		if err != nil {
			return err
		}
		if reasoningToStderr && s.ShowReasoning && msg.ReasoningContent != "" {
			fmt.Fprintln(os.Stderr, "── 思考 ──")
			fmt.Fprintln(os.Stderr, msg.ReasoningContent)
			fmt.Fprintln(os.Stderr, "──────────")
		}
		fmt.Println(msg.Content)
		if usage != nil {
			fmt.Fprintln(os.Stderr, "["+usage.String()+"]")
		}
		return nil
	}

	reasoningShown := false
	closeReasoning := func() {
		if reasoningShown {
			fmt.Fprintln(os.Stderr, "\n──────────")
			reasoningShown = false
		}
	}
	for ev := range client.Stream(ctx, s, msgs) {
		switch ev.Kind {
		case agent.EventReasoning:
			if reasoningToStderr && s.ShowReasoning {
				if !reasoningShown {
					fmt.Fprintln(os.Stderr, "── 思考 ──")
					reasoningShown = true
				}
				fmt.Fprint(os.Stderr, ev.Text)
			}
		case agent.EventDelta:
			if ev.Text != "" {
				closeReasoning()
				fmt.Print(ev.Text)
			}
		case agent.EventUsage:
			if ev.Usage != nil {
				fmt.Fprintln(os.Stderr, "\n["+ev.Usage.String()+"]")
			}
		case agent.EventFinish:
			// finish_reason=tool_calls 时正文为空是正常的：如实告知，
			// 而不是让用户对着空白以为出 bug（S3）。
			if ev.Finish == "tool_calls" {
				fmt.Fprintln(os.Stderr, "\n[模型请求工具调用，本客户端未执行]")
			}
		case agent.EventWarn:
			// 警告不中断、不影响退出码：内容已打印，脚本不应误判失败（S1）。
			closeReasoning()
			if ev.Err != nil {
				fmt.Fprintln(os.Stderr, "\n[警告] "+ev.Err.Error())
			}
		case agent.EventError:
			closeReasoning()
			return ev.Err
		case agent.EventDone:
			fmt.Fprintln(os.Stderr, fmt.Sprintf("\n[耗时 %.2fs]", time.Since(start).Seconds()))
			return nil
		}
	}
	return nil
}

func loadResolvedSettings(file string) (*agent.Settings, error) {
	resolved, err := storage.ResolveConfig(file)
	if err != nil {
		return nil, err
	}
	return agent.Load(resolved)
}

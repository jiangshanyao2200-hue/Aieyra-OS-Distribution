// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/host/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestConfigCandidatesOrder; TestUserConfigPathIsAbsolute; TestLoadSettingsExplicitWins; TestLoadSettingsFallsBackToUserConfigTarget; TestApplyModelOverride; TestLoadPromptsFromDir; TestVersionIsSet
// Impact: python -B scripts/code-atlas.py show Core/host/app_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package host

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	agent "github.com/aieyra/aieyra-os/CORE"
)

// TestConfigCandidatesOrder 锁住配置查找顺序，防止注释与实现再次背离。
func TestConfigCandidatesOrder(t *testing.T) {
	cands := ConfigCandidates()
	if len(cands) != 5 {
		t.Fatalf("应有 5 个候选路径，实际 %d：%v", len(cands), cands)
	}

	exe, err := os.Executable()
	if err != nil {
		t.Skip("无法获取可执行文件路径")
	}
	portable := filepath.Join(filepath.Dir(exe), "config.json")
	userCfg := agent.UserConfigPath()

	canonical := filepath.Join(filepath.Dir(exe), "Config", "config.json")
	if cands[0] != filepath.Join(filepath.Dir(exe), "Data", "Config", "config.json") || cands[1] != canonical || cands[2] != portable {
		t.Errorf("便携 Config 必须在旧扁平配置之前：%v", cands)
	}
	if cands[3] != userCfg {
		t.Errorf("第 4 位应是用户配置目录 %q，实际 %q", userCfg, cands[3])
	}
	if !strings.HasSuffix(cands[4], string(os.PathSeparator)+"config.json") {
		t.Errorf("第 5 位应是当前工作目录的 config.json，实际 %q", cands[4])
	}

	// 便携配置必须压过用户配置 —— 这是「拷到 U 盘带走」能成立的前提。
	portableIdx, userIdx := -1, -1
	for i, c := range cands {
		if c == portable {
			portableIdx = i
		}
		if c == userCfg {
			userIdx = i
		}
	}
	if portableIdx > userIdx {
		t.Errorf("便携配置（%d）必须排在用户配置（%d）之前", portableIdx, userIdx)
	}
}

// TestUserConfigPathIsAbsolute 用户配置路径应可定位。
func TestUserConfigPathIsAbsolute(t *testing.T) {
	p := agent.UserConfigPath()
	if !filepath.IsAbs(p) {
		t.Errorf("应是绝对路径，实际 %q", p)
	}
	if filepath.Base(p) != "config.json" {
		t.Errorf("文件名应为 config.json，实际 %q", filepath.Base(p))
	}
}

// TestLoadSettingsExplicitWins 显式 --config 必须压过一切自动查找。
func TestLoadSettingsExplicitWins(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "explicit.json")
	if err := os.WriteFile(path, []byte(`{"api_key":"sk-explicit","model":"deepseek-v4-pro"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	s, err := LoadSettings(path)
	if err != nil {
		t.Fatalf("加载失败：%v", err)
	}
	if s.APIKey != "sk-explicit" {
		t.Errorf("应读显式配置，实际 key=%q", s.APIKey)
	}
	if s.Path() != path {
		t.Errorf("路径应为 %q，实际 %q", path, s.Path())
	}
}

// TestLoadSettingsFallsBackToUserConfigTarget 全部候选都不存在时，
// 应落到用户配置目录的目标位置，而不是别的什么地方。
func TestLoadSettingsFallsBackToUserConfigTarget(t *testing.T) {
	// 用一个必然不存在的显式路径之外的场景不可行（会读真实环境），
	// 因此这里只断言「候选都不存在时的目标」与 UserConfigPath 一致。
	target := agent.UserConfigPath()
	loaded, err := agent.Load(target)
	if err != nil {
		t.Fatalf("加载默认目标失败：%v", err)
	}
	if loaded.Path() != target {
		t.Errorf("默认目标应为 %q，实际 %q", target, loaded.Path())
	}
}

// TestApplyModelOverride 覆盖模型名的三条路径：合法、非法、旧名。
func TestApplyModelOverride(t *testing.T) {
	t.Run("留空不改变", func(t *testing.T) {
		s := agent.Defaults()
		if err := ApplyModelOverride(s, ""); err != nil {
			t.Fatalf("空值不应报错：%v", err)
		}
		if s.Model != agent.ModelFlash {
			t.Errorf("模型不应被改动，实际 %s", s.Model)
		}
	})

	t.Run("合法值生效", func(t *testing.T) {
		s := agent.Defaults()
		if err := ApplyModelOverride(s, agent.ModelV4Pro); err != nil {
			t.Fatalf("合法模型不应报错：%v", err)
		}
		if s.Model != agent.ModelV4Pro {
			t.Errorf("模型应被覆盖，实际 %s", s.Model)
		}
	})

	t.Run("非法值报错并列出可选", func(t *testing.T) {
		s := agent.Defaults()
		err := ApplyModelOverride(s, "gpt-4")
		if err == nil {
			t.Fatal("非法模型应报错")
		}
		if !strings.Contains(err.Error(), agent.ModelFlash) {
			t.Errorf("报错应列出可选模型，实际：%v", err)
		}
		if s.Model != agent.ModelFlash {
			t.Errorf("报错时不应改动配置，实际 %s", s.Model)
		}
	})

	t.Run("旧名给出替代建议", func(t *testing.T) {
		s := agent.Defaults()
		err := ApplyModelOverride(s, "deepseek-chat")
		if err == nil {
			t.Fatal("旧模型名应报错")
		}
		if !strings.Contains(err.Error(), agent.ModelFlash) {
			t.Errorf("应建议改用 %s，实际：%v", agent.ModelFlash, err)
		}
	})
}

// TestLoadPromptsFromDir 提示词装载应落到 Settings 上。
func TestLoadPromptsFromDir(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, agent.PromptFileSelf), []byte("我是测试。"), 0o600); err != nil {
		t.Fatal(err)
	}
	s := agent.Defaults()
	s.PromptDir = dir

	st, err := LoadPrompts(s)
	if err != nil {
		t.Fatalf("装载失败：%v", err)
	}
	if !strings.Contains(st.Text, "我是测试") {
		t.Errorf("装载结果应含文件内容，实际 %q", st.Text)
	}
	if s.LoadedPrompt() != st.Text {
		t.Error("装载结果应记录到 Settings")
	}
	if !s.HasPrompt() {
		t.Error("装载后应认为有可用提示词")
	}
}

// TestVersionIsSet 版本变量应始终可用于 -version。
func TestVersionIsSet(t *testing.T) {
	if strings.TrimSpace(Version) == "" {
		t.Error("Version 不应为空")
	}
}

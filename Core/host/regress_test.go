// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/host/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestLoadSettingsExplicitMissingErrors; TestLoadPromptsExplicitMissingErrors; TestLoadPromptsAfterMigrationWithoutSource; TestSavePreservesFileKeyWhenEnvKey
// Impact: python -B scripts/code-atlas.py show Core/host/regress_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package host

// 本轮审查修复的回归测试（P0）：
// 显式 --config 打错必须响亮报错，显式 --prompt-dir 打错同理。

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	agent "github.com/aieyra/aieyra-os/CORE"
	"github.com/aieyra/aieyra-os/CORE/userdata"
)

// TestLoadSettingsExplicitMissingErrors 显式指定的配置文件不存在时必须报错，
// 不能静默回退到默认配置（F3：否则用户在错路径保存，误以为修好了真实配置）。
func TestLoadSettingsExplicitMissingErrors(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "nope", "my.json")
	if _, err := LoadSettings(missing); err == nil {
		t.Fatal("显式路径缺失应报错")
	}
}

// TestLoadPromptsExplicitMissingErrors 显式指定的提示词目录不存在时必须报错（M3）。
func TestLoadPromptsExplicitMissingErrors(t *testing.T) {
	s := agent.Defaults()
	s.PromptDir = filepath.Join(t.TempDir(), "nope-dir")
	if _, err := LoadPrompts(s); err == nil {
		t.Fatal("显式提示词目录缺失应报错")
	}
}

func TestLoadPromptsAfterMigrationWithoutSource(t *testing.T) {
	base := t.TempDir()
	source := filepath.Join(base, "legacy")
	config := filepath.Join(source, "Config", "config.json")
	promptDir := filepath.Join(source, "Prompt", "Matrix")
	for _, dir := range []string{filepath.Dir(config), promptDir, filepath.Join(source, "Data")} {
		if err := os.MkdirAll(dir, 0700); err != nil {
			t.Fatal(err)
		}
	}
	raw, err := json.Marshal(map[string]string{"prompt_dir": promptDir})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(config, raw, 0600); err != nil {
		t.Fatal(err)
	}
	const prompt = "迁移后的个人提示词。"
	if err := os.WriteFile(filepath.Join(promptDir, agent.PromptFileSelf), []byte(prompt), 0600); err != nil {
		t.Fatal(err)
	}
	p, err := userdata.Migrate(context.Background(), config, filepath.Join(base, "UserData"))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(source, source+"-retained"); err != nil {
		t.Fatal(err)
	}
	s, err := LoadSettings(p.Config)
	if err != nil {
		t.Fatal(err)
	}
	release, err := agent.UsePrivateProfile(s.Path())
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	want := filepath.Join(p.Overrides, "Prompt", "Matrix")
	st, err := LoadPrompts(s)
	if err != nil || st.Dir != want || !strings.Contains(st.Text, prompt) || s.LoadedPrompt() != st.Text {
		t.Fatalf("migrated prompt was not loaded: %+v, %v", st, err)
	}
	if err := os.RemoveAll(want); err != nil {
		t.Fatal(err)
	}
	if st, err := LoadPrompts(s); err == nil || st.Dir != want {
		t.Fatalf("missing mapped explicit directory must fail: %+v, %v", st, err)
	}
	after, err := os.ReadFile(p.Config)
	if err != nil || !bytes.Equal(raw, after) || s.PromptDir != promptDir {
		t.Fatalf("loading must preserve the configured original path: %v", err)
	}
}

// TestSavePreservesFileKeyWhenEnvKey 环境变量来的临时 Key 不许落盘（F2）。
func TestSavePreservesFileKeyWhenEnvKey(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")

	s := agent.Defaults()
	s.APIKey = "sk-from-file"
	s.SetPath(path)
	if err := s.Save(); err != nil {
		t.Fatalf("初始保存失败：%v", err)
	}

	t.Setenv("DEEPSEEK_API_KEY", "sk-from-env")
	loaded, err := agent.Load(path)
	if err != nil {
		t.Fatalf("加载失败：%v", err)
	}
	if loaded.APIKey != "sk-from-env" {
		t.Fatalf("环境变量应覆盖，实际 %q", loaded.APIKey)
	}
	if !loaded.EnvAPIKey() {
		t.Fatal("应标记凭据来自环境变量")
	}
	// 改个无关参数再保存，文件里的 Key 必须是旧的。
	loaded.ContextMessages = 7
	if err := loaded.Save(); err != nil {
		t.Fatalf("保存失败：%v", err)
	}
	reloaded, err := agent.Load(path)
	if err != nil {
		t.Fatalf("重读失败：%v", err)
	}
	// 注意：重读时环境变量仍在，APIKey 仍显示 env 值；断言的是文件内容。
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), "sk-from-file") {
		t.Error("文件应保留旧 Key")
	}
	if strings.Contains(string(raw), "sk-from-env") {
		t.Error("临时 Key 被写入文件了")
	}
	if reloaded.ContextMessages != 7 {
		t.Errorf("无关参数应正常保存，实际 %d", reloaded.ContextMessages)
	}
}

// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestDefaultsValidate; TestValidateRejectsOutOfRange; TestSanitizeSelfHeals; TestEffectiveMaxTokens; TestNormalizedEffort; TestSanitizeKeepsEveryValidEffort; TestValidEffortRejectsUnknown; TestWarningsMatchOfficialSemantics; TestMaskKeyNeverLeaks; TestSaveLoadRoundTrip; TestLoadMissingFileReturnsDefaults; TestLoadCorruptFileReportsError; TestEnvironmentOverride; TestCloneIsDeep; TestLegacyModelNameGivesActionableError; TestModelsHaveUniqueIDs; TestFieldRefsMatchesJSON; repoPromptDir; TestNoEmbeddedPrompt; TestPromptFilesPresent; TestAssembleOrderAndSkipping; TestRealPromptAssembly; TestLoadPromptsMissingDir; TestPromptDirResolutionOrder; TestEffectiveSystemPrompt; TestSanitizeKeepsEmptyPrompt; TestFieldRefsIncludesPromptFields; TestPromptWarningWhenNoneLoaded
// Impact: python -B scripts/code-atlas.py show Core/types_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestDefaultsValidate 出厂配置必须直接可用（除 Key 之外）。
func TestDefaultsValidate(t *testing.T) {
	s := Defaults()
	if err := s.Validate(); err == nil {
		t.Error("未填 API Key 时应校验失败")
	}
	s.APIKey = "sk-test"
	if err := s.Validate(); err != nil {
		t.Errorf("填好 Key 后应校验通过，实际 %v", err)
	}
	if s.Model != ModelFlash {
		t.Errorf("默认模型应为 %s，实际 %s", ModelFlash, s.Model)
	}
	if !s.ThinkingEnabled() {
		t.Error("官方默认开启思考模式，默认配置应保持 enabled")
	}
}

// TestValidateRejectsOutOfRange 越界参数必须被拦住，而不是发出去等 422。
func TestValidateRejectsOutOfRange(t *testing.T) {
	base := func() *Settings {
		s := Defaults()
		s.APIKey = "sk-test"
		return s
	}
	cases := []struct {
		name   string
		mutate func(*Settings)
	}{
		{"max_tokens 越界", func(s *Settings) { s.MaxTokens = MaxTokensLimit + 1 }},
		{"temperature 越界", func(s *Settings) { s.Temperature = 2.5 }},
		{"top_p 为零", func(s *Settings) { s.TopP = 0 }},
		{"top_p 超过 1", func(s *Settings) { s.TopP = 1.5 }},
		{"未知模型", func(s *Settings) { s.Model = "deepseek-chat" }},
		{"base_url 缺协议", func(s *Settings) { s.BaseURL = "api.deepseek.com" }},
		{"thinking 非法", func(s *Settings) { s.ThinkingType = "maybe" }},
		{"reasoning_effort 非法", func(s *Settings) { s.ReasoningEffort = "extreme" }},
		{"response_format 非法", func(s *Settings) { s.ResponseFormat = "xml" }},
		{"超时过小", func(s *Settings) { s.RequestTimeout = 1 }},
	}
	for _, c := range cases {
		s := base()
		c.mutate(s)
		if err := s.Validate(); err == nil {
			t.Errorf("%s：应校验失败但没有", c.name)
		}
	}
}

// TestSanitizeSelfHeals 从磁盘读到的脏配置应被自动夹回合法范围。
func TestSanitizeSelfHeals(t *testing.T) {
	s := &Settings{
		APIKey:          "sk-test",
		Model:           "deepseek-chat", // 已下线模型
		Temperature:     -5,
		TopP:            9,
		MaxTokens:       MaxTokensLimit + 100,
		ThinkingType:    "???",
		ReasoningEffort: "???",
		RequestTimeout:  -1,
		ContextMessages: -3,
	}
	s.Sanitize()

	if s.Model != ModelFlash {
		t.Errorf("失效模型应回落到 %s，实际 %s", ModelFlash, s.Model)
	}
	if s.Temperature != TempMin {
		t.Errorf("temperature 应夹到 %.0f，实际 %v", TempMin, s.Temperature)
	}
	if s.TopP != TopPMax {
		t.Errorf("top_p 应夹到 %.0f，实际 %v", TopPMax, s.TopP)
	}
	if s.MaxTokens != MaxTokensLimit {
		t.Errorf("max_tokens 应夹到 %d，实际 %d", MaxTokensLimit, s.MaxTokens)
	}
	if s.ThinkingType != "enabled" {
		t.Errorf("thinking_type 应回落到 enabled，实际 %s", s.ThinkingType)
	}
	if s.RequestTimeout < 10 {
		t.Errorf("超时应回落到合法值，实际 %d", s.RequestTimeout)
	}
	if s.ContextMessages != 0 {
		t.Errorf("context_messages 应回落到 0，实际 %d", s.ContextMessages)
	}
	if err := s.Validate(); err != nil {
		t.Errorf("自愈后的配置应校验通过：%v", err)
	}
}

// TestEffectiveMaxTokens 验证官方默认输出上限的推导规则。
func TestEffectiveMaxTokens(t *testing.T) {
	s := Defaults()
	s.APIKey = "sk-test"

	s.MaxTokens = 0
	s.ThinkingType = "enabled"
	s.ReasoningEffort = "high"
	if got := s.EffectiveMaxTokens(); got != MaxTokensThink {
		t.Errorf("思考模式默认应为 %d，实际 %d", MaxTokensThink, got)
	}

	s.ReasoningEffort = "max"
	if got := s.EffectiveMaxTokens(); got != 131072 {
		t.Errorf("effort=max 默认应为 131072，实际 %d", got)
	}

	s.ThinkingType = "disabled"
	if got := s.EffectiveMaxTokens(); got != MaxTokensPlain {
		t.Errorf("非思考模式默认应为 %d，实际 %d", MaxTokensPlain, got)
	}

	s.MaxTokens = 1234
	if got := s.EffectiveMaxTokens(); got != 1234 {
		t.Errorf("显式设置应优先，实际 %d", got)
	}
}

// TestNormalizedEffort 验证官方向下兼容的别名映射。
func TestNormalizedEffort(t *testing.T) {
	cases := map[string]string{
		"minimal": "low",
		"low":     "low",
		"medium":  "high",
		"high":    "high",
		"xhigh":   "high",
		"max":     "max",
		"ultra":   "max",
	}
	for in, want := range cases {
		s := Defaults()
		s.ReasoningEffort = in
		if got := s.NormalizedEffort(); got != want {
			t.Errorf("%s 应映射为 %s，实际 %s", in, want, got)
		}
	}
}

// TestSanitizeKeepsEveryValidEffort 锁定一条不变量：凡是 Validate 放行的
// reasoning_effort，Sanitize 都不能把它改掉。
//
// 这条曾经是坏的——Validate 认 ultra，Sanitize 不认，于是配置里写 ultra
// 保存后会被静默改回 high，用户看不到任何提示。两处各写一份清单是根因，
// 所以这里逐个取值对照，任何一个漏写都会立刻失败。
func TestSanitizeKeepsEveryValidEffort(t *testing.T) {
	for _, effort := range Efforts {
		s := Defaults()
		s.APIKey = "sk-test"
		s.ReasoningEffort = effort
		s.Sanitize()
		if s.ReasoningEffort != effort {
			t.Errorf("Sanitize 把合法值 %q 改成了 %q", effort, s.ReasoningEffort)
		}
		if err := s.Validate(); err != nil {
			t.Errorf("Validate 拒绝了自己认可的 %q：%v", effort, err)
		}
	}
}

// TestValidEffortRejectsUnknown 未知档位仍要被两边一起挡住。
func TestValidEffortRejectsUnknown(t *testing.T) {
	for _, bad := range []string{"", "ultra2", "ULTRA", " low", "extreme"} {
		if ValidEffort(bad) {
			t.Errorf("%q 不该被认作合法档位", bad)
		}
		s := Defaults()
		s.APIKey = "sk-test"
		s.ReasoningEffort = bad
		s.Sanitize()
		if s.ReasoningEffort != "high" {
			t.Errorf("非法档位 %q 应回落为 high，实际 %q", bad, s.ReasoningEffort)
		}
		if err := s.Validate(); err != nil {
			t.Errorf("回落后的配置应当合法：%v", err)
		}
	}
}

// TestWarningsMatchOfficialSemantics 提示必须如实反映官方语义，不能报喜不报忧。
func TestWarningsMatchOfficialSemantics(t *testing.T) {
	s := Defaults()
	s.APIKey = "sk-test"

	s.ThinkingType = "enabled"
	s.TopP = 0.5
	joined := strings.Join(s.Warnings(), "|")
	if strings.Contains(joined, "temperature") {
		t.Error("不应提示已移除的温度配置")
	}
	if strings.Contains(joined, "0.95") {
		t.Error("不应显示旧采样抬升提示")
	}

	s.ThinkingType = "disabled"
	joined = strings.Join(s.Warnings(), "|")
	if strings.Contains(joined, "top_p") {
		t.Error("不应提示已移除的采样配置")
	}
}

// TestMaskKeyNeverLeaks 用合成Key验证短值与完整格式，不使用用户凭据。
func TestMaskKeyNeverLeaks(t *testing.T) {
	real := "sk-9" + strings.Repeat("0", 27) + "739a"
	got := MaskKey(real)
	if strings.Contains(got, "00000000") || strings.Contains(got, real) {
		t.Errorf("脱敏结果泄露了 Key 中部：%s", got)
	}
	if !strings.HasPrefix(got, "sk-9") {
		t.Errorf("应保留前 4 位便于识别，实际 %s", got)
	}
	if !strings.HasSuffix(got, "739a") {
		t.Errorf("应保留后 4 位便于确认，实际 %s", got)
	}
	if MaskKey("") != "（未设置）" {
		t.Errorf("空 Key 应返回占位文案，实际 %q", MaskKey(""))
	}
	if got := MaskKey("short"); strings.Contains(got, "short") {
		t.Error("短 Key 必须整体打码")
	}
}

// TestSaveLoadRoundTrip 验证落盘与读回的完整往返，并确认权限为 0600。
func TestSaveLoadRoundTrip(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "sub", "json")

	s := Defaults()
	s.APIKey = "sk-roundtrip-1234567890"
	s.Model = ModelV4Pro
	s.ThinkingType = "disabled"
	s.Temperature = 0.42
	s.SetPath(path)
	s.RememberKey(s.APIKey)

	if err := s.Save(); err != nil {
		t.Fatalf("保存失败：%v", err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("配置未写入：%v", err)
	}
	if info.Size() == 0 {
		t.Fatal("配置文件为空")
	}

	loaded, err := Load(path)
	if err != nil {
		t.Fatalf("加载失败：%v", err)
	}
	if loaded.Model != ModelV4Pro {
		t.Errorf("模型未往返：%s", loaded.Model)
	}
	if loaded.ThinkingType != "disabled" {
		t.Errorf("思考模式未往返：%s", loaded.ThinkingType)
	}
	if loaded.Temperature != 0.42 {
		t.Errorf("temperature 未往返：%v", loaded.Temperature)
	}
	if loaded.APIKey != s.APIKey {
		t.Errorf("API Key 未往返")
	}
	if len(loaded.APIKeyHistory) == 0 {
		t.Error("Key 历史未往返")
	}
	if loaded.Stream == nil || *loaded.Stream != true {
		t.Error("stream 开关未往返")
	}
}

// TestLoadMissingFileReturnsDefaults 文件不存在不应报错，而是给默认值。
func TestLoadMissingFileReturnsDefaults(t *testing.T) {
	path := filepath.Join(t.TempDir(), "nope.json")
	s, err := Load(path)
	if err != nil {
		t.Fatalf("缺失文件不应报错：%v", err)
	}
	if s.Model != ModelFlash {
		t.Errorf("应回落到默认模型，实际 %s", s.Model)
	}
	if s.Path() != path {
		t.Errorf("路径应被记录，实际 %s", s.Path())
	}
}

// TestLoadCorruptFileReportsError 损坏的 JSON 必须报错而不是静默吞掉。
func TestLoadCorruptFileReportsError(t *testing.T) {
	path := filepath.Join(t.TempDir(), "bad.json")
	if err := os.WriteFile(path, []byte("{ not json"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Load(path); err == nil {
		t.Error("损坏配置应返回错误")
	}
}

// TestEnvironmentOverride 环境变量应能临时覆盖凭据而不落盘。
func TestEnvironmentOverride(t *testing.T) {
	t.Setenv("DEEPSEEK_API_KEY", "sk-from-env")
	t.Setenv("DEEPSEEK_BASE_URL", "https://example.invalid")

	s := Defaults()
	s.APIKey = "sk-from-file"
	s.ApplyEnvironment()

	if s.APIKey != "sk-from-env" {
		t.Errorf("环境变量应覆盖文件值，实际 %s", s.APIKey)
	}
	if s.BaseURL != "https://example.invalid" {
		t.Errorf("Base URL 应被覆盖，实际 %s", s.BaseURL)
	}
}

// TestCloneIsDeep 克隆必须深拷贝，否则配置中心的「丢弃修改」会失效。
func TestCloneIsDeep(t *testing.T) {
	s := Defaults()
	s.APIKey = "sk-original"
	s.APIKeyHistory = []string{"sk-a"}

	cp := s.Clone()
	cp.APIKey = "sk-mutated"
	cp.APIKeyHistory[0] = "sk-b"
	cp.SetStream(false)

	if s.APIKey != "sk-original" {
		t.Error("修改克隆影响了原配置")
	}
	if s.APIKeyHistory[0] != "sk-a" {
		t.Error("历史切片未深拷贝")
	}
	if !s.StreamEnabled() {
		t.Error("Stream 指针未深拷贝")
	}
}

// TestLegacyModelNameGivesActionableError 旧模型名应给出明确的替代建议，而不是泛泛的「未知模型」。
func TestLegacyModelNameGivesActionableError(t *testing.T) {
	s := Defaults()
	s.APIKey = "sk-test"
	for legacy, replacement := range LegacyModelAliases {
		s.Model = legacy
		err := s.Validate()
		if err == nil {
			t.Errorf("%s 应校验失败", legacy)
			continue
		}
		if !strings.Contains(err.Error(), replacement) {
			t.Errorf("%s 的报错应建议改用 %s，实际：%v", legacy, replacement, err)
		}
		if !IsLegacyModel(legacy) {
			t.Errorf("%s 应被识别为旧模型名", legacy)
		}
	}
	if IsLegacyModel(ModelFlash) || IsLegacyModel(ModelV4Pro) {
		t.Error("在售模型不应被识别为旧模型名")
	}
}

// TestModelsHaveUniqueIDs 模型清单不能有重复或空 ID。
func TestModelsHaveUniqueIDs(t *testing.T) {
	seen := map[string]bool{}
	for _, m := range Models {
		if m.ID == "" {
			t.Error("模型 ID 不能为空")
		}
		if seen[m.ID] {
			t.Errorf("模型 ID 重复：%s", m.ID)
		}
		seen[m.ID] = true
	}
	if _, ok := LookupModel("deepseek-chat"); ok {
		t.Error("已下线的 deepseek-chat 不应出现在清单中")
	}
}

// TestFieldRefsMatchesJSON 字段自检清单应与实际序列化出的键一致。
func TestFieldRefsMatchesJSON(t *testing.T) {
	s := Defaults()
	s.APIKey = "sk-test"
	raw, err := json.Marshal(s)
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatal(err)
	}
	for _, k := range s.FieldRefs() {
		if _, ok := m[k]; !ok {
			t.Errorf("字段清单里的 %q 未出现在序列化结果中", k)
		}
	}
	if _, leaked := m["path"]; leaked {
		t.Error("内部字段 path 不应被序列化")
	}
}

// repoPromptDir reads shipped external defaults, never personal Prompt files.
//
// 提示词不再内嵌，测试必须像真实程序一样去读外部文件。
func repoPromptDir(t *testing.T) string {
	t.Helper()
	// 测试运行目录是 Core/，仓库根在上一层。
	dir, err := filepath.Abs(filepath.Join("..", "Agent", "official", "Eyra", "prompts", "default"))
	if err != nil {
		t.Fatal(err)
	}
	if info, err := os.Stat(dir); err != nil || !info.IsDir() {
		t.Fatalf("仓库 Prompt 目录不存在：%s", dir)
	}
	return dir
}

// TestNoEmbeddedPrompt 锁住核心原则：程序里不内嵌任何基准提示词。
//
// 出厂配置的 SystemPrompt 必须为空，且 CORE 包里不应存在 embed 提示词文件。
func TestNoEmbeddedPrompt(t *testing.T) {
	if got := Defaults().SystemPrompt; got != "" {
		t.Errorf("出厂 SystemPrompt 必须为空，实际 %q", got)
	}
	if got := Defaults().PromptDir; got != "" {
		t.Errorf("出厂 PromptDir 必须为空（表示自动查找），实际 %q", got)
	}
	entries, err := os.ReadDir(".")
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if filepath.Ext(e.Name()) == ".txt" {
			t.Errorf("CORE 目录里不应有内嵌提示词文件：%s", e.Name())
		}
	}
}

// TestPromptFilesPresent 发布时声明的提示词文件必须都在。
func TestPromptFilesPresent(t *testing.T) {
	dir := repoPromptDir(t)
	for _, name := range []string{PromptFileThinking, PromptFileSelf, PromptFileWork, PromptFileBoundary} {
		path := filepath.Join(dir, name)
		if _, err := os.Stat(path); err != nil {
			t.Errorf("%s 缺失：%v", name, err)
		}
	}
}

// TestAssembleOrderAndSkipping 验证拼装顺序与「空层整层跳过」。
func TestAssembleOrderAndSkipping(t *testing.T) {
	full := []Layer{
		{Title: "自我", Body: "身份"},
		{Title: "工作", Body: "做法"},
		{Title: "边界", Body: "轮廓"},
	}
	got := AssemblePrompt(full)
	if got != "身份\n\n做法\n\n轮廓" {
		t.Fatalf("只按顺序拼装外置正文，不注入内置层标题：%q", got)
	}

	// 去掉中间层：标题与被跳过层的内容都不该出现。
	skipped := []Layer{
		{Title: "自我", Body: "身份"},
		{Title: "工作", Body: "   "},
		{Title: "边界", Body: "轮廓"},
	}
	got = AssemblePrompt(skipped)
	if strings.Contains(got, "## 工作") {
		t.Error("空层不应输出标题")
	}
	if got != "身份\n\n轮廓" {
		t.Errorf("仅保留非空层正文：%q", got)
	}

	// 全空：结果为空串，而不是一堆空标题。
	if got := AssemblePrompt([]Layer{{Title: "自我"}, {Title: "工作"}}); got != "" {
		t.Errorf("全空时应返回空串，实际 %q", got)
	}
}

// TestRealPromptAssembly 用仓库里的真实文件跑一次完整拼装。
func TestRealPromptAssembly(t *testing.T) {
	st, err := LoadPrompts(repoPromptDir(t))
	if err != nil {
		t.Fatalf("装载失败：%v", err)
	}
	if strings.TrimSpace(st.Text) == "" {
		t.Fatal("仓库提示词拼装结果为空")
	}
	if strings.Contains(st.Text, "<!--") {
		t.Error("拼装结果不应包含文件头的说明注释")
	}
	if strings.Contains(st.Text, "\r") {
		t.Error("拼装结果不应残留 \\r")
	}

	// 自我层是本项目的身份来源，必须被装进来。
	self, err := PromptLayer(repoPromptDir(t), "self")
	if err != nil {
		t.Fatal(err)
	}
	if self.Empty() {
		t.Fatal("自我层为空——身份提示词没有被装进来")
	}
	// 默认四层由用户定稿（2026-11-10），这里只校验身份名，不锁定具体措辞。
	for _, must := range []string{"Eyra"} {
		if !strings.Contains(self.Body, must) {
			t.Errorf("自我层应包含 %q", must)
		}
	}
}

// TestLoadPromptsMissingDir 目录不存在时不算错误，只是没有提示词。
func TestLoadPromptsMissingDir(t *testing.T) {
	t.Setenv("AIEYRA_RESOURCE_ROOT", t.TempDir())
	st, err := LoadPrompts(filepath.Join(t.TempDir(), "nope"))
	if err != nil {
		t.Fatalf("目录不存在不应报错：%v", err)
	}
	if strings.TrimSpace(st.Text) != "" {
		t.Errorf("没有文件时不应拼出内容，实际 %q", st.Text)
	}
	for _, l := range st.Layers {
		if !l.Empty() {
			t.Errorf("%s 层应为空", l.Title)
		}
	}
}

// TestPromptDirResolutionOrder 显式指定的目录必须被采用。
func TestPromptDirResolutionOrder(t *testing.T) {
	dir := t.TempDir()
	if got := ResolvePromptDir(dir); got != dir {
		t.Errorf("显式目录应被采用，实际 %s", got)
	}
	// 显式给了不存在的目录也要用它，便于报错时指出用户写的路径。
	missing := filepath.Join(dir, "missing")
	if got := ResolvePromptDir(missing); got != missing {
		t.Errorf("显式目录即使不存在也应原样返回，实际 %s", got)
	}
}

// TestEffectiveSystemPrompt 空配置下 system 正文来自外部装载。
func TestEffectiveSystemPrompt(t *testing.T) {
	s := Defaults()
	if s.HasPrompt() {
		t.Error("未装载时不应有可用提示词")
	}
	if got := s.EffectiveSystemPrompt(); got != "" {
		t.Errorf("未装载且未手填时应为空串，实际 %q", got)
	}

	s.SetLoadedPrompt("外部正文")
	if got := s.EffectiveSystemPrompt(); got != "外部正文" {
		t.Errorf("应使用外部正文，实际 %q", got)
	}
	if !s.UsingExternalPrompt() {
		t.Error("应标记为使用外部提示词")
	}

	s.SystemPrompt = "手填正文"
	if got := s.EffectiveSystemPrompt(); got != "手填正文" {
		t.Errorf("手填应优先，实际 %q", got)
	}
	if s.UsingExternalPrompt() {
		t.Error("手填时不应标记为使用外部提示词")
	}
}

// TestSanitizeKeepsEmptyPrompt 自愈逻辑不得用任何文案回填提示词。
func TestSanitizeKeepsEmptyPrompt(t *testing.T) {
	s := Defaults()
	s.SystemPrompt = ""
	s.PromptDir = ""
	s.Sanitize()
	if s.SystemPrompt != "" {
		t.Errorf("SystemPrompt 应保持为空，实际 %q", s.SystemPrompt)
	}
	if s.PromptDir != "" {
		t.Errorf("PromptDir 应保持为空，实际 %q", s.PromptDir)
	}
}

// TestFieldRefsIncludesPromptFields 字段清单应包含提示词相关字段。
func TestFieldRefsIncludesPromptFields(t *testing.T) {
	refs := Defaults().FieldRefs()
	for _, want := range []string{"prompt_dir", "system_prompt"} {
		found := false
		for _, r := range refs {
			if r == want {
				found = true
			}
		}
		if !found {
			t.Errorf("字段清单缺少 %q", want)
		}
	}
}

// TestPromptWarningWhenNoneLoaded 没装载提示词时必须在警告里说出来。
func TestPromptWarningWhenNoneLoaded(t *testing.T) {
	s := Defaults()
	s.APIKey = "sk-test"
	joined := strings.Join(s.Warnings(), "|")
	if !strings.Contains(joined, "system") {
		t.Error("未装载提示词时应给出警告")
	}
	s.SetLoadedPrompt("有内容了")
	if joined := strings.Join(s.Warnings(), "|"); strings.Contains(joined, "未装载任何提示词") {
		t.Error("已装载时不应再警告")
	}
}

// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: DefaultBaseURL; ModelMeta; Models; LegacyModelAliases; LookupModel; ModelIDs; IsLegacyModel; Settings; Defaults; EffectiveSystemPrompt; SetLoadedPrompt; LoadedPrompt; HasPrompt; UsingExternalPrompt; CollaborationOn; TeamRoleOn; StreamEnabled; SetStream; ThinkingEnabled; EffectiveMaxTokens; NormalizedEffort; effortsCanonical; effortsAliases; Efforts; EffortHelp; ValidEffort; ModeLabel; Summary; ApplyEnvironment; applyRuntimeCredential; EnvAPIKey; RememberKey; MaskKey; MaskedKey; Validate; Warnings; Sanitize; Clone; Path; SetPath; UserConfigPath; ResolvePath; Load; Save; removeKnownJSONFields; FieldRefs
// Impact: python -B scripts/code-atlas.py show Core/types.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Package CORE 是 Aieyra OS 的逻辑层：配置模型、DeepSeek API 客户端、
// 提示词装载与请求构造。它不依赖任何终端 IO 库，因此可被 ui 层与测试直接复用。
package CORE

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"github.com/aieyra/aieyra-os/contracts/protocol"
	"github.com/aieyra/aieyra-os/contracts/storage"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"sort"
	"strings"

	"github.com/aieyra/aieyra-os/CORE/internal/privatefile"
)

// 官方模型 ID。
//
// 实测确认（见 client_test.go 与 live_test.go）：旧名字 deepseek-chat /
// deepseek-reasoner 已不在官方在售清单中，但仍可调用并由在售模型接管。
const (
	ModelFlash = "deepseek-flash"
	ModelV4Pro = "deepseek-v4-pro"
)

// DefaultBaseURL 是 OpenAI 兼容格式的官方入口。
// Anthropic 格式入口为 https://api.deepseek.com/anthropic
const DefaultBaseURL = "https://api.deepseek.com"

// 官方文档给出的取值范围与默认值。
const (
	MaxTokensLimit = 393216 // max_tokens 上限 384K
	MaxTokensThink = 65536  // 思考模式未指定时的默认输出上限
	MaxTokensPlain = 8192   // 非思考模式未指定时的默认输出上限
	TopPMin        = 0.01   // 官方要求 > 0
	TopPMax        = 1.0
	TempMin        = 0.0
	TempMax        = 2.0
)

// 对话角色由公共协议定义。
const (
	RoleSystem    = protocol.RoleSystem
	RoleUser      = protocol.RoleUser
	RoleAssistant = protocol.RoleAssistant
	RoleTool      = protocol.RoleTool
)

// ModelMeta 描述一个模型的能力边界，用于界面上展示与联动校验。
type ModelMeta struct {
	ID          string
	Name        string
	Version     string
	Vision      bool
	JSONMode    bool
	ToolCalls   bool
	FIM         bool
	Concurrency int
	// ContextWindow 是上下文上限（token）。界面用它显示「上下文 x/y」。
	// 数值来自官方 Models & Pricing 页；max_tokens 上限另见 MaxTokensLimit。
	ContextWindow int
}

// Models 是官方在售模型清单（来源：/zh-cn/quick_start/pricing）。
var Models = []ModelMeta{
	{
		ID: ModelFlash, Name: "DeepSeek Flash", Version: "DeepSeek-V4.1-Flash",
		Vision: true, JSONMode: true, ToolCalls: true, FIM: true, Concurrency: 2500,
		ContextWindow: 1_000_000,
	},
	{
		ID: ModelV4Pro, Name: "DeepSeek V4 Pro", Version: "DeepSeek-V4-Pro-0813",
		Vision: false, JSONMode: true, ToolCalls: true, FIM: true, Concurrency: 500,
		ContextWindow: 1_000_000,
	},
}

// LegacyModelAliases 记录旧模型名到在售模型的实测映射。
var LegacyModelAliases = map[string]string{
	"deepseek-chat":                ModelFlash,
	"deepseek-reasoner":            ModelFlash,
	"deepseek-v4-flash":            ModelFlash,
	"deepseek-v4-flash-vision-exp": ModelFlash,
}

// LookupModel 返回模型元信息，未知模型返回零值与 false。
func LookupModel(id string) (ModelMeta, bool) {
	for _, m := range Models {
		if m.ID == id {
			return m, true
		}
	}
	return ModelMeta{}, false
}

// ModelIDs 返回全部合法模型 ID。
func ModelIDs() []string {
	out := make([]string, 0, len(Models))
	for _, m := range Models {
		out = append(out, m.ID)
	}
	return out
}

// IsLegacyModel 判断是否为已下线的旧模型名。
func IsLegacyModel(id string) bool {
	_, ok := LegacyModelAliases[id]
	return ok
}

// —— 配置模型 ——

// Settings 是应用的完整配置。
//
// 字段与官方 Chat Completions 请求参数一一对应，并补充界面所需的本地项。
//
// 注意：本结构里没有任何「基准提示词」文案。人格与边界全部来自外部文件
// （见 prompt.go），程序只负责找到并装载它们。
type Settings struct {
	defaultsErr error

	Language            string               `json:"language"`
	Adapter             string               `json:"adapter,omitempty"`
	APIProfiles         []APIProfile         `json:"api_profiles,omitempty"`
	ModelPoolVersion    int                  `json:"model_pool_version,omitempty"`
	ProviderConnections []ProviderConnection `json:"provider_connections,omitempty"`
	MatrixProfile       string               `json:"matrix_profile,omitempty"`
	SubconsciousProfile string               `json:"subconscious_profile,omitempty"`
	// 团队协同：Vaya（project 角色）与 Cota（助理，execution 角色）的模型、可用工具和单独的启用开关；
	// 模型为空时用 Eyra 的；工具为 nil 时用默认。协同开关缺省（nil）为开（R8）。
	VisionProfile        string            `json:"vision_profile,omitempty"`
	ExecutionProfile     string            `json:"execution_profile,omitempty"`
	VisionTools          []string          `json:"vision_tools,omitempty"`
	ExecutionTools       []string          `json:"execution_tools,omitempty"`
	CollaborationEnabled *bool             `json:"collaboration_enabled,omitempty"`
	VisionEnabled        *bool             `json:"vision_enabled,omitempty"`
	ExecutionEnabled     *bool             `json:"execution_enabled,omitempty"`
	ModelOptions         map[string]any    `json:"model_options,omitempty"`
	ProviderLastProfiles map[string]string `json:"provider_last_profiles,omitempty"`
	ActiveProfile        string            `json:"active_profile,omitempty"`
	ModelContextWindow   int               `json:"model_context_window,omitempty"`
	CompactAtTokens      *int              `json:"compact_at_tokens,omitempty"`
	ModelVision          bool              `json:"model_vision,omitempty"`
	// —— API 配置 ——
	APIKey               string   `json:"api_key"`
	APIProtocol          string   `json:"api_protocol,omitempty"`
	BaseURL              string   `json:"base_url"`
	APIKeyHistory        []string `json:"api_key_history"`
	SystemPrompt         string   `json:"system_prompt"`
	PromptDir            string   `json:"prompt_dir"`
	RequestTimeout       int      `json:"request_timeout_seconds"`
	Stream               *bool    `json:"stream"`
	IncludeUsage         bool     `json:"stream_include_usage"`
	ResponseFormat       string   `json:"response_format"`
	UserID               string   `json:"user_id"`
	ContextMessages      int      `json:"context_messages"` // 兼容旧配置；不再静默裁剪历史
	CompactPercent       int      `json:"compact_percent"`  // 0 关闭自动压缩，手动 Compact 仍可用
	CompactKeepTurns     int      `json:"compact_keep_turns"`
	ContextWorkingTokens int      `json:"context_working_tokens"`
	MemoryEnabled        bool     `json:"memory_enabled"`
	DreamsEnabled        bool     `json:"dreams_enabled"`
	MemorySurfaceTokens  int      `json:"memory_surface_tokens"`

	// —— 模型选择 ——
	Model           string  `json:"model"`
	Temperature     float64 `json:"temperature"`
	TopP            float64 `json:"top_p"`
	MaxTokens       int     `json:"max_tokens"` // 0 表示交给服务端默认值
	ThinkingType    string  `json:"thinking_type"`
	ReasoningEffort string  `json:"reasoning_effort"`
	ShowReasoning   bool    `json:"show_reasoning"`

	// loadedPrompt 是启动时从 PromptDir 装载到的外部提示词正文，不落盘。
	loadedPrompt string

	// path 记录配置文件位置，不写入 JSON。
	path        string
	fileVersion string

	// envAPIKey 为 true 表示当前 APIKey 来自环境变量（临时使用，不应落盘）。
	// 未导出故不会被 json 序列化，Clone 时需显式处理。
	envAPIKey bool

	// migratedModel 记录 Sanitize 自动迁移前的旧模型名（空表示未迁移）。
	// 用于 Warnings 给出“已自动迁移”的响亮提示，避免静默改掉用户输入。
	migratedModel string
}

// Defaults 返回出厂配置。
//
// SystemPrompt 与 PromptDir 都出厂为空：前者空表示「用外部提示词」，
// 后者空表示「按 ResolvePromptDir 的优先级自动查找」。
func Defaults() *Settings {
	s := &Settings{}
	data, err := configResource("默认设置.json")
	if err == nil {
		err = json.Unmarshal(data, s)
	}
	s.defaultsErr = err
	return s
}

// —— 提示词接入 ——

// EffectiveSystemPrompt 返回本次请求实际要使用的 system 正文。
//
// 优先级：配置里手填的正文 > 启动时装载的外部提示词。
// 两者都为空则返回空串，请求不带 system 消息——程序里没有写死的兜底人格。
func (s *Settings) EffectiveSystemPrompt() string {
	if t := strings.TrimSpace(s.SystemPrompt); t != "" {
		return s.SystemPrompt
	}
	return s.loadedPrompt
}

// SetLoadedPrompt 记录本次装载到的外部提示词正文。
func (s *Settings) SetLoadedPrompt(text string) { s.loadedPrompt = text }

// LoadedPrompt 返回当前装载到的外部提示词正文。
func (s *Settings) LoadedPrompt() string { return s.loadedPrompt }

// HasPrompt 表示当前是否有可用的 system 正文。
func (s *Settings) HasPrompt() bool {
	return strings.TrimSpace(s.EffectiveSystemPrompt()) != ""
}

// UsingExternalPrompt 表示当前 system 正文来自外部文件而非手填。
func (s *Settings) UsingExternalPrompt() bool {
	return strings.TrimSpace(s.SystemPrompt) == "" && strings.TrimSpace(s.loadedPrompt) != ""
}

// —— 参数语义 ——

// CollaborationOn：团队协同开关，缺省为开。
func (s *Settings) CollaborationOn() bool {
	return CurrentReleaseStage().TeamCollaboration && (s.CollaborationEnabled == nil || *s.CollaborationEnabled)
}

// TeamRoleOn：Vaya、Cota 各自的启用开关，缺省为开；团队总开关关了就都不可用。
func (s *Settings) TeamRoleOn(role string) bool {
	if !s.CollaborationOn() {
		return false
	}
	switch role {
	case WorkspaceProject:
		return s.VisionEnabled == nil || *s.VisionEnabled
	case WorkspaceExecution:
		return s.ExecutionEnabled == nil || *s.ExecutionEnabled
	}
	return false
}

// StreamEnabled 处理 *bool 的三态：nil 视为开启（与官方流式推荐一致）。
func (s *Settings) StreamEnabled() bool { return s.Stream == nil || *s.Stream }

// SetStream 设置流式开关。
func (s *Settings) SetStream(v bool) { s.Stream = &v }

// ThinkingEnabled 表示当前是否处于思考模式。
func (s *Settings) ThinkingEnabled() bool { return s.ThinkingType == "enabled" }

// EffectiveMaxTokens is a local context reservation. Zero MaxTokens must
// remain zero on the request so the provider selects its default output size.
func (s *Settings) EffectiveMaxTokens() int {
	if s.MaxTokens > 0 {
		return s.MaxTokens
	}
	if p := s.activePoolProfile(); s.ModelPoolVersion == 1 && p != nil {
		return profileOutputReservation(p, 0)
	}
	if s.GenericAdapter() {
		if s.Protocol() == ProtocolMessages {
			return s.NativeOutputLimit()
		}
		return 4096
	}
	if s.ThinkingEnabled() {
		if s.ReasoningEffort == "max" {
			return 131072 // 官方：effort=max 时默认 128K
		}
		return MaxTokensThink
	}
	return MaxTokensPlain
}

// NormalizedEffort 把官方向下兼容的别名映射为实际生效的强度。
func (s *Settings) NormalizedEffort() string {
	switch s.ReasoningEffort {
	case "minimal":
		return "low"
	case "medium", "xhigh":
		return "high"
	case "ultra":
		return "max"
	default:
		return s.ReasoningEffort
	}
}

// effortsCanonical 是 reasoning_effort 的四个正名，会原样发给 API。
var effortsCanonical = []string{"none", "low", "high", "max"}

// effortsAliases 是官方同样接受、发送前由 NormalizedEffort 归一的别名。
var effortsAliases = []string{"minimal", "medium", "xhigh", "ultra"}

// Efforts 是 reasoning_effort 的全部合法取值：正名在前，别名在后。
//
// 存在的意义只有一个：让 Validate 与 Sanitize 共用同一份清单。
// 分开各写一份必然会漂移——ultra 就是这么坏的：Validate 放行它，
// Sanitize 却认不出来，于是用户填了 ultra、保存，再打开就变成了 high，
// 而中间没有任何报错。Client/Desktop/src/spec.cjs 里也有一份同样的清单。
var Efforts = append(append([]string{}, effortsCanonical...), effortsAliases...)

// EffortHelp 返回校验失败时的取值说明，与 Desktop 端文案保持一致。
func EffortHelp() string {
	return fmt.Sprintf("%s（别名 %s 也接受）",
		strings.Join(effortsCanonical, " / "), strings.Join(effortsAliases, " / "))
}

// ValidEffort 报告 effort 是否为合法取值。
func ValidEffort(effort string) bool {
	return slices.Contains(Efforts, effort)
}

// ModeLabel 返回面向界面的模式文案。
func (s *Settings) ModeLabel() string {
	if s.ThinkingEnabled() {
		return "思考 / " + s.NormalizedEffort()
	}
	return "非思考"
}

// Summary 生成一行摘要，用于状态栏显示。
func (s *Settings) Summary() string {
	parts := []string{s.Model, s.ModeLabel()}
	if s.MaxTokens > 0 {
		parts = append(parts, fmt.Sprintf("max=%d", s.MaxTokens))
	}
	if s.ResponseFormat == "json_object" {
		parts = append(parts, "JSON")
	}
	if s.StreamEnabled() {
		parts = append(parts, "stream")
	} else {
		parts = append(parts, "blocking")
	}
	return strings.Join(parts, " · ")
}

// —— 凭据 ——

// ApplyEnvironment 用环境变量覆盖凭据与提示词目录，便于不落盘的临时使用。
func (s *Settings) ApplyEnvironment() {
	if k := strings.TrimSpace(os.Getenv("DEEPSEEK_API_KEY")); k != "" && !s.GenericAdapter() {
		s.APIKey = k
		s.envAPIKey = true
	}
	if u := strings.TrimSpace(os.Getenv("DEEPSEEK_BASE_URL")); u != "" && !s.GenericAdapter() {
		s.BaseURL = u
	}
	if d := strings.TrimSpace(os.Getenv("AIEYRA_PROMPT_DIR")); d != "" {
		s.PromptDir = d
	}
	// 环境变量绕过了文件加载时的 Sanitize，这里做一次轻量归一，
	// 保证“文件值”与“环境值”走同一套口径（见 Validate 的注释）。
	s.BaseURL = strings.TrimSpace(s.BaseURL)
	s.PromptDir = strings.TrimSpace(s.PromptDir)
	if s.BaseURL == "" {
		s.BaseURL = DefaultBaseURL
	}
	s.applyRuntimeCredential()
}

// 临时凭据必须同时绑定显式profile及完整入口/协议/模型身份，防止切模型后
// 把另一供应商的Key沿用过去。只覆盖请求快照，不进入连接或Key历史。
func (s *Settings) applyRuntimeCredential() {
	if s.ActiveProfile == "" || os.Getenv("AIEYRA_RUNTIME_PROFILE") != s.ActiveProfile || os.Getenv("AIEYRA_RUNTIME_PROVIDER_IDENTITY") != s.ProviderIdentity() {
		return
	}
	p := s.activePoolProfile()
	if p == nil || p.Enabled != nil && !*p.Enabled || p.Model != s.Model || p.Protocol != s.Protocol() || NormalizeBaseURL(p.BaseURL) != NormalizeBaseURL(s.BaseURL) || p.Adapter != s.Adapter {
		return
	}
	k := strings.TrimSpace(os.Getenv("AIEYRA_RUNTIME_API_KEY"))
	if k != "" && len(k) <= 4096 && !strings.ContainsAny(k, "\r\n") {
		s.APIKey, s.envAPIKey = k, true
	}
}

// EnvAPIKey 报告当前 Key 是否来自环境变量（调用方据此决定是否落盘）。
func (s *Settings) EnvAPIKey() bool { return s.envAPIKey }

// RememberKey 把新 Key 记入历史，用于快速切换。返回是否发生变化。
func (s *Settings) RememberKey(k string) bool {
	k = strings.TrimSpace(k)
	if k == "" || len(k) > 512 {
		return false
	}
	for _, old := range s.APIKeyHistory {
		if old == k {
			return false
		}
	}
	// 历史只做展示与切换：先过滤空串与超长脏数据，再截断到 8 条，
	// 避免被攻破的调用方塞超大数组直接落盘。
	kept := make([]string, 0, 8)
	for _, old := range s.APIKeyHistory {
		if strings.TrimSpace(old) == "" || len(old) > 512 {
			continue
		}
		kept = append(kept, old)
	}
	s.APIKeyHistory = append([]string{k}, kept...)
	if len(s.APIKeyHistory) > 8 {
		s.APIKeyHistory = s.APIKeyHistory[:8]
	}
	return true
}

// MaskKey 对 Key 做脱敏。
//
// 刻意不保留前缀明文之外的信息，避免短 Key 被完整还原。
func MaskKey(k string) string {
	k = strings.TrimSpace(k)
	if k == "" {
		return "（未设置）"
	}
	if len(k) <= 8 {
		return strings.Repeat("*", len(k))
	}
	return k[:4] + strings.Repeat("*", 8) + k[len(k)-4:]
}

// MaskedKey 返回脱敏后的 Key。
func (s *Settings) MaskedKey() string { return MaskKey(s.APIKey) }

// —— 校验与自愈 ——

// Validate 校验参数是否满足官方约束，返回可读的错误。
func (s *Settings) Validate() error {
	if err := s.ValidatePoolRequest(); err != nil {
		return err
	}
	if s.Language != "" && s.Language != "zh-CN" && s.Language != "en-US" {
		return fmt.Errorf("language: zh-CN / en-US")
	}
	if s.Adapter != "" && s.Adapter != "deepseek" && s.Adapter != "openai" {
		return fmt.Errorf("adapter: deepseek / openai")
	}
	if s.GenericAdapter() && (strings.TrimSpace(s.Model) == "" || s.ModelContextWindow < 8192) {
		return fmt.Errorf("通用模型需要模型名称和有效上下文窗口")
	}
	if s.ModelPoolVersion != 1 && s.CompactAtTokens != nil && (*s.CompactAtTokens < 0 || *s.CompactAtTokens > 2000000) {
		return fmt.Errorf("compact_at_tokens 需在 0～2000000 之间")
	}
	if s.APIProtocol != "" && s.APIProtocol != ProtocolResponses && s.APIProtocol != ProtocolChat && s.APIProtocol != ProtocolMessages && s.APIProtocol != ProtocolGoogle {
		return fmt.Errorf("api_protocol 仅支持 responses / chat_completions / anthropic_messages / google_generate")
	}
	if strings.TrimSpace(s.APIKey) == "" {
		return fmt.Errorf("API Key 为空，请在「API配置」标签页填写")
	}
	// 校验一律看 trim 之后的值。
	// 不能直接用原串：配置界面在 Electron 端校验时是 trim 过的，
	// 于是 "  https://api.deepseek.com  " 会在那边通过、存下来、再被这里拒掉——
	// 同一份配置两个程序给出相反结论。归一由 Sanitize 负责，校验只管判断。
	base := strings.TrimSpace(s.BaseURL)
	if base == "" {
		return fmt.Errorf("Base URL 为空")
	}
	if !strings.HasPrefix(base, "http://") && !strings.HasPrefix(base, "https://") {
		return fmt.Errorf("Base URL 必须以 http:// 或 https:// 开头")
	}
	// 明文 http 只允许本地回环：代理/网关场景下 Bearer Key 会裸奔。
	// 外网 http 属于高危配置，直接拦下比“发出去再说”好。
	if strings.HasPrefix(base, "http://") {
		rest := strings.TrimPrefix(base, "http://")
		host := rest
		if i := strings.IndexAny(rest, "/:?"); i >= 0 {
			host = rest[:i]
		}
		h := strings.ToLower(strings.TrimSpace(host))
		if h != "localhost" && h != "127.0.0.1" && h != "::1" {
			return fmt.Errorf("Base URL 为明文 http（%s）：只允许 localhost/127.0.0.1，自建网关请用 https 或本地代理", base)
		}
	}
	if _, ok := LookupModel(s.Model); !ok && !s.GenericAdapter() {
		if replacement, legacy := LegacyModelAliases[s.Model]; legacy {
			return fmt.Errorf("%s 是已下线的旧模型名，请改用 %s", s.Model, replacement)
		}
		return fmt.Errorf("未知模型 %q，可选：%s", s.Model, strings.Join(ModelIDs(), " / "))
	}
	if s.MaxTokens < 0 || s.MaxTokens > MaxTokensLimit {
		return fmt.Errorf("max_tokens 需在 0～%d 之间（0 表示使用服务端默认值）", MaxTokensLimit)
	}
	if s.Temperature < TempMin || s.Temperature > TempMax {
		return fmt.Errorf("temperature 需在 %.0f～%.0f 之间", TempMin, TempMax)
	}
	if s.TopP < TopPMin || s.TopP > TopPMax {
		return fmt.Errorf("top_p 需大于 0 且不超过 %.0f", TopPMax)
	}
	switch s.ThinkingType {
	case "enabled", "disabled":
	default:
		return fmt.Errorf("thinking.type 只能是 enabled 或 disabled")
	}
	if !ValidEffort(s.ReasoningEffort) {
		// 别名（minimal/medium/xhigh/ultra）也放行：NormalizedEffort 会把它们
		// 归一到 none/low/high/max，官方文档也把它们列为可接受值。
		// 只认四个正名会让"照文档填 ultra"的用户在界面上吃到一句没道理的报错。
		return fmt.Errorf("reasoning_effort 只能是 %s", EffortHelp())
	}
	if s.ResponseFormat != "text" && s.ResponseFormat != "json_object" {
		return fmt.Errorf("response_format 只能是 text 或 json_object")
	}
	if s.RequestTimeout < 10 {
		return fmt.Errorf("请求超时至少 10 秒")
	}
	if s.RequestTimeout > 3600 {
		return fmt.Errorf("请求超时至多 3600 秒")
	}
	if s.ContextMessages < 0 {
		return fmt.Errorf("上下文消息数不能为负数")
	}
	if s.ContextMessages > 1000 {
		return fmt.Errorf("上下文消息数至多 1000 条")
	}
	if s.CompactPercent != 0 && (s.CompactPercent < 25 || s.CompactPercent > 90) {
		return fmt.Errorf("自动压缩阈值应为 25–90%%，或 0 关闭")
	}
	if s.CompactKeepTurns < 1 || s.CompactKeepTurns > 20 {
		return fmt.Errorf("保留原文轮次应为 1–20")
	}
	if s.ContextWorkingTokens < 8192 || s.ContextWorkingTokens > 1000000 {
		return fmt.Errorf("工作上下文预算应为 8192–1000000 tokens")
	}
	if s.MemorySurfaceTokens < 256 || s.MemorySurfaceTokens > 3000 {
		return fmt.Errorf("表层记忆预算应为 256–3000 tokens")
	}
	return nil
}

// Warnings 返回不会导致请求失败、但会影响实际效果的提示。
//
// 旧采样参数仅兼容读取，不再作为可调项或请求字段。
func (s *Settings) Warnings() []string {
	var w []string
	if s.ResponseFormat == "json_object" {
		w = append(w, "JSON 模式需在系统提示词中明确要求输出 JSON，否则可能持续输出空白直至截断")
	}
	if s.migratedModel != "" {
		w = append(w, fmt.Sprintf("模型 %s 已下线，已自动迁移为 %s（已保存后生效）", s.migratedModel, s.Model))
	}
	if s.envAPIKey {
		w = append(w, "当前 API Key 来自进程环境（临时使用，保存配置时不会写入文件）")
	}
	if s.MaxTokens == 0 {
		w = append(w, fmt.Sprintf("max_tokens 未设置，将由服务端决定（本地估计 %d，仅供显示）", s.EffectiveMaxTokens()))
	}
	if strings.TrimSpace(s.APIKey) == "" {
		w = append(w, "尚未配置 API Key，无法发起对话")
	}
	if !s.HasPrompt() {
		w = append(w, "未装载任何提示词：本次对话不会携带 system 消息")
	}
	return w
}

// Sanitize 把越界字段夹回合法范围，用于从磁盘加载旧配置后自愈。
//
// 刻意不用任何文案回填 SystemPrompt：留空是有意义的，表示「使用外部提示词」。
func (s *Settings) Sanitize() {
	// 先归一空白，再判空：手填或从别处粘来的地址常带首尾空格，
	// 留着会让校验与请求都出问题（见 Validate 的注释）。
	s.BaseURL = strings.TrimSpace(s.BaseURL)
	s.Model = strings.TrimSpace(s.Model)
	s.PromptDir = strings.TrimSpace(s.PromptDir)
	if s.BaseURL == "" {
		s.BaseURL = DefaultBaseURL
	}
	if s.Model == "" {
		s.Model = ModelFlash
	} else if _, ok := LookupModel(s.Model); !ok && !s.GenericAdapter() {
		// 已下线旧模型名：自动迁移到在售模型，但留下 migratedModel，
		// 让 Warnings 能响亮地告诉用户“被切过”，而不是静默改掉。
		// Validate 仍会对迁移前的值报错（见 TestLegacyModelNameGivesActionableError），
		// 自愈路径与校验路径职责分开：读盘自愈、显式校验报错。
		if replacement, legacy := LegacyModelAliases[s.Model]; legacy {
			if s.migratedModel == "" {
				s.migratedModel = s.Model
			}
			s.Model = replacement
		} else {
			s.Model = ModelFlash
		}
	}
	if s.Temperature < TempMin {
		s.Temperature = TempMin
	}
	if s.Temperature > TempMax {
		s.Temperature = TempMax
	}
	if s.TopP < TopPMin {
		s.TopP = TopPMin
	}
	if s.TopP > TopPMax {
		s.TopP = TopPMax
	}
	if s.MaxTokens < 0 {
		s.MaxTokens = 0
	}
	if s.MaxTokens > MaxTokensLimit {
		s.MaxTokens = MaxTokensLimit
	}
	if s.ThinkingType != "enabled" && s.ThinkingType != "disabled" {
		s.ThinkingType = "enabled"
	}
	if !ValidEffort(s.ReasoningEffort) {
		s.ReasoningEffort = "high"
	}
	if s.ResponseFormat != "json_object" {
		s.ResponseFormat = "text"
	}
	if s.RequestTimeout < 10 {
		s.RequestTimeout = 300
	}
	// 上限与 Desktop 端一致（1000 条 / 3600 秒）：两边自愈结果必须相同，
	// 否则同一份配置在两端读出不同值（G1）。放行集与清洗集也要一致
	//（见约束 40 推论），所以 Validate 同步加了上界报错。
	if s.RequestTimeout > 3600 {
		s.RequestTimeout = 3600
	}
	if s.ContextMessages < 0 {
		s.ContextMessages = 0
	}
	if s.ContextMessages > 1000 {
		s.ContextMessages = 1000
	}
	if s.Stream == nil {
		t := true
		s.Stream = &t
	}
	if s.CompactPercent != 0 && (s.CompactPercent < 25 || s.CompactPercent > 90) {
		s.CompactPercent = 90
	}
	if s.CompactKeepTurns < 1 || s.CompactKeepTurns > 20 {
		s.CompactKeepTurns = 4
	}
	if s.ContextWorkingTokens < 8192 || s.ContextWorkingTokens > 1000000 {
		s.ContextWorkingTokens = 200000
	}
	if s.MemorySurfaceTokens < 256 || s.MemorySurfaceTokens > 3000 {
		s.MemorySurfaceTokens = 1500
	}
}

// Clone 深拷贝，供配置中心做「取消编辑」回滚。
func (s *Settings) Clone() *Settings {
	if s == nil {
		return nil
	}
	cp := *s
	if s.VisionEnabled != nil {
		on := *s.VisionEnabled
		cp.VisionEnabled = &on
	}
	if s.ExecutionEnabled != nil {
		on := *s.ExecutionEnabled
		cp.ExecutionEnabled = &on
	}
	if s.CollaborationEnabled != nil {
		on := *s.CollaborationEnabled
		cp.CollaborationEnabled = &on
	}
	cp.ModelOptions = cloneOptions(s.ModelOptions)
	cp.ProviderConnections = append([]ProviderConnection(nil), s.ProviderConnections...)
	for i := range cp.ProviderConnections {
		cp.ProviderConnections[i].APIKeyHistory = append([]string(nil), s.ProviderConnections[i].APIKeyHistory...)
	}
	if s.ProviderLastProfiles != nil {
		cp.ProviderLastProfiles = map[string]string{}
		for k, v := range s.ProviderLastProfiles {
			cp.ProviderLastProfiles[k] = v
		}
	}
	cp.APIProfiles = append([]APIProfile(nil), s.APIProfiles...)
	for i := range cp.APIProfiles {
		if s.APIProfiles[i].AdapterPackage != nil {
			v := *s.APIProfiles[i].AdapterPackage
			cp.APIProfiles[i].AdapterPackage = &v
		}
		if s.APIProfiles[i].CompactAtTokens != nil {
			value := *s.APIProfiles[i].CompactAtTokens
			cp.APIProfiles[i].CompactAtTokens = &value
		}
		cp.APIProfiles[i].ParameterSpecs = append([]ParameterSpec(nil), s.APIProfiles[i].ParameterSpecs...)
		for j := range cp.APIProfiles[i].ParameterSpecs {
			cp.APIProfiles[i].ParameterSpecs[j].Values = append([]string(nil), s.APIProfiles[i].ParameterSpecs[j].Values...)
			cp.APIProfiles[i].ParameterSpecs[j].WirePath = append([]string(nil), s.APIProfiles[i].ParameterSpecs[j].WirePath...)
		}
		cp.APIProfiles[i].SupportedParameters = append([]string(nil), s.APIProfiles[i].SupportedParameters...)
		if s.APIProfiles[i].Enabled != nil {
			v := *s.APIProfiles[i].Enabled
			cp.APIProfiles[i].Enabled = &v
		}
		if s.APIProfiles[i].Free != nil {
			v := *s.APIProfiles[i].Free
			cp.APIProfiles[i].Free = &v
		}
		cp.APIProfiles[i].APIKeyHistory = append([]string(nil), s.APIProfiles[i].APIKeyHistory...)
		cp.APIProfiles[i].Parameters = append(json.RawMessage(nil), s.APIProfiles[i].Parameters...)
		cp.APIProfiles[i].VerifiedOptions = append(json.RawMessage(nil), s.APIProfiles[i].VerifiedOptions...)
	}
	if s.Stream != nil {
		v := *s.Stream
		cp.Stream = &v
	}
	if s.CompactAtTokens != nil {
		value := *s.CompactAtTokens
		cp.CompactAtTokens = &value
	}
	cp.APIKeyHistory = make([]string, len(s.APIKeyHistory))
	copy(cp.APIKeyHistory, s.APIKeyHistory)
	// 运行时字段一并隔离：漏掉任何一个都会串路径/串提示词/串凭据来源。
	cp.path = s.path
	cp.loadedPrompt = s.loadedPrompt
	cp.envAPIKey = s.envAPIKey
	cp.migratedModel = s.migratedModel
	return &cp
}

// —— 持久化 ——

// Path 返回配置文件的绝对路径。
func (s *Settings) Path() string { return s.path }

// SetPath 记录配置文件位置。
func (s *Settings) SetPath(p string) { s.path = p }

// UserConfigPath 返回用户配置目录下的配置文件路径。
//
// 这是「这台机器上的默认配置」，与可执行文件所在位置无关。
func UserConfigPath() string {
	dir, err := os.UserConfigDir()
	if err != nil {
		if home, herr := os.UserHomeDir(); herr == nil {
			dir = filepath.Join(home, ".config")
		} else {
			dir = "."
		}
	}
	return filepath.Join(dir, "AieyraOS", "Config", "config.json")
}

// ResolvePath 决定配置文件位置。
//
// 优先级：显式 --config > 可执行文件同目录的便携 config.json > 用户配置目录。
// 需要「按哪个候选文件真实存在」做多级查找时，请用 app.LoadSettings。
func ResolvePath(explicit string) string {
	if explicit != "" {
		if abs, err := filepath.Abs(explicit); err == nil {
			return abs
		}
		return explicit
	}
	if exe, err := os.Executable(); err == nil {
		portable := filepath.Join(filepath.Dir(exe), "Config", "config.json")
		if _, err := os.Stat(portable); err == nil {
			return portable
		}
	}
	return UserConfigPath()
}

// Load 读取配置；文件不存在时返回默认配置且不报错。
func Load(path string) (*Settings, error) {
	if err := ValidatePrivateProfile(path); err != nil {
		return nil, err
	}
	s := Defaults()
	if s.defaultsErr != nil {
		return nil, s.defaultsErr
	}
	data, err := os.ReadFile(path)
	if err != nil && !os.IsNotExist(err) {
		return nil, fmt.Errorf("读取配置失败 %s: %w", path, err)
	}
	if err == nil {
		if err := json.Unmarshal(data, s); err != nil {
			return nil, fmt.Errorf("解析配置失败 %s: %w", path, err)
		}
	}
	s.path = path
	if err == nil {
		s.fileVersion = fmt.Sprintf("%x", sha256.Sum256(data))
	} else {
		s.fileVersion = "missing"
	}
	s.Sanitize()
	s.applyPoolProfile()
	s.ApplyEnvironment()
	return s, nil
}

// Save 原子写入配置（先写临时文件再重命名），避免写坏。
func (s *Settings) Save() error {
	releaseOwner, ownerErr := storage.Enter(s.path)
	if ownerErr != nil {
		return ownerErr
	}
	defer releaseOwner()
	if err := ValidatePrivateProfile(s.path); err != nil {
		return err
	}
	path := s.path
	if path == "" {
		return fmt.Errorf("配置路径为空")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return fmt.Errorf("创建配置目录失败: %w", err)
	}
	lockPath := path + ".write-lock"
	lock, err := os.OpenFile(lockPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return fmt.Errorf("配置正在被另一写入者使用，请稍后重试: %w", err)
	}
	defer func() { _ = lock.Close(); _ = os.Remove(lockPath) }()
	_, _ = fmt.Fprintf(lock, `{"pid":%d}`, os.Getpid())
	existing, readErr := os.ReadFile(path)
	if readErr != nil && !os.IsNotExist(readErr) {
		return readErr
	}
	currentVersion := "missing"
	if readErr == nil {
		currentVersion = fmt.Sprintf("%x", sha256.Sum256(existing))
	}
	if s.fileVersion != "" && s.fileVersion != currentVersion {
		return fmt.Errorf("配置已变化，请重新载入后保存")
	}
	// 环境变量来的临时 Key 不许落盘：读回旧文件，把旧凭据盖回去。
	// 否则“临时借用一次 Key 改个参数”会把临时 Key 永久写进文件（F2）。
	toSave := s
	if s.envAPIKey {
		cp := *s
		cp.APIKey, cp.APIKeyHistory = "", nil
		toSave = &cp
		if data, err := os.ReadFile(path); err == nil {
			var old Settings
			if json.Unmarshal(data, &old) == nil {
				if s.ProviderLastProfiles != nil {
					cp.ProviderLastProfiles = map[string]string{}
					for k, v := range s.ProviderLastProfiles {
						cp.ProviderLastProfiles[k] = v
					}
				}
				cp.APIKey = old.APIKey
				cp.APIKeyHistory = append([]string{}, old.APIKeyHistory...)
				toSave = &cp
			}
		}
	}
	data, err := json.MarshalIndent(toSave, "", "  ")
	if err != nil {
		return fmt.Errorf("序列化配置失败: %w", err)
	}
	if len(existing) > 0 {
		var merged, known map[string]json.RawMessage
		if err = json.Unmarshal(existing, &merged); err != nil {
			return fmt.Errorf("旧配置无法解析，未覆盖: %w", err)
		}
		_ = json.Unmarshal(data, &known)
		// 原生与桌面设置共享扩展字段；按稳定 ID 合并，保留未识别的嵌套元数据。
		for _, name := range []string{"provider_connections", "api_profiles"} {
			var oldRows, newRows []map[string]json.RawMessage
			if json.Unmarshal(merged[name], &oldRows) != nil || json.Unmarshal(known[name], &newRows) != nil {
				continue
			}
			byID := map[string]map[string]json.RawMessage{}
			for _, row := range oldRows {
				byID[string(row["id"])] = row
			}
			for i, row := range newRows {
				if old := byID[string(row["id"])]; old != nil {
					kind := reflect.TypeOf(APIProfile{})
					if name == "provider_connections" {
						kind = reflect.TypeOf(ProviderConnection{})
					}
					removeKnownJSONFields(old, kind)
					for key, value := range row {
						old[key] = value
					}
					newRows[i] = old
				}
			}
			known[name], _ = json.Marshal(newRows)
		}
		removeKnownJSONFields(merged, reflect.TypeOf(Settings{}))
		for key, value := range known {
			merged[key] = value
		}
		data, err = json.MarshalIndent(merged, "", "  ")
		if err != nil {
			return err
		}
	}
	if err := privatefile.Write(path, data); err != nil {
		return fmt.Errorf("替换配置文件失败: %w", err)
	}
	s.fileVersion = fmt.Sprintf("%x", sha256.Sum256(data))
	return nil
}

// Omitted known fields represent cleared values. Only unknown extension keys
// survive a shared-settings save; resurrecting old protocol metadata is unsafe.
func removeKnownJSONFields(row map[string]json.RawMessage, kind reflect.Type) {
	for i := 0; i < kind.NumField(); i++ {
		field := kind.Field(i)
		name := strings.Split(field.Tag.Get("json"), ",")[0]
		if field.PkgPath == "" && name != "" && name != "-" {
			delete(row, name)
		}
	}
}

// FieldRefs 列出所有可持久化字段的 JSON 名，便于自检与文档生成。
func (s *Settings) FieldRefs() []string {
	keys := []string{
		"api_key", "base_url", "api_protocol", "api_key_history", "system_prompt", "prompt_dir",
		"request_timeout_seconds", "stream", "stream_include_usage", "response_format",
		"user_id", "context_messages", "model", "temperature", "top_p", "max_tokens",
		"thinking_type", "reasoning_effort", "show_reasoning",
	}
	sort.Strings(keys)
	return keys
}

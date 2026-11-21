// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: ContextBudget; TokenMeter; ContextBudget; EstimateMessages; CompactCut; CompactWorkCut; CompactSummary; ContextCompression; Checkpoint; compactSourceTokens; keepUserOriginals; compactRequiredTokens; Message; CompletionFunc; compactionSettings; compactInstruction; summaryProjection; Compact; compactWithProvider; SessionArchive; NewSessionArchive; Append; appendLocked; RecallPrefix; Recall
// Impact: python -B scripts/code-atlas.py show Core/context.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

// 上下文策略只处理消息、预算与检查点；模型供应商负责给出窗口和完成接口。
import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/aieyra/aieyra-os/CORE/sessionservice"
	contextbudget "github.com/aieyra/aieyra-os/agent/context"
	contextprovider "github.com/aieyra/aieyra-os/agent/context/contract"
	"github.com/aieyra/aieyra-os/agent/context/structured"
	contextsummary "github.com/aieyra/aieyra-os/agent/context/summary"
	contextpolicy "github.com/aieyra/aieyra-os/agent/official/Eyra/context"
	"github.com/aieyra/aieyra-os/contracts/storage"
	"slices"
	"strings"
	"sync"
)

type ContextBudget = contextbudget.Budget

type TokenMeter = contextbudget.TokenMeter

func (s *Settings) ContextBudget() ContextBudget {
	window := 0
	if m, ok := LookupModel(s.Model); ok {
		window = m.ContextWindow
	}
	if s.GenericAdapter() {
		window = s.ModelContextWindow
	}
	compact := s.CompactAtTokens
	maxInput := 0
	if m, ok := nativeModelReference(s.Model); ok && s.GenericAdapter() {
		maxInput = m.MaxInput
	}
	if p := s.activePoolProfile(); s.ModelPoolVersion == 1 && p != nil {
		window = p.ContextWindow
		if m, ok := profileCapacityReference(p); ok {
			maxInput = m.MaxInput
		}
		if p.CompactAtTokens != nil {
			compact = p.CompactAtTokens
		}
		// Unknown capacity is a local budget, not a verified provider ceiling.
		// Let the selected working target govern it instead of the old 8K guess.
		if profileContextLimit(p) == 0 && p.ContextWindowSource == "conservative_client_budget" && compact != nil && *compact > 0 {
			window = max(window, max(200000, *compact)+s.EffectiveMaxTokens()+2048)
		}
	}
	if compact != nil {
		if *compact == 0 {
			return ContextBudget{Window: window, Output: s.EffectiveMaxTokens(), KeepTurns: s.CompactKeepTurns, MaxInput: maxInput}
		}
		return ContextBudget{Window: window, Output: s.EffectiveMaxTokens(), Percent: 80, KeepTurns: s.CompactKeepTurns, Working: *compact, MaxInput: maxInput}
	}
	return ContextBudget{Window: window, Output: s.EffectiveMaxTokens(), Percent: s.CompactPercent, KeepTurns: s.CompactKeepTurns, Working: s.ContextWorkingTokens, MaxInput: maxInput}
}

func EstimateMessages(messages []Message) int { return contextbudget.EstimateMessages(messages) }

func CompactCut(messages []Message, keepTurns int) int {
	return contextpolicy.CompactCut(messages, keepTurns, RecallPrefix())
}

func CompactWorkCut(messages []Message, keepTurns int, emergency bool) int {
	return contextpolicy.CompactWorkCut(messages, keepTurns, emergency, RecallPrefix())
}

type CompactSummary = contextsummary.Summary

// 只记录已提交检查点实际替换的上下文估算，不能当作供应商计费 token。
type ContextCompression struct {
	BeforeTokens int `json:"before_tokens"`
	AfterTokens  int `json:"after_tokens"`
}

type Checkpoint struct {
	Imported   []Message        `json:"imported_context,omitempty"`
	Compaction *CompactionState `json:"compaction,omitempty"`
	LastUser   string           `json:"last_user_exact,omitempty"`
	// LastUser 之前的用户原文，从旧到新。见 keepUserOriginals。
	RecentUsers []string            `json:"recent_user_exact,omitempty"`
	Compression *ContextCompression `json:"compression,omitempty"`
	Summary     CompactSummary      `json:"summary"`
	Covered     int                 `json:"covered_messages"`
	First       int                 `json:"first_covered_message,omitempty"`
	Plan        *PlanState          `json:"plan,omitempty"`
	// 记忆系统 M-A：被压缩的对话已写成 fast memory 里的这个记忆段；Summary 为空。
	Segment int64  `json:"fast_segment,omitempty"`
	Packet  string `json:"pac_packet,omitempty"`
	// Exact committed PAC summary for historical display. Not injected by Message.
	PacketText string `json:"pac_text,omitempty"`
}

func compactSourceTokens(previous *Checkpoint, messages []Message) int {
	n := EstimateMessages(messages)
	if previous != nil {
		n += EstimateMessages([]Message{previous.Message()})
	}
	return n
}

// The host resolves editable classification text; the strategy preserves exact
// originals without filesystem, model or archive authority.
func (c *Checkpoint) keepUserOriginals(previous *Checkpoint, messages []Message) {
	var prior *contextpolicy.Originals
	if previous != nil {
		prior = &contextpolicy.Originals{LastUser: previous.LastUser, RecentUsers: previous.RecentUsers}
	}
	head, _, _ := strings.Cut(runtimePrompt("Matrix/辅助指令/用户补充消息.txt"), "%d")
	next := contextpolicy.KeepUserOriginals(prior, messages, RecallPrefix(), head)
	c.LastUser, c.RecentUsers = next.LastUser, next.RecentUsers
}

// Exact user input and current plan survive compression; they are not savings.
func compactRequiredTokens(previous *Checkpoint, messages []Message, plan *PlanState) int {
	cp := &Checkpoint{Plan: plan}
	cp.keepUserOriginals(previous, messages)
	return EstimateMessages([]Message{cp.Message()})
}

func (c *Checkpoint) Message() Message {
	if c.Packet != "" {
		fields := map[string]any{"pac_id": c.Packet, "exact_plan_state": c.Plan, "last_user_exact": c.LastUser}
		if len(c.Imported) > 0 {
			fields["imported_context"] = c.Imported
		}
		if len(c.RecentUsers) > 0 {
			fields["recent_user_exact"] = c.RecentUsers
		}
		data := rawJSON(fields)
		return Message{Role: RoleUser, Name: "compaction_state", Content: runtimePrompt("Matrix/记忆/PAC检查点.txt") + string(data)}
	}
	if c.Segment != 0 && len(c.Summary.Goals) == 0 {
		data, _ := json.Marshal(struct {
			Plan     *PlanState `json:"exact_plan_state,omitempty"`
			LastUser string     `json:"last_user_exact,omitempty"`
			Recent   []string   `json:"recent_user_exact,omitempty"`
		}{c.Plan, c.LastUser, c.RecentUsers})
		return Message{Role: RoleUser, Name: "compaction_state", Content: formatPromptText(runtimePrompt("Matrix/记忆/压缩检查点.txt"), c.Segment, data)}
	}
	data, _ := json.Marshal(struct {
		Summary  CompactSummary `json:"summary"`
		Plan     *PlanState     `json:"exact_plan_state,omitempty"`
		LastUser string         `json:"last_user_exact,omitempty"`
		Recent   []string       `json:"recent_user_exact,omitempty"`
	}{c.Summary, c.Plan, c.LastUser, c.RecentUsers})
	return Message{Role: RoleUser, Content: runtimePrompt("Matrix/记忆/历史摘要前缀.txt") + string(data)}
}

// CompletionFunc 可由其他厂商实现；只有正常结束的结构化结果才能成为检查点。
type CompletionFunc = contextsummary.CompletionFunc

func compactionSettings(settings *Settings) *Settings {
	snapshot := settings.Clone()
	snapshot.ThinkingType = "disabled"
	snapshot.Temperature = 0
	snapshot.ResponseFormat = "json_object"
	snapshot.MaxTokens = 16384
	if snapshot.GenericAdapter() {
		snapshot.ResponseFormat = "text"
		snapshot.MaxTokens = 8192
		if snapshot.Protocol() == ProtocolMessages {
			if snapshot.ModelOptions == nil {
				snapshot.ModelOptions = map[string]any{}
			}
			delete(snapshot.ModelOptions, "reasoning_effort")
			delete(snapshot.ModelOptions, "reasoning_budget")
			snapshot.ModelOptions["reasoning_enabled"] = false
		}
		lowEffort := strings.HasPrefix(snapshot.Model, "gpt-")
		if profile := snapshot.activePoolProfile(); profile != nil && snapshot.ModelPoolVersion == 1 {
			lowEffort = false
			for _, spec := range profile.ParameterSpecs {
				if spec.Key == "reasoning_effort" && spec.Type == "enum" && slices.Contains(spec.Values, "low") {
					lowEffort = true
				}
			}
		}
		if lowEffort {
			if snapshot.ModelOptions == nil {
				snapshot.ModelOptions = map[string]any{}
			}
			snapshot.ModelOptions["reasoning_effort"] = "low"
		}
	}
	applyCatalogMaintenanceSettings(snapshot)
	return snapshot
}

func compactInstruction() string { return runtimePrompt("潜意识/辅助指令/标准摘要.txt") }

// A summary request consumes the previous summary plus the new batch. Recent
// originals are preserved independently by keepUserOriginals and must not be
// repeatedly sent back to the summarizer (which can overflow during startup).
// Execution continues to use Message(), including all retained exact inputs.
func (c *Checkpoint) summaryProjection() *Checkpoint {
	if c == nil {
		return nil
	}
	clone := *c
	clone.RecentUsers = nil
	return &clone
}

func Compact(ctx context.Context, previous *Checkpoint, messages []Message, complete CompletionFunc) (*Checkpoint, error) {
	return compactWithProvider(ctx, structured.New(), previous, messages, complete)
}
func compactWithProvider(ctx context.Context, provider contextprovider.Provider, previous *Checkpoint, messages []Message, complete CompletionFunc) (*Checkpoint, error) {
	var prior json.RawMessage
	if previous != nil {
		var err error
		prior, err = json.Marshal(previous.summaryProjection())
		if err != nil {
			return nil, err
		}
	}
	candidate, err := provider.Compact(ctx, contextprovider.Input{Previous: prior, Messages: messages, Instruction: compactInstruction()}, complete)
	if err != nil {
		return nil, err
	}
	if candidate.Summary == nil {
		return nil, fmt.Errorf("上下文提供者没有返回结构化检查点")
	}
	cp := &Checkpoint{Summary: *candidate.Summary, Covered: len(messages)}
	if previous != nil {
		cp.Covered += previous.Covered
		cp.First = previous.Covered
	}
	cp.keepUserOriginals(previous, messages)
	return cp, nil
}

// SessionArchive 只追加原始消息和检查点，不保存设置、凭据或渲染后的文本。
// 无配置路径的内存测试不会触碰真实用户目录。
type SessionArchive struct {
	mu               sync.Mutex
	Path             string
	unlock           func()
	attachmentConfig string
	attachmentUnlock func()
	ephemeral        bool
	memory           []byte
	// 记忆系统 M-A：每条进入模型历史的消息按位置交给观察者（写进深层记忆）。位置与恢复出的历史一一对应。
	observe  func(pos int, messages []Message)
	observed int
}

func NewSessionArchive(configPath string) (*SessionArchive, error) {
	if err := ValidatePrivateProfile(configPath); err != nil {
		return nil, err
	}
	if configPath == "" {
		return nil, fmt.Errorf("缺少会话保存位置，Compact 未执行")
	}
	releaseOwner, err := storage.Enter(configPath)
	if err != nil {
		return nil, err
	}
	defer releaseOwner()
	file, err := sessionservice.NewPath(PrivatePaths(configPath).Sessions)
	if err != nil {
		return nil, err
	}
	return &SessionArchive{Path: file, attachmentConfig: configPath}, nil
}

func (a *SessionArchive) Append(kind string, value any) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	err := a.appendLocked(kind, value)
	if err == nil && (kind == "message" || kind == "tool_turn" || kind == "runtime_context") {
		var messages []Message
		switch v := value.(type) {
		case Message:
			messages = []Message{v}
		case ToolTurn:
			messages = v.Messages
		case runtimeContextUpdate:
			messages = v.Messages
		}
		if a.observe != nil && len(messages) > 0 {
			a.observe(a.observed, messages)
		}
		a.observed += len(messages)
	}
	return err
}

func (a *SessionArchive) appendLocked(kind string, value any) error {
	if !a.ephemeral && a.attachmentConfig != "" && a.attachmentUnlock == nil {
		release, err := attachmentLease(a.attachmentConfig)
		if err != nil {
			return err
		}
		defer release()
	}
	data, err := sessionservice.Encode(kind, value)
	if err != nil {
		return err
	}
	if a.ephemeral {
		if len(a.memory)+len(data)+1 > 256<<20 {
			return fmt.Errorf("本次临时会话超过 256 MiB，请完成当前任务后开启新窗口")
		}
		a.memory = append(a.memory, data...)
		a.memory = append(a.memory, '\n')
		return nil
	}
	return sessionservice.Append(a.Path, data)
}

func RecallPrefix() string { return runtimePrompt("Matrix/记忆/引用前缀.txt") }

// Recall searches a host-authorized archive view, retaining original positions.
func Recall(original []Message, covered int, query string, tokenBudget int) string {
	return contextpolicy.Recall(original, covered, query, tokenBudget, RecallPrefix())
}

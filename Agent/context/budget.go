// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Agent/context/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: rawJSON; Budget; InputLimit; WorkingLimit; Threshold; CompactionReady; CompactionRetryAfter; AccommodateRequiredInput; EstimateMessages; TokenMeter; Estimate; ObserveRequest; Observe
// Impact: python -B scripts/code-atlas.py show Agent/context/budget.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Package context provides model-independent context budgets and observation.
// It never reads configuration, provider credentials, archives or user files.
package context

import (
	"encoding/json"
	"github.com/aieyra/aieyra-os/contracts/protocol"
	"math"
	"reflect"
)

func rawJSON(v any) json.RawMessage { b, _ := json.Marshal(v); return b }

type Budget struct {
	Window, Output, Percent, KeepTurns int
	Working                            int
	MaxInput                           int
}

func (b Budget) InputLimit() int {
	limit := b.Window - b.Output - 2048
	if b.MaxInput > 0 {
		limit = min(limit, b.MaxInput-2048)
	}
	return max(0, limit)
}
func (b Budget) WorkingLimit() int {
	if b.Working > 0 {
		return min(b.Working, b.InputLimit())
	}
	return b.InputLimit()
}
func (b Budget) Threshold() int {
	if b.Working > 0 {
		return b.WorkingLimit() * b.Percent / 100
	}
	return min(b.InputLimit(), b.Window*b.Percent/100)
}

// A checkpoint is useful only after enough new history has accumulated.
// Keep a bounded cooldown, but allow useful compression near the hard limit.
func (b Budget) CompactionReady(source, required, retryAfter, estimate int) bool {
	return source-required > 2048 && (source > retryAfter || estimate >= b.InputLimit()-2048)
}

func (b Budget) CompactionRetryAfter(source int) int {
	return source + max(4096, min(8192, b.WorkingLimit()/4))
}

// 工作预算是自动压缩目标；不可再压缩的指令/检查点仍应有完成下一步的空间。
// 只调整当前任务的预算，不修改用户配置，始终保留模型输出与协议余量。
func (b Budget) AccommodateRequiredInput(required int) Budget {
	trigger := b.WorkingLimit()
	if b.Percent > 0 && b.Percent < 100 {
		trigger = b.Threshold()
	}
	if b.Working > 0 && required >= trigger && required <= b.InputLimit() {
		reserve := required + 4096
		if b.Percent > 0 && b.Percent < 100 {
			reserve = (reserve*100 + b.Percent - 1) / b.Percent
		}
		b.Working = min(b.InputLimit(), reserve)
	}
	return b
}

// 本地预算采取保守估算；实际 usage 只允许提高校准系数，避免低估陌生文本。
func EstimateMessages(messages []protocol.Message) int {
	n := 3
	for _, m := range messages {
		n += len(m.Images) * 1200 // 图像 token 单独估算，不把 base64 当作文字。
		if len(m.ResponseItems) > 0 || len(m.NativeContent) > 0 {
			// 加密推理是服务端续接凭证，不是base64字符对应的输入token。
			items := make([]json.RawMessage, 0, len(m.ResponseItems))
			for _, raw := range m.ResponseItems {
				var v map[string]any
				if json.Unmarshal(raw, &v) == nil {
					delete(v, "encrypted_content")
					items = append(items, rawJSON(v))
				} else {
					items = append(items, raw)
				}
			}
			m.ResponseItems = items
			m.Content = ""
			m.ReasoningContent = ""
			m.ToolCalls = nil
		}
		data, _ := json.Marshal(m)
		ascii, other := 0, 0
		for _, r := range string(data) {
			if r < 128 {
				ascii++
			} else {
				other++
			}
		}
		n += 8 + (ascii+2)/3 + other
	}
	return n
}

type TokenMeter struct {
	Scale        float64
	Offset       float64
	Prefix       []protocol.Message
	PromptTokens int
}

func (m TokenMeter) Estimate(messages []protocol.Message) int {
	// 缓存前缀已获得服务端精确计数时，只估新增内容，避免长中文会话被提前压缩。
	if m.PromptTokens > 0 && len(messages) >= len(m.Prefix) && reflect.DeepEqual(messages[:len(m.Prefix)], m.Prefix) {
		return int(math.Ceil(float64(m.PromptTokens)*1.03)) + EstimateMessages(messages[len(m.Prefix):]) - 3
	}
	return int(math.Ceil(float64(EstimateMessages(messages))*max(1, m.Scale) + m.Offset))
}

func (m *TokenMeter) ObserveRequest(messages []protocol.Message, actual int) {
	if actual <= 0 {
		return
	}
	m.Observe(EstimateMessages(messages), actual)
	m.Prefix = protocol.CloneMessages(messages)
	m.PromptTokens = actual
}
func (m *TokenMeter) Observe(estimated, actual int) {
	if estimated > 0 && actual > 0 {
		// 中转可能添加固定前缀；不能把它的开销乘到每个新增工具结果上。
		ratio := float64(actual) / float64(estimated) * 1.1
		m.Scale = max(m.Scale, min(2, ratio))
		m.Offset = max(m.Offset, float64(actual)*1.03-float64(estimated)*max(1, m.Scale))
	}
}

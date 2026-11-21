// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: fastMemory; transcriptRow; fastSegment; fastSnapshot; fastKeepTurns; fastMemoryOn; transcriptKey; transcriptRows; readFastMemory; fastWeekdays; fastClock; fastTime; fastSegmentHeading; renderFastMemory; fastMemoryBudget; fastCompactInstruction; fastSegmentText; fastCompactRequest; fastCompactSettings; appendFastSegment
// Impact: python -B scripts/code-atlas.py show Core/workspace_fastmemory.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

// 统一记忆的原文投影与旧格式兼容。当前上下文由 workspace_pac.go 管理，
// Eyra 主动封存；旧 fast memory 读取仅用于迁移和历史兼容，不调度独立潜意识。
import (
	"context"
	"encoding/json"
	"fmt"
	memoryservice "github.com/aieyra/aieyra-os/CORE/memoryservice"
	contextpolicy "github.com/aieyra/aieyra-os/agent/official/Eyra/context"
	"strings"
	"sync"
	"time"
)

type fastMemory struct {
	mu         sync.Mutex
	queue      []transcriptRow
	outbox     []string
	loaded     bool
	writeError string
	running    bool
	drained    chan struct{}
}

type transcriptRow = memoryservice.TranscriptRow

type fastSegment struct {
	ID      int64  `json:"id"`
	Created int64  `json:"created"`
	Content string `json:"content"`
	Source  string `json:"source"`
	FirstAt int64  `json:"first_at"`
	LastAt  int64  `json:"last_at"`
}

type fastSnapshot struct {
	OK       bool          `json:"ok"`
	Version  int64         `json:"version"`
	Pinned   string        `json:"pinned"`
	Segments []fastSegment `json:"segments"`
}

// 压缩后保留的最近轮数（用户定：切点前最近 2 轮留原文）。
const fastKeepTurns = 2

// 统一宿主（OS 与 CLI）的主对话、开着记忆时才走记忆段；子任务、协作分出的工位和旧的分窗口模式不变。
func (w *Workspace) fastMemoryOn(settings *Settings, role string) bool {
	return w != nil && !w.contextMemoryOff.Load() && w.service != nil && w.split == nil && settings != nil && settings.MemoryEnabled && role == WorkspaceMatrix && w.Mode().unified()
}

func (w *Workspace) transcriptKey(agent string) string {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.state.ID + "/" + agent
}

// 检索预览有界；Payload 保存完整脱敏消息，供原文分页回查。
func transcriptRows(key string, pos int, messages []Message, redact func(string) string) []transcriptRow {
	return memoryservice.TranscriptRows(key, pos, messages, redact)
}

func (w *Workspace) readFastMemory(ctx context.Context) (fastSnapshot, error) {
	c, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	var snapshot fastSnapshot
	raw, err := w.memory(c, map[string]any{"action": "fast_snapshot"})
	if err == nil {
		err = json.Unmarshal(raw, &snapshot)
	}
	if err == nil && !snapshot.OK {
		err = fmt.Errorf("fast memory unavailable")
	}
	return snapshot, err
}

var fastWeekdays = [...]string{"日", "一", "二", "三", "四", "五", "六"}

// 记忆里的段和原话都带时间；请求里没有“现在”，模型只能猜过了多久（实测把几分钟前说的“下周三”当成早就过了）。
// 放在请求尾部，不进前缀，不影响缓存。
func fastClock(now time.Time) string {
	now = now.Local()
	return "本机现在是 " + now.Format("2006-01-02 15:04") + "（星期" + fastWeekdays[now.Weekday()] + "）。记忆里的日期和时间以此对照；不用主动提起。"
}

func fastTime(ms int64) string {
	if ms <= 0 {
		return ""
	}
	return time.UnixMilli(ms).Local().Format("2006-01-02 15:04")
}

func fastSegmentHeading(s fastSegment) string {
	head := fmt.Sprintf("【记忆段 #%d", s.ID)
	if from, to := fastTime(s.FirstAt), fastTime(s.LastAt); from != "" {
		if to != "" && to != from {
			if from[:10] == to[:10] {
				to = to[11:]
			}
			from += "–" + to
		}
		head += "｜" + from
	}
	return head + "】"
}

// 渲染是确定的：同一份快照、同一预算，字节完全相同，缓存才能命中。超出预算时从最旧的段开始不放进来（原文仍在库里）。
func renderFastMemory(s fastSnapshot, budgetTokens int) string {
	pinned := strings.TrimSpace(s.Pinned)
	if pinned == "" && len(s.Segments) == 0 {
		return ""
	}
	head := runtimePrompt("Matrix/记忆/旧记忆前缀.txt")
	used := EstimateMessages([]Message{{Role: RoleUser, Content: head + pinned}})
	parts := []string{}
	for i := len(s.Segments) - 1; i >= 0; i-- {
		block := fastSegmentHeading(s.Segments[i]) + "\n" + strings.TrimSpace(s.Segments[i].Content)
		cost := EstimateMessages([]Message{{Role: RoleUser, Content: block}})
		if budgetTokens > 0 && used+cost > budgetTokens && len(parts) > 0 {
			break
		}
		used += cost
		parts = append([]string{block}, parts...)
	}
	out := []string{head}
	if pinned != "" {
		out = append(out, "【要点】\n"+pinned)
	}
	return strings.Join(append(out, parts...), "\n\n")
}

// fast memory 的上限：开始压缩位置的 10%（用户定），至少 4K。
func fastMemoryBudget(budget ContextBudget) int {
	return max(4096, budget.Threshold()/10)
}

func fastCompactInstruction() string { return runtimePrompt("Matrix/记忆/本轮压缩.txt") }

func fastSegmentText(answer Message) (string, error) { return contextpolicy.SegmentText(answer) }

func fastCompactRequest(prefix []Message) []Message {
	return contextpolicy.CompactRequest(prefix, fastCompactInstruction())
}

// 维护请求：沿用主意识的模型与参数（换参数会让部分供应商的缓存失效），只限制输出长度。
func fastCompactSettings(settings *Settings) *Settings {
	s := settings.Clone()
	if s.MaxTokens <= 0 || s.MaxTokens > 8192 {
		s.MaxTokens = 8192
	}
	// 和维护请求同一条上限（model_catalog_maintenance.go）：不超过窗口的四分之一和档案的输出上限；
	// 思考参数不动，保持和对话同一个前缀。
	if p := s.activePoolProfile(); p != nil && s.ModelPoolVersion == 1 {
		limit := max(1, p.ContextWindow/4)
		if p.OutputLimit > 0 {
			limit = min(limit, p.OutputLimit)
		}
		s.MaxTokens = min(s.MaxTokens, limit)
	}
	return s
}

func (w *Workspace) appendFastSegment(ctx context.Context, key, content string, first, last int, source string) (int64, error) {
	c, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	raw, err := w.memory(c, map[string]any{"action": "fast_append", "key": key, "content": content, "first_pos": first, "last_pos": last, "source": source})
	if err != nil {
		return 0, err
	}
	var result struct {
		OK    bool   `json:"ok"`
		ID    int64  `json:"id"`
		Error string `json:"error"`
	}
	if err = json.Unmarshal(raw, &result); err != nil {
		return 0, err
	}
	if !result.OK {
		return 0, fmt.Errorf("记忆段未写入：%s", result.Error)
	}
	return result.ID, nil
}

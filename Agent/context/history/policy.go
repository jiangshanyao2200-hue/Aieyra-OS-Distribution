// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Agent/context/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: RecentUserLimit; Originals; isRecall; IsUserOriginal; CompactCut; CompactWorkCut; KeepUserOriginals; Recall
// Impact: python -B scripts/code-atlas.py show Agent/context/history/policy.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Package history provides lossless original retention and complete tool boundaries.
// Hosts supply immutable message views and prompt text and own every commit.
package history

import (
	"bytes"
	"fmt"
	contextbudget "github.com/aieyra/aieyra-os/agent/context"
	"github.com/aieyra/aieyra-os/contracts/protocol"
	"sort"
	"strings"
	"unicode"
)

const RecentUserLimit = 100

type Originals struct {
	LastUser    string
	RecentUsers []string
}

// An intentionally blank editable marker cannot identify generated recalls.
func isRecall(text, prefix string) bool { return prefix != "" && strings.HasPrefix(text, prefix) }

func IsUserOriginal(m protocol.Message, supplementPrefix string) bool {
	return !m.ContextObservation && (m.Name == "" || strings.HasPrefix(m.Name, "workspace_") && supplementPrefix != "" && strings.HasPrefix(m.Content, supplementPrefix))
}

// CompactCut 只在完整 user 轮次之间切分，不拆开工具调用及其结果。
// 最近的完整轮次连同正在等待回复的用户消息保留原文。
func CompactCut(messages []protocol.Message, keepTurns int, recallPrefix string) int {
	var starts []int
	pending := map[string]bool{}
	for i, m := range messages {
		if m.Role == protocol.RoleUser && !m.ContextObservation && len(pending) == 0 && !isRecall(m.Content, recallPrefix) {
			start := i
			for start > 0 && isRecall(messages[start-1].Content, recallPrefix) {
				start--
			}
			starts = append(starts, start)
		}
		for _, call := range m.ToolCalls {
			pending[call.ID] = true
		}
		if m.Role == "tool" {
			delete(pending, m.ToolCallID)
		}
	}
	if len(starts) <= max(1, keepTurns) {
		return 0
	}
	return starts[len(starts)-max(1, keepTurns)]
}

// 单轮长任务允许在已完整执行的工具批次后压缩，绝不拆开调用与结果。
// 最新用户要求由检查点另存原文，压缩后可以继续同一轮。
func CompactWorkCut(messages []protocol.Message, keepTurns int, emergency bool, recallPrefix string) int {
	if cut := CompactCut(messages, keepTurns, recallPrefix); cut > 0 && !emergency {
		return cut
	}
	pending := map[string]bool{}
	var boundaries []int
	for i, m := range messages {
		for _, c := range m.ToolCalls {
			if c.ID != "" {
				pending[c.ID] = true
			}
		}
		if m.Role == protocol.RoleTool {
			delete(pending, m.ToolCallID)
		}
		if len(pending) == 0 && (m.Role == protocol.RoleTool || m.Role == protocol.RoleAssistant) {
			boundaries = append(boundaries, i+1)
		}
	}
	if len(boundaries) == 0 {
		return 0
	}
	if !emergency && len(boundaries) > 1 {
		return boundaries[len(boundaries)-2]
	}
	return boundaries[len(boundaries)-1]
}

func KeepUserOriginals(previous *Originals, messages []protocol.Message, recallPrefix, supplementPrefix string) Originals {
	c := Originals{}
	var users []string
	if previous != nil {
		users = append(users, previous.RecentUsers...)
		if previous.LastUser != "" {
			users = append(users, previous.LastUser)
		}
		c.LastUser = previous.LastUser
	}
	for _, m := range messages {
		if m.Role != protocol.RoleUser || isRecall(m.Content, recallPrefix) {
			continue
		}
		if !IsUserOriginal(m, supplementPrefix) {
			continue
		}
		c.LastUser = m.Content
		if strings.TrimSpace(m.Content) != "" {
			users = append(users, m.Content)
		}
	}
	// 最新一条在 LastUser 里，不重复放。
	if n := len(users); n > 0 && users[n-1] == c.LastUser {
		users = users[:n-1]
	}
	if len(users) > RecentUserLimit-1 {
		users = users[len(users)-(RecentUserLimit-1):]
	}
	c.RecentUsers = append([]string(nil), users...)
	if len(c.RecentUsers) == 0 {
		c.RecentUsers = nil
	}
	return c
}

// Recall 从被压缩的原文查找相关段落。只将实际取出的内容注入请求，
// 不把本地路径冒充模型已能读取的工具；摘录作为不可信引用并保持原文。
func Recall(original []protocol.Message, covered int, query string, tokenBudget int, recallPrefix string) string {
	terms := map[string]bool{}
	for _, word := range strings.FieldsFunc(strings.ToLower(query), func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsNumber(r) && r != '_' && r != '/' && r != '.'
	}) {
		runes := []rune(word)
		if len(runes) < 2 {
			continue
		}
		terms[word] = true
		if len(runes) > 2 && runes[0] > 127 {
			for i := 0; i+2 <= len(runes); i++ {
				terms[string(runes[i:i+2])] = true
			}
		}
	}
	type candidate struct {
		index, score int
		text         string
	}
	var found []candidate
	for i, m := range original[:max(0, min(covered, len(original)))] {
		if isRecall(m.Content, recallPrefix) {
			continue // 避免反复检索以前生成的引用而放大上下文。
		}
		paragraphs := strings.Split(m.Content, "\n\n")
		for _, paragraph := range paragraphs {
			// 超长段落拆成有上下文的原文片段，防止一大段日志挤掉所有关键细节。
			pieces := []string{paragraph}
			if contextbudget.EstimateMessages([]protocol.Message{{Content: paragraph}}) > tokenBudget/2 {
				pieces = nil
				runes := []rune(paragraph)
				size := max(64, tokenBudget/3)
				for start := 0; start < len(runes); start += size {
					pieces = append(pieces, "[长段落的局部原文]\n"+string(runes[max(0, start-64):min(len(runes), start+size+64)]))
				}
			}
			for _, paragraph := range pieces {
				lower := strings.ToLower(paragraph)
				score := 0
				for term := range terms {
					if strings.Contains(lower, term) {
						score++
					}
				}
				if score > 0 {
					found = append(found, candidate{i, score, paragraph})
				}
			}
		}
	}
	sort.SliceStable(found, func(i, j int) bool { return found[i].score > found[j].score })
	var out bytes.Buffer
	used := 0
	for _, item := range found {
		entry := fmt.Sprintf("\n[原始消息 %d / %s]\n%s\n", item.index+1, original[item.index].Role, item.text)
		n := contextbudget.EstimateMessages([]protocol.Message{{Content: entry}})
		if used+n > tokenBudget {
			continue
		}
		out.WriteString(entry)
		used += n
		if used >= tokenBudget {
			break
		}
	}
	return out.String()
}

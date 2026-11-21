package contextpolicy

import (
	"encoding/json"
	"fmt"
	contextbudget "github.com/aieyra/aieyra-os/agent/context"
	"github.com/aieyra/aieyra-os/contracts/protocol"
	"strings"
	"unicode/utf8"
)

func rawJSON(v any) json.RawMessage { b, _ := json.Marshal(v); return b }
func utf8Prefix(s string, n int) string {
	if n >= len(s) {
		return s
	}
	for n > 0 && !utf8.RuneStart(s[n]) {
		n--
	}
	return s[:n]
}

type Packet struct {
	ID       string `json:"id"`
	Scope    string `json:"scope"`
	Title    string `json:"title"`
	Content  string `json:"content"`
	Keywords string `json:"keywords"`
	FirstAt  string `json:"first_at"`
	LastAt   string `json:"last_at"`
	Level    int    `json:"level"`
}

func RenderPackets(packets []Packet, hasMore bool, budget int, header string) string {
	if len(packets) == 0 && !hasMore {
		return ""
	}
	// Keep every returned ID discoverable even when older summaries do not fit.
	index := make([]string, len(packets))
	for i, p := range packets {
		index[i] = fmt.Sprintf("%s | %s | %s–%s | %s", p.ID, utf8Prefix(p.Title, 80), p.FirstAt, p.LastAt, utf8Prefix(p.Keywords, 80))
	}
	if hasMore {
		index = append(index, "目录还有更早的PAC，memory packets 可分页查找。")
	}
	out := header + "\n" + strings.Join(index, "\n")
	used := contextbudget.EstimateMessages([]protocol.Message{{Role: protocol.RoleUser, Content: out}})
	parts := []string{}
	checkpoints := 0
	for i := len(packets) - 1; i >= 0; i-- {
		p := packets[i]
		if strings.TrimSpace(p.Title) == "工作上下文检查点" {
			checkpoints++
			if checkpoints > 2 {
				continue
			}
		}
		body := p.ID + "\n" + p.Content
		cost := contextbudget.EstimateMessages([]protocol.Message{{Role: protocol.RoleUser, Content: body}})
		if budget > 0 && used+cost > budget {
			continue
		}
		used += cost
		parts = append([]string{body}, parts...)
	}
	return out + "\n\n" + strings.Join(parts, "\n\n")
}

func RenderProfile(profile []json.RawMessage, hasMore bool, prefix string) string {
	if len(profile) == 0 && !hasMore {
		return ""
	}
	records := []json.RawMessage{}
	used := 0
	for _, r := range profile {
		cost := contextbudget.EstimateMessages([]protocol.Message{{Role: protocol.RoleUser, Content: string(r)}})
		if used+cost > 5000 {
			break
		}
		used += cost
		records = append(records, r)
	}
	return prefix + string(rawJSON(map[string]any{"records": records, "has_more": hasMore || len(records) < len(profile)}))
}

func CompleteRange(messages []protocol.Message) bool {
	pending := map[string]bool{}
	for _, m := range messages {
		if len(pending) > 0 && m.Role != protocol.RoleTool {
			return false
		}
		for _, c := range m.ToolCalls {
			if c.ID == "" || pending[c.ID] {
				return false
			}
			pending[c.ID] = true
		}
		if m.Role == protocol.RoleTool {
			if !pending[m.ToolCallID] {
				return false
			}
			delete(pending, m.ToolCallID)
		}
	}
	return len(pending) == 0
}

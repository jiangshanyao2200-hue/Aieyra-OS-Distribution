// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/memoryservice/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TranscriptRow; TranscriptRows; utf8Prefix
// Impact: python -B scripts/code-atlas.py show Core/memoryservice/transcript.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package memory

import (
	"fmt"
	"github.com/aieyra/aieyra-os/contracts/protocol"
	"strings"
	"time"
	"unicode/utf8"
)

type TranscriptRow struct {
	Key       string `json:"key"`
	Pos       int    `json:"pos"`
	At        int64  `json:"at"`
	Role      string `json:"role"`
	Name      string `json:"name,omitempty"`
	Content   string `json:"content"`
	Payload   string `json:"payload,omitempty"`
	Truncated bool   `json:"truncated,omitempty"`
}

func TranscriptRows(key string, pos int, messages []protocol.Message, redact func(string) string) []TranscriptRow {
	now := time.Now().UnixMilli()
	rows := make([]TranscriptRow, 0, len(messages))
	for i, m := range messages {
		row := TranscriptRow{Key: key, Pos: pos + i, At: now, Role: m.Role, Name: m.Name}
		if m.ContextObservation {
			// Preserve the exact payload and position for PAC coverage while
			// identifying host state as a system record, never user speech.
			row.Role = "system"
		}
		row.Payload = string(rawJSON(m))
		if redact != nil {
			row.Payload = redact(row.Payload)
		}
		content := m.Content
		switch m.Role {
		case RoleUser:
			if len(m.Images) > 0 {
				content += fmt.Sprintf("\n[附图 %d 张]", len(m.Images))
			}
		case RoleAssistant:
			for _, call := range m.ToolCalls {
				content += "\n→ 调用 " + call.Function.Name + "：" + utf8Prefix(call.Function.Arguments, 600)
			}
		case RoleTool:
			row.Name = m.ToolCallID
			if utf8.RuneCountInString(content) > 2400 {
				runes := []rune(content)
				content = string(runes[:1600]) + fmt.Sprintf("\n…（中间省略 %d 字）…\n", len(runes)-2200) + string(runes[len(runes)-600:])
				row.Truncated = true
			}
		}
		if redact != nil {
			content = redact(content)
		}
		row.Content = strings.TrimSpace(content)
		rows = append(rows, row)
	}
	return rows
}

func utf8Prefix(s string, n int) string {
	if n >= len(s) {
		return s
	}
	for n > 0 && !utf8.RuneStart(s[n]) {
		n--
	}
	return s[:n]
}

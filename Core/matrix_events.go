// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: events
// Impact: python -B scripts/code-atlas.py show Core/matrix_events.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"os"
)

// 使用已持久的会话收据，不再复制一份可能分歧的事件日志。
// cursor 是行边界的字节位置；半条尾记录留到下次读，不触发恢复或重放。
func (m *AgentManager) events(path string, cursor int64, limit int) (any, error) {
	if cursor < 0 || limit < 0 || limit > 100 {
		return nil, fmt.Errorf("invalid event cursor or limit (1..100)")
	}
	if limit == 0 {
		limit = 20
	}
	rows := []json.RawMessage{}
	f, err := os.Open(path)
	if os.IsNotExist(err) && cursor == 0 {
		return map[string]any{"events": rows, "next_cursor": cursor, "has_more": false}, nil
	}
	if err != nil {
		return nil, err
	}
	defer f.Close()
	stat, err := f.Stat()
	if err != nil {
		return nil, err
	}
	if cursor > stat.Size() {
		return nil, fmt.Errorf("cursor is beyond the archive")
	}
	if cursor > 0 {
		var b [1]byte
		if _, err = f.ReadAt(b[:], cursor-1); err != nil || b[0] != '\n' {
			return nil, fmt.Errorf("cursor must be an event boundary")
		}
	}
	if _, err = f.Seek(cursor, io.SeekStart); err != nil {
		return nil, err
	}
	reader := bufio.NewReader(io.LimitReader(f, stat.Size()-cursor))
	bytes := 0
	for len(rows) < limit && bytes < 256<<10 {
		line, readErr := reader.ReadBytes('\n')
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			return nil, readErr
		}
		if len(line) > 8<<20 || !json.Valid(line) {
			return nil, fmt.Errorf("invalid or oversized archive event")
		}
		if bytes > 0 && bytes+len(line) > 256<<10 {
			break
		}
		clean := json.RawMessage(m.redact(string(line)))
		if !json.Valid(clean) {
			return nil, fmt.Errorf("event redaction failed")
		}
		rows = append(rows, clean)
		cursor += int64(len(line))
		bytes += len(line)
	}
	return map[string]any{"events": rows, "next_cursor": cursor, "has_more": cursor < stat.Size()}, nil
}

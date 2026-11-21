// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: memoryContract; MemoryToolDefinition; archiveMemoryKey; ephemeralArchiveKey; recallArchive; memory; memorySurface; memorySettingsContract; rememberEpisode
// Impact: python -B scripts/code-atlas.py show Core/workspace_memory.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

func memoryContract() string {
	return strings.TrimSpace(runtimePrompt("Matrix/记忆/使用约定.txt"))
}

func MemoryToolDefinition() ToolDefinition {
	return ToolDefinition{Type: "function", Name: "memory", Description: runtimePrompt("Matrix/工具说明/永久记忆.txt"), Parameters: schemaObject(map[string]any{
		"action": schemaEnum("record", "search", "read", "update", "forget", "plans", "status", "recall", "seal", "merge", "packets", "packet", "original", "snapshot", "history", "lookup", "context_clean", "context_status", "compact", "compact_status"), "purpose": schemaEnum("memory_edit"), "key": schemaString(), "position": map[string]any{"type": "integer", "minimum": 0}, "keywords": schemaString(), "children": schemaStrings(), "expected_version": map[string]any{"type": "integer"}, "offset": map[string]any{"type": "integer", "minimum": 0}, "limit_chars": map[string]any{"type": "integer", "minimum": 256, "maximum": 8000}, "id": schemaString(), "title": schemaString(), "content": schemaString(), "source": schemaString(), "source_role": map[string]any{"type": "string", "enum": []string{"user", "assistant", "tool"}, "description": "history/lookup的原文来源筛选；省略则不筛选，不影响records或packets"}, "query": schemaString(), "cursor": schemaString(), "request_id": schemaString(), "scope": schemaEnum("global", "project"), "kind": schemaEnum("fact", "preference", "decision", "episode", "summary", "plan"), "status": schemaEnum("active", "done", "paused", "cancelled"), "due_at": schemaString(), "limit": map[string]any{"type": "integer", "minimum": 1, "maximum": 20}, "history": map[string]any{"type": "boolean"}, "expected_revision": map[string]any{"type": "integer", "minimum": 1}}, "action")}
}

type archiveMemoryKey struct{}
type ephemeralArchiveKey struct{}

// 原文按字节游标从尾部向前读，单次最多256KiB；档案再大也不全量读取。
func recallArchive(ctx context.Context, a map[string]any) any {
	var reader io.ReaderAt
	var end int64
	if archive, ok := ctx.Value(ephemeralArchiveKey{}).(*SessionArchive); ok {
		archive.mu.Lock()
		defer archive.mu.Unlock()
		reader = bytes.NewReader(archive.memory)
		end = int64(len(archive.memory))
	} else {
		file, _ := ctx.Value(archiveMemoryKey{}).(string)
		f, e := os.Open(file)
		if e != nil {
			return map[string]any{"ok": false, "error": "当前原始档案不可用"}
		}
		defer f.Close()
		info, e := f.Stat()
		if e != nil {
			return map[string]any{"ok": false, "error": "无法读取档案状态"}
		}
		reader, end = f, info.Size()
	}
	if cursor, ok := a["cursor"].(string); ok && cursor != "" {
		n, e := strconv.ParseInt(cursor, 10, 64)
		if e != nil || n < 0 || n > end {
			return map[string]any{"ok": false, "error": "原文游标无效"}
		}
		end = n
	}
	start := max(int64(0), end-256*1024)
	data := make([]byte, end-start)
	n, e := reader.ReadAt(data, start)
	if e != nil && n == 0 {
		return map[string]any{"ok": false, "error": "读取档案失败"}
	}
	data = data[:n]
	text := string(data)
	if start > 0 {
		if i := strings.IndexByte(text, '\n'); i >= 0 {
			start += int64(i + 1)
			text = text[i+1:]
		} else {
			return map[string]any{"ok": true, "records": []any{}, "next_cursor": strconv.FormatInt(start, 10), "notice": "此区间属于超长原文行，继续前页或用Shell分段读取原档案"}
		}
	}
	query, _ := a["query"].(string)
	query = strings.ToLower(query)
	limit := 8
	if v, ok := a["limit"].(float64); ok {
		limit = min(20, max(1, int(v)))
	}
	lines := strings.Split(text, "\n")
	out := []map[string]any{}
	used := 0
	next := start
	pos := end
	for i := len(lines) - 1; i >= 0; i-- {
		line := lines[i]
		pos -= int64(len(line) + 1)
		var item struct {
			Kind  string  `json:"kind"`
			Value Message `json:"value"`
			At    string  `json:"at"`
		}
		if json.Unmarshal([]byte(line), &item) != nil || item.Kind != "message" {
			continue
		}
		content := item.Value.Content
		at := strings.Index(strings.ToLower(content), query)
		if at < 0 || content == "" {
			continue
		}
		lo := max(0, at-300)
		for lo > 0 && !utf8.RuneStart(content[lo]) {
			lo--
		}
		piece := utf8Prefix(content[lo:], 1800)
		used += len(piece)
		out = append(out, map[string]any{"role": item.Value.Role, "at": item.At, "excerpt": piece, "truncated": lo > 0 || len(piece) < len(content)})
		if len(out) >= limit || used > 8000 {
			next = max(start, pos+1)
			break
		}
	}
	var cursor any
	if next > 0 {
		cursor = strconv.FormatInt(next, 10)
	}
	return map[string]any{"ok": true, "records": out, "next_cursor": cursor, "scanned_bytes": n, "notice": runtimePrompt("Matrix/记忆/原文回查说明.txt")}
}

func (w *Workspace) memory(ctx context.Context, a map[string]any) (json.RawMessage, error) {
	if w.service == nil {
		return nil, fmt.Errorf("memory service unavailable")
	}
	w.mu.Lock()
	session, workdir := w.state.ID, w.state.Workdir
	w.mu.Unlock()
	args := make(map[string]any, len(a)+1)
	for k, v := range a {
		args[k] = v
	}
	args["_project"] = w.memoryProject(workdir)
	return w.service.CallTool(ctx, "memory", session, rawJSON(args))
}

func (w *Workspace) memorySurface(ctx context.Context, query ...string) string {
	c, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	q := ""
	if len(query) > 0 {
		q = utf8Prefix(query[0], 256)
	}
	raw, e := w.memory(c, map[string]any{"action": "surface", "query": q})
	if e != nil {
		return ""
	}
	var r struct {
		OK      bool              `json:"ok"`
		Records []json.RawMessage `json:"records"`
	}
	if json.Unmarshal(raw, &r) != nil || !r.OK || len(r.Records) == 0 {
		return ""
	}
	return string(raw)
}

func memorySettingsContract() string { return runtimePrompt("Matrix/记忆/配置说明.txt") }

func (w *Workspace) rememberEpisode(ctx context.Context, request, title, content string) {
	c, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	if w.Mode().unified() {
		// Unified hosts commit semantic continuity with an epoch/version fence.
		// Never fall back to an unfenced episode merge after a correction/forget.
		return
	}
	_, _ = w.memory(c, map[string]any{"action": "record", "kind": "episode", "title": utf8Prefix(title, 120), "content": utf8Prefix(content, 10000), "source": "会话自动摘要；用户原话与助手自述分开，结果需以原记录核验", "request_id": request})
}

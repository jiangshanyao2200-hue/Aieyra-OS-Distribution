// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: memoryHistoryEnabled; memoryHistory; historyPageMemory; memoryHistoryRow; projectMemoryRows; historySupplementText; memoryHistoryOriginal
// Impact: python -B scripts/code-atlas.py show Core/workspace_memory_history.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

func (w *Workspace) memoryHistoryEnabled() bool {
	if w.service == nil || !w.Mode().unified() || w.split != nil {
		return false
	}
	w.mu.Lock()
	managed := w.contextSessionLocked() != nil
	w.mu.Unlock()
	// A managed conversation has its own complete archive. Project transcripts
	// also contain other conversations and previous runtime owners of this one.
	if managed {
		return false
	}
	settings, err := Load(w.config)
	return err == nil && settings.MemoryEnabled
}
func (w *Workspace) memoryHistory(before string, limit int) ([]historyEntry, error) {
	if !w.memoryHistoryEnabled() {
		return nil, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	data, err := w.memory(ctx, map[string]any{"action": "transcript_history", "exclude_prefix": w.state.ID + "/", "before": before, "limit": limit})
	if err != nil {
		return nil, err
	}
	var result struct{ Rows []memoryHistoryRow }
	if err = json.Unmarshal(data, &result); err != nil {
		return nil, err
	}
	return projectMemoryRows(result.Rows), nil
}

// The archive service uses an exclusive cursor and caps each response at 51
// records. A numbered view needs only its window plus lookahead for the pager.
func (w *Workspace) historyPageMemory(page int, query string) ([]historyEntry, error) {
	if !w.memoryHistoryEnabled() {
		return nil, nil
	}
	var rows []historyEntry
	before, needle := "", strings.ToLower(query)
	matched, turns := false, 0
	for {
		batch, err := w.memoryHistory(before, 51)
		if err != nil || len(batch) == 0 {
			return rows, err
		}
		for _, row := range batch {
			rows = append(rows, row)
			matched = matched || needle == "" || strings.Contains(strings.ToLower(w.manager.redact(row.Text)), needle)
			if row.Title == RoleUser {
				if matched {
					turns++
				}
				matched = false
				if turns >= (page+5)*historyTurnsPerPage {
					return rows, nil
				}
			}
		}
		next := historyKey(batch[len(batch)-1])
		if next == before {
			return rows, fmt.Errorf("历史记录游标未推进")
		}
		before = next
	}
}

type memoryHistoryRow struct {
	Session             string
	Pos, At             int64
	Role, Name, Content string
	Truncated           int
}

// projectMemoryRows turns newest-first transcript rows into history entries.
// A delivered-files note is newer than the reply it belongs to; it is attached
// to the next older assistant row of the same launch, or shown alone.
func projectMemoryRows(in []memoryHistoryRow) []historyEntry {
	rows := make([]historyEntry, 0, len(in))
	var files []WorkspaceArtifact
	var note memoryHistoryRow
	flush := func() {
		if len(files) > 0 {
			rows = append(rows, historyEntry{ID: fmt.Sprintf("memory:%s:%012d", note.Session, note.Pos), Kind: "message", At: time.UnixMilli(note.At).UTC().Format(time.RFC3339Nano), Title: RoleAssistant, Role: WorkspaceMatrix, Artifacts: files})
		}
		files = nil
	}
	launch := func(session string) string { l, _, _ := strings.Cut(session, "/"); return l }
	for _, r := range in {
		if found, ok := artifactNoteFiles(r.Role, r.Name, r.Content); ok {
			flush()
			files, note = found, r
			continue
		}
		var attach []WorkspaceArtifact
		if len(files) > 0 {
			if r.Role == RoleAssistant && launch(r.Session) == launch(note.Session) {
				attach, files = files, nil
			} else {
				flush()
			}
		}
		text := historySupplementText(r.Role, r.Name, r.Content)
		var images []ComposerAttachment
		if r.Role == RoleUser {
			images = historyImageAttachments(r.Content)
		}
		rows = append(rows, historyEntry{ID: fmt.Sprintf("memory:%s:%012d", r.Session, r.Pos), Kind: "message", At: time.UnixMilli(r.At).UTC().Format(time.RFC3339Nano), Title: r.Role, Role: WorkspaceMatrix, Text: text, TextMore: text != r.Content, Truncated: r.Truncated != 0, Artifacts: attach, Attachments: images})
	}
	flush()
	return rows
}

// The model receives routing instructions around queued supplements. The chat
// shows their body; the exact stored input remains available in its receipt.
// Only recognized host-authored wrappers are projected, never arbitrary user text.
func historySupplementText(role, name, content string) string {
	if role == RoleAssistant {
		shown, _ := historyAssistantDisplay(content)
		return shown
	}
	if role == RoleUser && !strings.HasPrefix(content, "【你工作时用户补充了 ") {
		shown, _ := historyUserDisplay(content)
		return shown
	}
	if role != RoleUser || !strings.HasPrefix(name, "workspace_") || !strings.HasPrefix(content, "【你工作时用户补充了 ") {
		return content
	}
	if start := strings.Index(content, "\n1. "); start >= 0 {
		body := content[start+1:]
		if strings.HasPrefix(content, "【你工作时用户补充了 1 条】") {
			body, _ = askAnswerDisplay(strings.TrimPrefix(body, "1. "))
		}
		return body
	}
	return content
}
func (w *Workspace) memoryHistoryOriginal(id string) (string, bool, error) {
	if !w.memoryHistoryEnabled() {
		return "", false, fmt.Errorf("历史记忆当前未启用")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	data, err := w.memory(ctx, map[string]any{"action": "transcript_history_original", "entry_id": id})
	if err != nil {
		return "", false, err
	}
	var result struct {
		Row struct {
			Content   string
			Truncated int
		}
	}
	if err = json.Unmarshal(data, &result); err != nil {
		return "", false, err
	}
	return result.Row.Content, result.Row.Truncated != 0, nil
}

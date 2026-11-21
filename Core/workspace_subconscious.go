// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: subActivity; subDiary; subconscious; subconsciousView; diaryAction; isSubconsciousTool; filterSubconsciousTools
// Impact: python -B scripts/code-atlas.py show Core/workspace_subconscious.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

// Retired maintenance keeps only its snapshot and old shared-diary read
// contract. Current context compaction belongs to PAC; no background model,
// diary/dream generation or maintenance queue is started here.
import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
)

type subActivity struct {
	MessageID string   `json:"message_id"`
	Phase     string   `json:"phase,omitempty"`
	Thought   string   `json:"thought,omitempty"`
	Body      string   `json:"body,omitempty"`
	Summary   string   `json:"summary,omitempty"`
	Tool      string   `json:"tool,omitempty"`
	ID        int64    `json:"id"`
	Kind      string   `json:"kind"`  // compact | digest | organize | ask | dream
	Actor     string   `json:"actor"` // subconscious | eyra
	State     string   `json:"state"` // running | done | failed
	Waiting   bool     `json:"waiting,omitempty"`
	Title     string   `json:"title"`
	Steps     []string `json:"steps"`
	Started   int64    `json:"started"`
	Finished  int64    `json:"finished,omitempty"`
}

type subDiary struct {
	ID      int64  `json:"id"`
	Title   string `json:"title"`
	Created int64  `json:"created"`
}

type subconscious struct {
	mu         sync.Mutex
	revision   int64
	activities []subActivity
	diary      *subDiary
}

func (w *Workspace) subconsciousView() map[string]any {
	s := &w.sub
	s.mu.Lock()
	list := make([]subActivity, len(s.activities))
	for i, a := range s.activities {
		a.Steps = append([]string{}, a.Steps...)
		list[i] = a
	}
	view := map[string]any{"revision": s.revision, "activities": list, "retired": true}
	if s.diary != nil {
		d := *s.diary
		view["diary"] = d
	}
	s.mu.Unlock()
	// One settings read per snapshot, outside the streaming lock.
	if w.manager != nil {
		keys, _ := w.manager.redactionSecrets()
		for i := range list {
			a := &list[i]
			for _, key := range keys {
				a.Thought = strings.ReplaceAll(a.Thought, key, "[redacted]")
				a.Body = strings.ReplaceAll(a.Body, key, "[redacted]")
				a.Summary = strings.ReplaceAll(a.Summary, key, "[redacted]")
				a.Title = strings.ReplaceAll(a.Title, key, "[redacted]")
				a.Tool = strings.ReplaceAll(a.Tool, key, "[redacted]")
				for j := range a.Steps {
					a.Steps[j] = strings.ReplaceAll(a.Steps[j], key, "[redacted]")
				}
			}
		}
	}
	return view
}

func (w *Workspace) diaryAction(ctx context.Context, args json.RawMessage) (any, error) {
	// diary_id：工作区通用参数里的 id 是字符串（文档、回执），这里另起一个名字。
	var p struct {
		Action string `json:"action"`
		ID     int64  `json:"diary_id"`
	}
	if err := json.Unmarshal(args, &p); err != nil {
		return nil, err
	}
	w.sub.mu.Lock()
	waiting := w.sub.diary
	w.sub.mu.Unlock()
	if waiting == nil || waiting.ID != p.ID {
		return map[string]any{"ok": false, "error": "这篇日记没有在等你看"}, nil
	}
	switch p.Action {
	case "read":
		raw, err := w.memory(ctx, map[string]any{"action": "diary_read", "id": p.ID})
		if err != nil {
			return nil, err
		}
		return json.RawMessage(raw), nil
	case "done":
		if _, err := w.memory(ctx, map[string]any{"action": "diary_mark", "id": p.ID, "mark": "read"}); err != nil {
			return nil, err
		}
		w.sub.mu.Lock()
		w.sub.diary = nil
		w.sub.revision++
		w.sub.mu.Unlock()
		return map[string]any{"ok": true}, nil
	}
	return nil, fmt.Errorf("diary action: read/done")
}

func isSubconsciousTool(name string) bool { return name == "ask_subconscious" || name == "share_diary" }

func filterSubconsciousTools(definitions []ToolDefinition, _, _ bool) []ToolDefinition {
	out := definitions[:0:0]
	for _, d := range definitions {
		if isSubconsciousTool(d.Name) {
			continue
		}
		out = append(out, d)
	}
	return out
}

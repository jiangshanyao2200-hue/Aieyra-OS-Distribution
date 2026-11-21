// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestHistorySearchFindsMessagesNewestFirstAndPages
// Impact: python -B scripts/code-atlas.py show Core/workspace_history_search_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"fmt"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestHistorySearchFindsMessagesNewestFirstAndPages(t *testing.T) {
	var calls atomic.Int32
	m, dir := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
		n := calls.Add(1)
		fixtureAnswer(w, fmt.Sprintf("search-history-%d", n), fmt.Sprintf("回复编号%d", n), nil)
	})
	w := modeWorkspace(t, m.config, dir, HostOS)
	contextTestAction(t, w, "new", nil)
	inputs := []string{"苹果 Alpha 第一条", "香蕉第二条", "APPLE alpha 第三条", "橙子第四条"}
	for n, text := range inputs {
		request := fmt.Sprintf("search-%d", n)
		if _, err := w.controlSend(request, text); err != nil {
			t.Fatal(err)
		}
		deadline := time.Now().Add(10 * time.Second)
		for done := false; !done; {
			if time.Now().After(deadline) {
				t.Fatal("send did not complete", request)
			}
			w.mu.Lock()
			for _, msg := range w.state.Messages {
				if msg.ID == request && msg.State == "completed" {
					done = w.contextIdleLocked() == nil
				}
			}
			w.mu.Unlock()
			time.Sleep(10 * time.Millisecond)
		}
	}
	w.mu.Lock()
	segment := w.state.HistorySegment
	w.mu.Unlock()
	search := func(query, before string, limit int) map[string]any {
		t.Helper()
		value, err := w.historyPage(rawJSON(map[string]any{"segment": segment, "all_history": true, "limit": limit, "query": query, "before": before}))
		if err != nil {
			t.Fatal(err)
		}
		return value.(map[string]any)
	}
	texts := func(page map[string]any) []string {
		var out []string
		for _, e := range page["entries"].([]historyEntry) {
			if e.Kind != "message" {
				t.Fatal("search returned a non-message row", e.Kind)
			}
			out = append(out, e.Text)
		}
		return out
	}
	page := search("alpha", "", 50)
	got := texts(page)
	if len(got) != 2 || !strings.Contains(got[0], "第一条") || !strings.Contains(got[1], "第三条") || page["has_more"] != false {
		t.Fatal("case-insensitive search must return both matches in time order", got, page["has_more"])
	}
	first := search("alpha", "", 1)
	if got := texts(first); len(got) != 1 || !strings.Contains(got[0], "第三条") || first["has_more"] != true {
		t.Fatal("first page holds the newest match", got)
	}
	older := search("alpha", first["before"].(string), 1)
	if got := texts(older); len(got) != 1 || !strings.Contains(got[0], "第一条") {
		t.Fatal("before cursor continues to older matches", got)
	}
	if got := texts(search("回复编号", "", 50)); len(got) != len(inputs) {
		t.Fatal("replies are searchable too", got)
	}
	if got := texts(search("不存在的词", "", 50)); len(got) != 0 {
		t.Fatal("no match yields no rows", got)
	}
	if _, err := w.historyPage(rawJSON(map[string]any{"segment": segment, "query": strings.Repeat("长", 201)})); err == nil {
		t.Fatal("overlong query must be rejected")
	}
}

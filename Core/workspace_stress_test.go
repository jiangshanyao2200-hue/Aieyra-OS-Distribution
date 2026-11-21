// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: requireStress; TestStressNativeProcessCancellationAndReceipts; TestStressWorkspaceCapacityRecoveryAndPaging
// Impact: python -B scripts/code-atlas.py show Core/workspace_stress_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"
)

// 长测显式运行，普通构建仍保留原来的快速单测。
func requireStress(t *testing.T) {
	t.Helper()
	if os.Getenv("AIEYRA_STRESS") != "1" {
		t.Skip("set AIEYRA_STRESS=1 for sustained native stress")
	}
}

func TestStressNativeProcessCancellationAndReceipts(t *testing.T) {
	requireStress(t)
	m := shellTestManager(t)
	var timings []time.Duration
	zero := 0
	for batch := 0; batch < 32; batch++ {
		var group sync.WaitGroup
		results := make([]ShellResult, 4)
		for i := range results {
			req := shellTestCommand(t, "wait")
			req.YieldTimeMS = &zero
			group.Add(1)
			go func(i int) { defer group.Done(); results[i] = m.start(context.Background(), req) }(i)
		}
		group.Wait()
		readyDeadline := time.Now().Add(10 * time.Second)
		for _, result := range results {
			for !strings.Contains(m.job(result.SessionID).snapshot(100, false).Output, "STARTED") {
				if time.Now().After(readyDeadline) {
					t.Fatal("owned native helper did not reach running body")
				}
				time.Sleep(10 * time.Millisecond)
			}
		}
		at := time.Now()
		for _, result := range results {
			if result.State != "running" || result.SessionID == 0 {
				t.Fatalf("batch %d failed to start: %+v", batch, result)
			}
			group.Add(1)
			go func(id int) { defer group.Done(); m.stopSession(id) }(result.SessionID)
		}
		group.Wait()
		for _, result := range results {
			job := m.job(result.SessionID)
			select {
			case <-job.done:
			case <-time.After(10 * time.Second):
				t.Fatalf("native process %d did not settle after cancellation", result.SessionID)
			}
			got := job.snapshot(100, false)
			if got.Pending() || got.State != "cancelled" || got.ExitCode == nil || strings.Contains(got.Output, "FINISHED") {
				t.Fatalf("cancellation receipt: %+v", got)
			}
			// 已退出的日志可重命名，防止持有句柄到会话关闭才释放。
			old := got.OutputRef
			if err := os.Rename(old, old+".verified"); err != nil {
				t.Fatal("process log remains locked", err)
			}
			if err := os.Rename(old+".verified", old); err != nil {
				t.Fatal(err)
			}
		}
		timings = append(timings, time.Since(at))
		m.mu.Lock()
		active := m.active
		m.mu.Unlock()
		if active != 0 {
			t.Fatalf("batch %d leaked %d process slots", batch, active)
		}
	}
	sort.Slice(timings, func(i, j int) bool { return timings[i] < timings[j] })
	t.Logf("128 real native processes, concurrency 4, cancel batches p50=%v p95=%v max=%v; logs unlocked and slots released", timings[16], timings[30], timings[31])
}

func TestStressWorkspaceCapacityRecoveryAndPaging(t *testing.T) {
	requireStress(t)
	w, dir := testWorkspace(t, func(http.ResponseWriter, *http.Request) { t.Error("capacity inspection called a model") })
	w.Close()
	for i := 0; i < 9999; i++ {
		w.state.Messages = append(w.state.Messages, workspaceMessage{ID: fmt.Sprintf("saved-%05d", i), From: "user", To: WorkspaceMatrix, Text: "bounded synthetic history", State: "completed"})
	}
	last, err := w.Send("last-slot", "final admitted task")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = w.Send("overflow", "must reject visibly"); err == nil {
		t.Fatal("message capacity not enforced")
	}
	if duplicate, err := w.Send(last.ID, last.Text); err != nil || duplicate.ID != last.ID {
		t.Fatal("full capacity rejected existing idempotent request", err)
	}
	for i := 0; i < 200; i++ {
		if _, err = w.publishDocumentLocked(fmt.Sprintf("document %d", i), "md", strings.Repeat("完整内容🙂", 1024)); err != nil {
			t.Fatal(err)
		}
	}
	if _, err = w.publishDocumentLocked("overflow", "md", "not admitted"); err == nil {
		t.Fatal("document capacity not enforced")
	}
	files, err := os.ReadDir(filepath.Join(w.dir, "documents"))
	if err != nil || len(files) != 200 {
		t.Fatal("unexpected document disk side effects", len(files), err)
	}
	restored, err := NewWorkspace(w.config, w.state.ID, dir, "", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer restored.Close()
	page, total := 0, 0
	seen := map[string]bool{}
	for {
		result := restored.messagePage(rawJSON(map[string]any{"before": page})).(map[string]any)
		messages := result["messages"].([]workspaceMessage)
		if len(messages) > 200 {
			t.Fatal("page exceeds bound")
		}
		for _, message := range messages {
			if seen[message.ID] {
				t.Fatal("pagination repeated a message")
			}
			seen[message.ID] = true
			if message.ID == "last-slot" && message.State != "interrupted" {
				t.Fatal("restart replayed last queued message")
			}
		}
		total += len(messages)
		if !result["has_more"].(bool) {
			break
		}
		page = result["before"].(int)
	}
	if total != 10000 {
		t.Fatal("pagination lost history", total)
	}
	for _, doc := range restored.state.Documents {
		if result, err := restored.readDocument(doc.ID); err != nil || result.(map[string]any)["content"] != strings.Repeat("完整内容🙂", 1024) {
			t.Fatal("restored document lost bytes", err)
		}
	}
	t.Log("10000 persisted messages paged exactly once; 200 complete documents restored; overflow rejected without extra files")
}

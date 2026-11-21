// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestSteeringDrainsInOrderOnceWithoutReplacingObjective; TestSteeringWithdrawAndMixedProvenance; TestSteeringArchiveFailureFreezesBatchAcrossRetry; TestSteeringStorageFailureAndWithdrawalRollBack
// Impact: python -B scripts/code-atlas.py show Core/workspace_steering_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSteeringDrainsInOrderOnceWithoutReplacingObjective(t *testing.T) {
	w, _ := testWorkspace(t, func(http.ResponseWriter, *http.Request) { t.Error("draining must not request model") })
	w.Close()
	w.state.Messages = []workspaceMessage{{ID: "first", From: "user", To: WorkspaceMatrix, State: "context", Text: "先核对保存结果"}, {ID: "second", From: "user", To: WorkspaceMatrix, State: "queued", Text: "补充窄窗检查"}}
	archive := &SessionArchive{Path: filepath.Join(t.TempDir(), "ordered.jsonl")}
	added, err := w.drain(WorkspaceMatrix, archive, nil)
	if err != nil || len(added) != 1 || added[0].Name != "workspace_first" || !strings.Contains(added[0].Content, "【你工作时用户补充了 2 条】") || !strings.Contains(added[0].Content, "1. 先核对保存结果\n2. 补充窄窗检查") {
		t.Fatal(added, err)
	}
	for _, msg := range added {
		if !strings.Contains(msg.Content, "preserve the existing objective") {
			t.Fatal("补充替换了原目标语义", msg)
		}
	}
	w.state.Messages[0].State = "context"
	w.state.Messages[1].State = "context"
	repeated, err := w.drain(WorkspaceMatrix, archive, added)
	if err != nil || len(repeated) != 0 {
		t.Fatal("补充重复派发", repeated, err)
	}
}

func TestSteeringWithdrawAndMixedProvenance(t *testing.T) {
	w := askFixture(t)
	w.state.Messages = []workspaceMessage{
		{ID: "a", From: "user", To: WorkspaceMatrix, State: "context", Text: "第一条"},
		{ID: "b", From: "user", To: WorkspaceMatrix, State: "queued", Text: "撤回的内容"},
		{ID: "peer", From: WorkspaceProject, To: WorkspaceMatrix, State: "queued", Text: "调查证据"},
		{ID: "c", From: "user", To: WorkspaceMatrix, State: "queued", Text: "最后一条"},
	}
	for n := 0; n < 2; n++ {
		if _, err := w.withdraw("b"); err != nil {
			t.Fatal("withdrawal must be idempotent", err)
		}
	}
	if _, err := w.withdraw("peer"); err == nil {
		t.Fatal("withdrew another role's message")
	}
	archive := &SessionArchive{ephemeral: true}
	added, err := w.drain(WorkspaceMatrix, archive, nil)
	if err != nil || len(added) != 3 {
		t.Fatal(added, err)
	}
	for n, want := range []string{"workspace_a", "workspace_peer", "workspace_c"} {
		if added[n].Name != want || strings.Contains(added[n].Content, "撤回的内容") {
			t.Fatal("provenance or order lost", added)
		}
	}
	if !strings.HasPrefix(added[1].Content, "["+WorkspaceProject+";") {
		t.Fatal("peer merged into user batch", added[1])
	}
	if _, err := w.withdraw("a"); err == nil {
		t.Fatal("delivered message retracted")
	}
}

func TestSteeringArchiveFailureFreezesBatchAcrossRetry(t *testing.T) {
	w := askFixture(t)
	w.state.Messages = []workspaceMessage{
		{ID: "a", From: "user", To: WorkspaceMatrix, State: "context", Text: "first"},
		{ID: "b", From: "user", To: WorkspaceMatrix, State: "queued", Text: "second"},
	}
	archive := &SessionArchive{Path: t.TempDir()} // append to a directory fails
	if added, err := w.drain(WorkspaceMatrix, archive, nil); err == nil || len(added) != 0 {
		t.Fatal("archive failure hidden", added, err)
	}
	for _, m := range w.state.Messages {
		if m.State == "delivered" || m.DeliveryName != "workspace_a" {
			t.Fatal("batch receipt not retained", m)
		}
	}
	if _, err := w.withdraw("b"); err == nil {
		t.Fatal("uncertain archived batch was changed")
	}
	w.state.Messages = append(w.state.Messages, workspaceMessage{ID: "c", From: "user", To: WorkspaceMatrix, State: "queued", Text: "new supplement"})
	archive.Path = filepath.Join(t.TempDir(), "retry.jsonl")
	added, err := w.drain(WorkspaceMatrix, archive, nil)
	if err != nil || len(added) != 2 || !strings.Contains(added[0].Content, "2 条") || strings.Contains(added[0].Content, "new supplement") || added[1].Name != "workspace_c" {
		t.Fatal("retry changed membership", added, err)
	}
	// Lost state acknowledgement must recognize the archive's original names.
	for i := range w.state.Messages {
		w.state.Messages[i].State = "context"
	}
	if again, err := w.drain(WorkspaceMatrix, archive, added); err != nil || len(again) != 0 {
		t.Fatal("archive acknowledgement duplicated", again, err)
	}
	data, err := os.ReadFile(archive.Path)
	if err != nil || strings.Count(string(data), "\"kind\":\"message\"") != 2 {
		t.Fatal("archive contains duplicates", string(data), err)
	}
}

func TestSteeringStorageFailureAndWithdrawalRollBack(t *testing.T) {
	w, _ := testWorkspace(t, func(http.ResponseWriter, *http.Request) { t.Error("unit fixture called model") })
	w.cancel()
	<-w.done
	w.state.Messages = []workspaceMessage{{ID: "a", From: "user", To: WorkspaceMatrix, State: "queued", Text: "retained"}}
	w.dir = filepath.Join(t.TempDir(), "missing", "state")
	if _, err := w.withdraw("a"); err == nil || w.state.Messages[0].State != "queued" {
		t.Fatal("failed withdrawal lost message", err, w.state.Messages)
	}
	archive := &SessionArchive{ephemeral: true}
	if added, err := w.drain(WorkspaceMatrix, archive, nil); err == nil || len(added) != 0 {
		t.Fatal("storage failure hidden", added, err)
	}
	if w.state.Messages[0].DeliveryName != "" || len(archive.memory) != 0 {
		t.Fatal("failed batch claim reached archive", w.state.Messages)
	}
}

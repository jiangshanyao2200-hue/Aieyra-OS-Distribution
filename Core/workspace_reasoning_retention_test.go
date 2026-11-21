// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestPublicReasoningSnapshotDoesNotExpireOrMutateLiveState; TestWorkspaceBodyUpdateTimeTracksNewContentNotReadsOrEmptyChunks
// Impact: python -B scripts/code-atlas.py show Core/workspace_reasoning_retention_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"reflect"
	"testing"
	"time"
)

func TestPublicReasoningSnapshotDoesNotExpireOrMutateLiveState(t *testing.T) {
	w, _ := testWorkspace(t, nil)
	w.requestStart(WorkspaceMatrix, true)
	w.stream(WorkspaceMatrix, Event{Kind: EventReasoning, Text: "**核对回执**\n读取结果", ReasoningKind: "summary"})
	w.stream(WorkspaceMatrix, Event{Kind: EventDelta, Text: "正文不等待动画"})
	x, err := w.Snapshot(0)
	if err != nil {
		t.Fatal(err)
	}
	live := x.(map[string]any)["live"].(map[string]WorkspaceLive)[WorkspaceMatrix]
	if live.Phase != "body" || live.Thought != "**核对回执**\n读取结果" || live.Text != "正文不等待动画" {
		t.Fatal(live)
	}
	if live.BodyAt == 0 {
		t.Fatal("缺少真实正文阶段时间")
	}
	w.stream(WorkspaceMatrix, Event{Kind: EventToolPreparing})
	if w.live[WorkspaceMatrix].BodyAt != live.BodyAt {
		t.Fatal("快速工具分片丢失正文边界")
	}
	w.mu.Lock()
	v := w.live[WorkspaceMatrix]
	v.ThoughtAt = time.Now().Add(-5 * time.Second).UnixMilli()
	w.live[WorkspaceMatrix] = v
	w.mu.Unlock()
	for i := 0; i < 2; i++ {
		x, err = w.snapshot(0, WorkspaceCursor{Live: map[string]uint64{WorkspaceMatrix: v.Revision}})
		if err != nil {
			t.Fatal(err)
		}
		if delta := x.(map[string]any)["live"].(map[string]WorkspaceLive); len(delta) != 0 {
			t.Fatal("相同游标读取不能生成显示过期事件", delta)
		}
		x, err = w.Snapshot(0)
		if err != nil {
			t.Fatal(err)
		}
		if current := x.(map[string]any)["live"].(map[string]WorkspaceLive)[WorkspaceMatrix]; !reflect.DeepEqual(current, v) {
			t.Fatal("完整快照必须保留公开摘要及实际修订", current)
		}
		if !reflect.DeepEqual(w.live[WorkspaceMatrix], v) {
			t.Fatal("读取修改了权威流状态")
		}
	}
	w.requestStart(WorkspaceMatrix, false)
	w.stream(WorkspaceMatrix, Event{Kind: EventReasoning, Text: "不可展示", ReasoningKind: "summary"})
	if w.live[WorkspaceMatrix].Thought != "" {
		t.Fatal("关闭显示后仍暴露思考文字")
	}
}

func TestWorkspaceBodyUpdateTimeTracksNewContentNotReadsOrEmptyChunks(t *testing.T) {
	w, _ := testWorkspace(t, nil)
	w.taskRequestStart(WorkspaceMatrix, 5, true)
	w.taskStream(WorkspaceMatrix, 5, Event{Kind: EventDelta, Text: "第一段"})
	first := w.live[WorkspaceMatrix]
	if first.BodyAt == 0 || first.BodyUpdatedAt == 0 {
		t.Fatal("缺少正文到达时间", first)
	}
	w.mu.Lock()
	v := w.live[WorkspaceMatrix]
	v.BodyUpdatedAt = 1
	w.live[WorkspaceMatrix] = v
	w.mu.Unlock()
	w.taskStream(WorkspaceMatrix, 5, Event{Kind: EventDelta})
	if w.live[WorkspaceMatrix].BodyUpdatedAt != 1 {
		t.Fatal("空分块不能延长预览")
	}
	w.taskStream(WorkspaceMatrix, 4, Event{Kind: EventDelta, Text: "旧代迟到"})
	if w.live[WorkspaceMatrix].Text != first.Text {
		t.Fatal("旧代污染正文")
	}
	w.taskStream(WorkspaceMatrix, 5, Event{Kind: EventDelta, Text: "实际更新"})
	updated := w.live[WorkspaceMatrix]
	if updated.BodyAt != first.BodyAt || updated.BodyUpdatedAt <= 1 || updated.Text != "第一段实际更新" {
		t.Fatal("更新未保持正文边界", updated)
	}
	w.taskRequestStart(WorkspaceMatrix, 5, true)
	if v := w.live[WorkspaceMatrix]; !v.NewBody || v.BodyUpdatedAt != 0 {
		t.Fatal("新请求冒用了旧正文更新时间", v)
	}
}

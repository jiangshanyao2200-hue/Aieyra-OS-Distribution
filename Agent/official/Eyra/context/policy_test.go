package contextpolicy

import (
	"fmt"
	"strings"
	"testing"

	"github.com/aieyra/aieyra-os/contracts/protocol"
)

func TestEmptyRecallMarkerDoesNotDiscardUserOriginals(t *testing.T) {
	var previous *Originals
	for round := 0; round < 3; round++ {
		var messages []protocol.Message
		for i := 0; i < 60; i++ {
			messages = append(messages, protocol.Message{Role: protocol.RoleUser, Content: fmt.Sprintf("%03d ", round*60+i) + strings.Repeat("完整原文", 2200)})
		}
		next := KeepUserOriginals(previous, messages, "", "")
		previous = &next
	}
	if len(previous.RecentUsers) != 99 || !strings.HasPrefix(previous.RecentUsers[0], "080 ") || !strings.HasPrefix(previous.LastUser, "179 ") || len(previous.RecentUsers[0]) < 24000 {
		t.Fatal("empty optional recall marker lost full recent originals", len(previous.RecentUsers), len(previous.LastUser))
	}
	messages := []protocol.Message{{Role: protocol.RoleUser, Content: "端口 8179"}, {Role: protocol.RoleAssistant, Content: "已记录"}, {Role: protocol.RoleUser, Content: "继续"}}
	if cut := CompactCut(messages, 1, ""); cut != 2 {
		t.Fatal("empty marker prevented a complete turn boundary", cut)
	}
	if found := Recall(messages, 2, "端口", 1000, ""); !strings.Contains(found, "8179") {
		t.Fatal("empty marker blocked original retrieval")
	}
	if found := Recall(messages, -1, "端口", 1000, ""); found != "" {
		t.Fatal("negative coverage read an unauthorized source range")
	}
}

func TestStrategySnapshotsAndToolBoundaries(t *testing.T) {
	messages := []protocol.Message{{Role: protocol.RoleUser, Content: "任务"}, {Role: protocol.RoleAssistant, ToolCalls: []protocol.ToolCall{{ID: "one"}, {ID: "two"}}}, {Role: protocol.RoleTool, ToolCallID: "one"}}
	if CompleteRange(messages) || CompactWorkCut(messages, 2, true, "引用：") != 0 {
		t.Fatal("pending tool group was eligible for sealing")
	}
	messages = append(messages, protocol.Message{Role: protocol.RoleTool, ToolCallID: "two"})
	if !CompleteRange(messages) || CompactWorkCut(messages, 2, true, "引用：") != 4 {
		t.Fatal("complete tool group not retained as a single boundary")
	}
	request := CompactRequest(messages, "整理")
	request[1].ToolCalls[0].ID = "changed"
	if messages[1].ToolCalls[0].ID != "one" {
		t.Fatal("maintenance request changed the archive view")
	}
	for _, answer := range []protocol.Message{{Content: ""}, {Content: "足够长的文本但被截断了。", FinishReason: "length"}, {Content: "足够长的文本同时调用了工具。", ToolCalls: []protocol.ToolCall{{ID: "call"}}}} {
		if _, err := SegmentText(answer); err == nil {
			t.Fatal("incomplete summary became a checkpoint candidate")
		}
	}
}

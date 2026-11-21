// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestSessionRestoresOriginalCheckpointAndInterruptedReply; TestSessionLegacyTailRecoveryAndCorruption; TestSessionRestoresPACPacketCheckpoint
// Impact: python -B scripts/code-atlas.py show Core/session_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestSessionRestoresOriginalCheckpointAndInterruptedReply(t *testing.T) {
	config := filepath.Join(t.TempDir(), "config.json")
	a, err := NewSessionArchive(config)
	if err != nil {
		t.Fatal(err)
	}
	if err = a.Start(ModelFlash); err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	messages := []Message{{Role: RoleUser, Content: "保留路径 C:\\fixtures\\test.go\n  缩进"}, {Role: RoleAssistant, Content: "第一轮结果"}, {Role: RoleUser, Content: "接着完成"}}
	for _, m := range messages {
		if err = a.Append("message", m); err != nil {
			t.Fatal(err)
		}
	}
	cp := &Checkpoint{Covered: 2, Summary: CompactSummary{Goals: []string{"保留任务"}}}
	if err = a.Append("checkpoint", cp); err != nil {
		t.Fatal(err)
	}
	if err = a.Append("reply_delta", Message{Role: RoleAssistant, Content: "部分", ReasoningContent: "推理"}); err != nil {
		t.Fatal(err)
	}
	if err = a.Append("reply_delta", Message{Role: RoleAssistant, Content: "结果"}); err != nil {
		t.Fatal(err)
	}
	if _, _, err = RestoreSession(config, a.ID()); err == nil {
		t.Fatal("同一会话允许了两个写入者")
	}
	a.Close()
	restored, r, err := RestoreSession(config, a.ID())
	if err != nil {
		t.Fatal(err)
	}
	defer restored.Close()
	if !reflect.DeepEqual(messages, r.Messages) || !reflect.DeepEqual(cp, r.Checkpoint) || r.State.Model != ModelFlash || r.Pending.Content != "部分结果" {
		t.Fatal("恢复丢失原文、检查点、模型或中断输出")
	}
	if err = restored.Append("message", r.Pending); err != nil {
		t.Fatal(err)
	}
	restored.Close()
	again, r, err := RestoreSession(config, a.ID())
	if err != nil {
		t.Fatal(err)
	}
	defer again.Close()
	if len(r.Messages) != 4 || r.Pending.Content != "" {
		t.Fatal("恢复后部分输出重复")
	}
}

func TestSessionLegacyTailRecoveryAndCorruption(t *testing.T) {
	config := filepath.Join(t.TempDir(), "config.json")
	a, _ := NewSessionArchive(config)
	legacy := "{\"kind\":\"message\",\"value\":{\"role\":\"user\",\"content\":\"旧会话\"}}\n"
	if err := os.WriteFile(a.Path, []byte(legacy+"{\"kind\":"), 0600); err != nil {
		t.Fatal(err)
	}
	rArchive, r, err := RestoreSession(config, a.ID())
	if err != nil {
		t.Fatal(err)
	}
	if !r.Truncated || len(r.Messages) != 1 {
		t.Fatal("没有恢复完整的旧记录")
	}
	if err = rArchive.Append("draft", "恢复后草稿"); err != nil {
		t.Fatal(err)
	}
	rArchive.Close()
	rArchive, r, err = RestoreSession(config, a.ID())
	if err != nil {
		t.Fatal(err)
	}
	if r.Draft != "恢复后草稿" {
		t.Fatal("损坏尾部使后续记录无法读取")
	}
	rArchive.Close()
	if err = os.WriteFile(a.Path, []byte(legacy+"invalid\n"+legacy), 0600); err != nil {
		t.Fatal(err)
	}
	if _, _, err = RestoreSession(config, a.ID()); err == nil {
		t.Fatal("静默忽略中间损坏的历史")
	}
	if _, err = SessionPath(config, "../config"); err == nil {
		t.Fatal("会话编号允许路径穿越")
	}
	b, _ := os.ReadFile(a.Path)
	if !strings.Contains(string(b), "invalid") {
		t.Fatal("损坏文件被覆盖")
	}
}

// A PAC seal writes a checkpoint with only Packet set; it must restore.
func TestSessionRestoresPACPacketCheckpoint(t *testing.T) {
	config := filepath.Join(t.TempDir(), "config.json")
	a, err := NewSessionArchive(config)
	if err != nil {
		t.Fatal(err)
	}
	if err = a.Start(ModelFlash); err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	history := []Message{{Role: RoleUser, Content: "check word"}, {Role: RoleAssistant, Content: "done"}}
	for _, m := range history {
		if err = a.Append("message", m); err != nil {
			t.Fatal(err)
		}
	}
	cp := pacCheckpoint(nil, history, 0, len(history), "pac_test", "summary", nil)
	if err = a.Append("checkpoint", cp); err != nil {
		t.Fatal(err)
	}
	a.Close()
	restored, r, err := RestoreSession(config, a.ID())
	if err != nil {
		t.Fatal(err)
	}
	defer restored.Close()
	if r.Checkpoint == nil || r.Checkpoint.Packet != "pac_test" || r.Checkpoint.Covered != 2 || r.Checkpoint.LastUser != "check word" {
		t.Fatalf("PAC checkpoint not restored: %+v", r.Checkpoint)
	}
	a.Close()
	if bad, _, err := func() (*SessionArchive, *RestoredSession, error) {
		b, err := NewSessionArchive(config)
		if err != nil {
			return nil, nil, err
		}
		if err = b.Start(ModelFlash); err != nil {
			return nil, nil, err
		}
		if err = b.Append("checkpoint", &Checkpoint{Covered: 0}); err != nil {
			return nil, nil, err
		}
		b.Close()
		return RestoreSession(config, b.ID())
	}(); err == nil {
		bad.Close()
		t.Fatal("empty checkpoint must still be rejected")
	}
}

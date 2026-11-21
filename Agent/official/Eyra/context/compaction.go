package contextpolicy

import (
	"fmt"
	"github.com/aieyra/aieyra-os/contracts/protocol"
	"strings"
	"unicode/utf8"
)

func SegmentText(answer protocol.Message) (string, error) {
	if len(answer.ToolCalls) > 0 {
		return "", fmt.Errorf("记忆整理时调用了工具，已保留原上下文")
	}
	if answer.FinishReason != "" && answer.FinishReason != "stop" {
		return "", fmt.Errorf("记忆整理未完整结束（%s），已保留原上下文", answer.FinishReason)
	}
	text := strings.TrimSpace(answer.Content)
	if utf8.RuneCountInString(text) < 12 {
		return "", fmt.Errorf("记忆整理没有给出内容，已保留原上下文")
	}
	return text, nil
}

// Preserve the observed prefix bytes; actual cache reuse is provider-reported.
func CompactRequest(prefix []protocol.Message, instruction string) []protocol.Message {
	out := make([]protocol.Message, 0, len(prefix)+1)
	out = append(out, protocol.CloneMessages(prefix)...)
	return append(out, protocol.Message{Role: protocol.RoleUser, Name: "memory_compaction", Content: instruction})
}

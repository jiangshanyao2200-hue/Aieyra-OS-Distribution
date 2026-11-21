// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Agent/context/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: CompletionFunc; Summary; Compact
// Impact: python -B scripts/code-atlas.py show Agent/context/summary/summary.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Package summary implements independent structured-summary compaction.
// The host supplies the source projection, instructions and completion function;
// successful validation returns a candidate and never commits or edits an archive.
package summary

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"github.com/aieyra/aieyra-os/contracts/protocol"
	"io"
	"strings"
)

type CompletionFunc func(context.Context, []protocol.Message) (protocol.Message, string, error)

// Summary 是可检查的工作记忆。字段为空也必须显式返回数组。
type Summary struct {
	SourceDigest  string   `json:"source_digest"`
	Goals         []string `json:"goals"`
	Constraints   []string `json:"constraints"`
	Decisions     []string `json:"decisions"`
	Progress      []string `json:"progress"`
	CriticalFacts []string `json:"critical_facts"`
	OpenTasks     []string `json:"open_tasks"`
	NextSteps     []string `json:"next_steps"`
	Uncertainties []string `json:"uncertainties"`
}

func Compact(ctx context.Context, previous json.RawMessage, messages []protocol.Message, instruction string, complete CompletionFunc) (*Summary, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	// 不透明推理签名只用于协议续接，不送给摘要模型作为文本或估算加密字节。
	plain := make([]protocol.Message, len(messages))
	copy(plain, messages)
	for i := range plain {
		plain[i].ResponseItems = nil
		plain[i].NativeContent = nil
		plain[i].ReasoningDetails = nil
		plain[i].ReasoningContent = ""
		plain[i].RouterReasoning = ""
	}
	source, err := json.Marshal(struct {
		Previous json.RawMessage    `json:"previous_summary,omitempty"`
		Messages []protocol.Message `json:"messages"`
	}{previous, plain})
	if err != nil {
		return nil, err
	}
	digest := fmt.Sprintf("%x", sha256.Sum256(source))
	input, _ := json.Marshal(struct {
		Digest string          `json:"source_digest"`
		Source json.RawMessage `json:"source"`
	}{digest, source})
	reply, finish, err := complete(ctx, []protocol.Message{{Role: protocol.RoleSystem, Content: instruction}, {Role: protocol.RoleUser, Content: string(input)}})
	if err != nil {
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if finish != "stop" {
		return nil, fmt.Errorf("Compact 未完整结束（%s），已保留原上下文", finish)
	}
	var summary Summary
	dec := json.NewDecoder(strings.NewReader(reply.Content))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&summary); err != nil {
		return nil, fmt.Errorf("Compact 格式不完整，已保留原上下文: %w", err)
	}
	if dec.Decode(new(any)) != io.EOF {
		return nil, fmt.Errorf("Compact 含额外内容，已保留原上下文")
	}
	if summary.SourceDigest != digest || len(summary.Goals) == 0 || summary.Constraints == nil || summary.Decisions == nil || summary.Progress == nil || summary.CriticalFacts == nil || summary.OpenTasks == nil || summary.NextSteps == nil || summary.Uncertainties == nil {
		return nil, fmt.Errorf("Compact 缺少任务状态或来源校验，已保留原上下文")
	}
	for _, group := range [][]string{summary.Goals, summary.Constraints, summary.Decisions, summary.Progress, summary.CriticalFacts, summary.OpenTasks, summary.NextSteps, summary.Uncertainties} {
		for _, item := range group {
			if strings.TrimSpace(item) == "" {
				return nil, fmt.Errorf("Compact 含空白条目，已保留原上下文")
			}
		}
	}
	return &summary, nil
}

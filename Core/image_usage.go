// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: imageUsageObserverKey; imageUsageWriterKey; imageUsageOwnerKey; imageUsageRecoveryKey; parseImageUsage; observeImageUsage; recordImageUsage; recoverImageUsage; recoverImageUsage; imageUsageRows
// Impact: python -B scripts/code-atlas.py show Core/image_usage.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"fmt"
	apiimages "github.com/aieyra/aieyra-os/api/images"
)

type imageUsageObserverKey struct{}
type imageUsageWriterKey struct{}
type imageUsageOwnerKey struct{}
type imageUsageRecoveryKey struct{}

func parseImageUsage(raw json.RawMessage) *AgentUsage {
	usage := apiimages.ParseUsage(raw)
	if usage == nil {
		return nil
	}
	return &AgentUsage{Kind: "image_gen", Reported: true, Input: usage.Input, Output: usage.Output}
}

func observeImageUsage(ctx context.Context, usage *AgentUsage) error {
	if f, ok := ctx.Value(imageUsageObserverKey{}).(func(*AgentUsage) error); ok {
		return f(usage)
	}
	return nil
}

// Save an unknown sample before the HTTP attempt, then replace that exact
// sample when a provider receipt arrives. Cancellation/reopen never turns it
// into zero or appends a second charge. Chat request budgets stay separate.
func (m *AgentManager) recordImageUsage(job *agentJob, generation int, usage AgentUsage) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if job.record.Generation != generation || usage.SourceID == "" {
		return fmt.Errorf("图片用量的任务身份已失效，未提交后续图片")
	}
	old := append([]AgentUsage(nil), job.record.Usage...)
	found := false
	for i := range job.record.Usage {
		if job.record.Usage[i].SourceID == usage.SourceID {
			job.record.Usage[i] = usage
			found = true
			break
		}
	}
	if !found {
		job.record.Usage = append(job.record.Usage, usage)
	}
	if err := m.saveLocked(job); err != nil {
		job.record.Usage = old
		return fmt.Errorf("图片用量收据无法保存，请核对磁盘后继续")
	}
	return nil
}

// Repair only an existing sample in its original task. A later turn or a
// restored home executor must never append the old charge to its own ledger.
func (m *AgentManager) recoverImageUsage(owner string, usage AgentUsage) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if usage.SourceID == "" || usage.Kind != "image_gen" {
		return fmt.Errorf("图片用量缺少原请求身份，原回执保留")
	}
	var target *agentJob
	index := -1
	for id, job := range m.jobs {
		if owner != "" && owner != "agent:"+id {
			continue
		}
		for n, row := range job.record.Usage {
			if row.Kind == "image_gen" && row.SourceID == usage.SourceID {
				if target != nil {
					return fmt.Errorf("图片用量的原账本身份不唯一，原回执保留")
				}
				target, index = job, n
			}
		}
	}
	if target == nil {
		return fmt.Errorf("图片用量的原任务账本暂不可用，原回执保留")
	}
	old := target.record.Usage[index]
	target.record.Usage[index] = usage
	if err := m.saveLocked(target); err != nil {
		target.record.Usage[index] = old
		return fmt.Errorf("图片用量收据无法保存，请核对磁盘后继续")
	}
	return nil
}

func recoverImageUsage(ctx context.Context, batch *imageBatch, originalOwner string, usage AgentUsage, previousError string) string {
	if ctx.Err() != nil {
		return ctx.Err().Error()
	}
	if recover, ok := ctx.Value(imageUsageRecoveryKey{}).(func(string, AgentUsage) error); ok {
		if err := recover(originalOwner, usage); err != nil {
			return err.Error()
		}
		return ""
	}
	owner, _ := ctx.Value(imageUsageOwnerKey{}).(string)
	task, _ := ctx.Value(imageGenTaskKey{}).(string)
	if originalOwner != owner || batch.TaskID != task {
		return "图片用量的原任务账本暂不可用，原回执保留"
	}
	if writer, ok := ctx.Value(imageUsageWriterKey{}).(func(AgentUsage) error); ok {
		if err := writer(usage); err != nil {
			return err.Error()
		}
		return ""
	}
	if originalOwner != "" || previousError != "" {
		return "图片用量的原任务账本暂不可用，原回执保留"
	}
	return "" // A local, unbound invocation keeps accounting in the batch itself.
}

func imageUsageRows(rows []AgentUsage) []AgentUsage {
	var result []AgentUsage
	for _, row := range rows {
		if row.Kind == "image_gen" {
			result = append(result, row)
		}
	}
	return result
}

// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: failureDirectory; failureReport
// Impact: python -B scripts/code-atlas.py show Core/workspace_failure.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Unified OS runtime directories are removed on normal exit, so failure
// records live beside the persistent reports.
func (w *Workspace) failureDirectory() string {
	if w.Mode().unified() {
		return filepath.Join(w.reportDirectory(), "failures")
	}
	return w.dir
}

// 失败总结先读持久回执；只写本地，不把原任务正文或日志自动上传。
func (w *Workspace) failureReport(record AgentRecord) string {
	w.mu.Lock()
	workflow, workflowErr := w.loadWorkflowLocked()
	owner := w.state.ID
	w.mu.Unlock()
	receipt, activityErr := w.manager.Activity(owner, record.ID, 0, 0, 40)
	report := map[string]any{"version": 1, "agent": record.ID, "generation": record.Generation, "state": record.State, "failure": record.Failure, "error": record.Error, "requests": record.Requests - record.TurnRequestBase, "accounted_tokens": record.AccountedTokens - record.TurnTokenBase, "response_retained": record.Result != "", "feedback": map[string]string{"status": "local_only", "notice": "仅保留本地；公开反馈由 Agent 另行整理最小复现"}}
	// A subsequent turn can reset the live record. Keep the actual request
	// telemetry with the failure so diagnostics do not infer it from new settings.
	usage := []AgentUsage{}
	for _, u := range record.Usage {
		if u.Request > record.TurnRequestBase {
			usage = append(usage, u)
		}
	}
	report["usage"], report["model_id"], report["context"] = usage, record.Spec.ModelID, record.Context
	if w.host != nil {
		report["product_version"] = w.host.version
	}
	var b strings.Builder
	fmt.Fprintf(&b, "%s。任务停在第%d次请求，已完成的操作不会自动重跑。\n\n", failureHeading(record), record.Requests-record.TurnRequestBase)
	fmt.Fprintf(&b, "任务代次：%d；状态：%s。\n\n", record.Generation, record.State)
	if len(usage) > 0 {
		last := usage[len(usage)-1]
		if last.Model != "" {
			limit, finish := "自动", strings.TrimSpace(last.FinishReason)
			if last.OutputLimit > 0 {
				limit = fmt.Sprintf("%d tokens", last.OutputLimit)
			}
			if finish == "" {
				finish = "未收到"
			}
			fmt.Fprintf(&b, "最后请求模型：%s；输出上限：%s；结束原因：%s。\n\n", last.Model, limit, finish)
		}
		if last.Reported {
			fmt.Fprintf(&b, "上游报告用量：输入 %d，输出 %d tokens。\n\n", last.Input, last.Output)
		}
	}
	if activityErr == nil {
		report["activity"] = receipt
		b.WriteString("工具调用回执已重新读取并保留。\n\n")
	} else {
		report["activity_error"] = activityErr.Error()
		b.WriteString("工具回执读取未完成，需继续核验。\n\n")
	}
	archive, _ := SessionPath(filepath.Join(w.manager.dir, "config.json"), record.ID)
	preserved := []string{}
	for _, file := range []string{archive, filepath.Join(w.manager.dir, record.ID+".json"), filepath.Join(w.manager.dir, record.ID+".shell"), filepath.Join(w.dir, "workflow.json")} {
		if _, e := os.Stat(file); e == nil {
			preserved = append(preserved, file)
		}
	}
	report["preserved"] = preserved
	b.WriteString("本地保留：\n")
	for _, file := range preserved {
		fmt.Fprintf(&b, "- %s\n", file)
	}
	if record.Result != "" {
		fmt.Fprintf(&b, "\n最后响应已保留：\n\n%s\n", record.Result)
		if record.Failure != nil && record.Failure.Code == "task_token_limit" {
			b.WriteString("\n超限响应中的工具调用未执行。\n")
		}
	}
	if workflowErr == nil {
		report["workflow"] = workflowVisible(workflow)
		ctx, cancel := context.WithCancel(context.Background())
		validity := w.workflowValidity(ctx, workflow)
		cancel()
		report["evidence_validity"] = validity
		if workflow.Plan != nil {
			b.WriteString("\n尚未完成的计划：\n")
			for _, phase := range workflow.Plan.Phases {
				for _, step := range phase.Steps {
					if step.Status != PlanCompleted && step.Status != PlanSuperseded && step.Status != PlanCancelled {
						fmt.Fprintf(&b, "- %s（%s）\n", step.Text, step.Status)
					}
				}
			}
		}
		for _, capture := range workflow.Captures {
			for _, file := range capture.Files {
				fmt.Fprintf(&b, "\n已登记成果：%s；当前证据状态：%s。\n", file.Path, validity[capture.ID])
			}
		}
	} else {
		report["workflow_error"] = workflowErr.Error()
		b.WriteString("\n持久计划读取失败，不能推断其完成状态。\n")
	}
	fmt.Fprintf(&b, "\n原始错误：%s\n\n公开反馈：尚未发布；本地错误与路径不会自动上传。\n", record.Error)
	// The OS runtime directory is removed on normal exit; the record the user
	// is pointed at must outlive it.
	dir, file := w.failureDirectory(), fmt.Sprintf("failure-%s-%s-%d.json", owner, record.ID, record.Generation)
	if e := os.MkdirAll(dir, 0700); e != nil {
		fmt.Fprintf(&b, "\n失败总结保存失败：%s；既有回执未删除。", e)
	} else if e = atomicWorkspaceFile(dir, file, []byte(w.manager.redact(string(rawJSON(report))))); e != nil {
		fmt.Fprintf(&b, "\n失败总结保存失败：%s；既有回执未删除。", e)
	} else {
		fmt.Fprintf(&b, "\n核验记录：%s", filepath.Join(dir, file))
	}
	return w.manager.redact(b.String())
}

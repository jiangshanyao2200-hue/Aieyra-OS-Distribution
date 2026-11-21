// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: ToolIntent; ToolArgumentHash; toolStartedObserverKey; toolInvocationKey; WithToolStartedObserver; ExecuteToolTurn; parallelToolBatchEnd; interruptedToolTurn
// Impact: python -B scripts/code-atlas.py show Core/tool_execution.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"path/filepath"

	patchtool "github.com/aieyra/aieyra-os/tool/base/official/apply_patch"
)

type ToolIntent struct {
	InvocationID string  `json:"invocation_id"`
	Response     Message `json:"response"`
}

func ToolArgumentHash(call ToolCall) string {
	call = archiveToolCall(call)
	sum := sha256.Sum256([]byte(call.Function.Name + "\x00" + call.Function.Arguments))
	return hex.EncodeToString(sum[:])
}

type toolStartedObserverKey struct{}

type toolInvocationKey struct{}

// WithToolStartedObserver 用于显示实际派发；观察者必须非阻塞，不能改变调度结果。
func WithToolStartedObserver(ctx context.Context, observer func(string)) context.Context {
	return context.WithValue(ctx, toolStartedObserverKey{}, observer)
}

// 外部副作用无法回滚：先写意图，每项写收据，最后提交完整消息配对。
// worker 只修改传入的独立 PlanEngine；UI 在收到完成消息后采用它。
func ExecuteToolTurn(ctx context.Context, e *PlanEngine, shell *ShellManager, response Message, invocation string, persist func(string, any) error) (ToolTurn, error) {
	if response.FinishReason == "length" || len(response.IncompleteTools) > 0 {
		return ToolTurn{}, &OutputLimitError{Tools: len(response.ToolCalls) + len(response.IncompleteTools)}
	}
	if persist == nil {
		return ToolTurn{}, fmt.Errorf("工具执行缺少持久化边界")
	}
	for _, call := range response.ToolCalls {
		if err := permittedCall(ctx, call); err != nil {
			return ToolTurn{}, err
		}
	}
	if shell != nil && shell.config != "" {
		ctx = context.WithValue(ctx, officialToolConfigKey{}, shell.config)
	}
	ctx = withOfficialToolAdmission(ctx)
	for _, call := range response.ToolCalls {
		// A durable receipt is read back without re-admitting its old payload.
		if old, exists := e.Receipts[invocation+":"+call.ID]; exists && old.ArgumentHash == ToolArgumentHash(call) {
			continue
		}
		if err := admitOfficialToolCall(ctx, call); err != nil {
			return ToolTurn{}, err
		}
	}
	hasShell := false
	for _, call := range response.ToolCalls {
		hasShell = hasShell || isWorkspaceTool(call.Function.Name) || call.Function.Name == "toolbox" || call.Function.Name == "core_link" || IsDisplayTool(call.Function.Name) || call.Function.Name == "apply_patch" || call.Function.Name == "web_search" || call.Function.Name == "group"
	}
	if !hasShell {
		return executePlanTools(ctx, e, response, invocation, func(t ToolTurn) error { return persist("tool_turn", t) })
	}
	turn := ToolTurn{InvocationID: invocation, Messages: []Message{archiveToolMessage(response)}}
	if invocation == "" || len(response.ToolCalls) == 0 || len(response.ToolCalls) > 32 || persist == nil {
		return turn, fmt.Errorf("工具执行身份、数量或持久化边界无效")
	}
	candidate := e.Clone()
	if workflow, ok := ctx.Value(workflowContextKey{}).(workflowContext); ok && workflow.Plan == e {
		// Sequential tools observe the same candidate after each durable receipt.
		// The caller still adopts it only when the complete turn commits.
		workflow.Plan = candidate
		ctx = context.WithValue(ctx, workflowContextKey{}, workflow)
	}
	seen := map[string]bool{}
	replayed := 0
	for _, call := range response.ToolCalls {
		if call.ID == "" || seen[call.ID] {
			return turn, fmt.Errorf("工具调用 ID 缺失或重复")
		}
		seen[call.ID] = true
		if old, ok := candidate.Receipts[invocation+":"+call.ID]; ok {
			if old.ArgumentHash != ToolArgumentHash(call) {
				return turn, fmt.Errorf("同一工具调用身份携带了不同参数，未执行")
			}
			replayed++
			turn.Messages = append(turn.Messages, Message{Role: RoleTool, ToolCallID: call.ID, Name: call.Function.Name, Content: old.Output, Images: old.Images})
		}
	}
	if replayed > 0 {
		if replayed != len(response.ToolCalls) {
			return ToolTurn{}, fmt.Errorf("重放响应改变了调用集合，未执行")
		}
		turn.Replayed = true
		return turn, nil
	}
	if err := persist("tool_intent", ToolIntent{invocation, archiveToolMessage(response)}); err != nil {
		return turn, fmt.Errorf("执行意图保存失败，命令未执行：%w", err)
	}
	// 独立 Shell 调用最多四项在途；收据落盘就补空位，不等最慢的同伴。
	// 计划更新、显式串行和同一进程的 IO 仍是顺序边界。
	// 收据按实际完成时机落盘，返回消息仍按原调用顺序配对，不能让完成顺序污染协议。
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	for start := 0; start < len(response.ToolCalls); {
		end := parallelToolBatchEnd(response.ToolCalls, start)
		type completed struct {
			index   int
			receipt ToolReceipt
		}
		results := make(chan completed, end-start)
		launch := func(i int) {
			call := response.ToolCalls[i]
			if err := permittedCall(ctx, call); err != nil {
				data, _ := json.Marshal(execFailure("tool_not_assigned", err.Error()))
				results <- completed{i, ToolReceipt{Key: invocation + ":" + call.ID, ArgumentHash: ToolArgumentHash(call), Output: string(data)}}
				return
			}
			if isWorkspaceTool(call.Function.Name) {
				go func(index int, call ToolCall) {
					key := invocation + ":" + call.ID
					if notify, ok := ctx.Value(toolStartedObserverKey{}).(func(string)); ok {
						notify(key)
					}
					data, _ := json.Marshal(executeWorkspaceTool(context.WithValue(ctx, toolInvocationKey{}, key), call))
					results <- completed{index, ToolReceipt{Key: key, ArgumentHash: ToolArgumentHash(call), Output: string(data)}}
				}(i, call)
				return
			}
			if call.Function.Name == "toolbox" || call.Function.Name == "agents" || call.Function.Name == "core_link" || call.Function.Name == "group" {
				go func(index int, call ToolCall) {
					key := invocation + ":" + call.ID
					if notify, ok := ctx.Value(toolStartedObserverKey{}).(func(string)); ok {
						notify(key)
					}
					callCtx := context.WithValue(ctx, toolInvocationKey{}, key)
					var result ToolboxResult
					if call.Function.Name == "agents" || call.Function.Name == "core_link" {
						result = executeAgents(callCtx, call)
					} else if call.Function.Name == "group" {
						result = executeGroupTool(callCtx, call)
					} else {
						result = executeToolbox(callCtx, call)
					}
					images := programToolImages(callCtx, shell, call, &result)
					data, _ := json.Marshal(result)
					results <- completed{index, ToolReceipt{Key: key, ArgumentHash: ToolArgumentHash(call), Output: string(data), Images: images}}
				}(i, call)
				return
			}
			if call.Function.Name == "web_search" {
				go func(index int, call ToolCall) {
					key := invocation + ":" + call.ID
					if notify, ok := ctx.Value(toolStartedObserverKey{}).(func(string)); ok {
						notify(key)
					}
					data, _ := json.Marshal(webSearch(ctx, call))
					results <- completed{index, ToolReceipt{Key: key, ArgumentHash: ToolArgumentHash(call), Output: string(data)}}
				}(i, call)
				return
			}
			if IsRuntimeTool(call.Function.Name) {
				go func(index int, call ToolCall) {
					key := invocation + ":" + call.ID
					if notify, ok := ctx.Value(toolStartedObserverKey{}).(func(string)); ok {
						notify(key)
					}
					var result any = execFailure("runtime_unavailable", "工具执行器未初始化")
					var images []ImageAttachment
					if shell != nil {
						if call.Function.Name == "view_image" {
							result, images = shell.viewImage(ctx, call)
						} else {
							result, images = shell.execution.execute(ctx, call, key)
						}
					}
					data, _ := json.Marshal(result)
					results <- completed{index, ToolReceipt{Key: key, ArgumentHash: ToolArgumentHash(call), Output: string(data), Images: images}}
				}(i, call)
				return
			}
			if call.Function.Name == "apply_patch" {
				go func(index int, call ToolCall) {
					key := invocation + ":" + call.ID
					if notify, ok := ctx.Value(toolStartedObserverKey{}).(func(string)); ok {
						notify(key)
					}
					r := PatchResult{State: "rejected", Error: &PatchError{Code: "patch_unavailable", Message: "文件执行器未初始化"}}
					if shell != nil {
						r = patchtool.ExecutePatchWithPaths(ctx, shell.root, filepath.Join(shell.dir, "patches"), call, key, shell.relocate)
					}
					output := patchtool.PatchModelOutput(r)
					results <- completed{index, ToolReceipt{Key: key, ArgumentHash: ToolArgumentHash(call), Output: output, Patch: &r}}
				}(i, call)
				return
			}
			if !IsShellTool(call.Function.Name) {
				receipt, _ := candidate.applyContext(ctx, call, invocation)
				results <- completed{i, receipt}
				return
			}
			go func(index int, call ToolCall) {
				r := shellFailure("shell_unavailable", "Shell 执行器未初始化")
				if ctx.Err() != nil {
					r = shellFailure("cancelled", "本轮已停止，此调用未执行")
					r.State = "cancelled"
				} else if shell != nil {
					if notify, ok := ctx.Value(toolStartedObserverKey{}).(func(string)); ok {
						notify(invocation + ":" + call.ID)
					}
					r = shell.Execute(ctx, call)
				}
				data, _ := json.Marshal(r)
				results <- completed{index, ToolReceipt{Key: invocation + ":" + call.ID, ArgumentHash: ToolArgumentHash(call), Output: string(data)}}
			}(i, call)
		}
		ordered := make([]ToolReceipt, end-start)
		var saveErr error
		next, inFlight := start, 0
		fill := func() {
			for saveErr == nil && next < end && inFlight < ShellDispatchLimit {
				launch(next)
				next++
				inFlight++
			}
		}
		fill()
		for inFlight > 0 {
			result := <-results
			inFlight--
			result.receipt.ToolName = response.ToolCalls[result.index].Function.Name
			if result.receipt.ToolName == "terminal" || result.receipt.ToolName == "exec_command" || result.receipt.ToolName == "write_stdin" {
				var output map[string]any
				if json.Unmarshal([]byte(result.receipt.Output), &output) == nil && output != nil {
					// Return the real identity with the durable result, so callers can
					// link evidence without an extra status request to discover it.
					output["receipt_key"] = result.receipt.Key
					result.receipt.Output = string(rawJSON(output))
				}
			}
			ordered[result.index-start] = result.receipt
			if err := persist("tool_progress", result.receipt); err != nil && saveErr == nil {
				saveErr = err
				cancel() // 不再派发后续调用；已产生副作用的结果仍尝试落盘。
				if shell != nil && shell.execution != nil {
					shell.execution.stopAll(false)
				}
			}
			fill()
		}
		if saveErr != nil {
			return turn, fmt.Errorf("工具可能已执行，收据保存失败；停止推进，请恢复会话核对结果：%w", saveErr)
		}
		for i, receipt := range ordered {
			call := response.ToolCalls[start+i]
			candidate.Receipts[receipt.Key] = receipt
			turn.Receipts = append(turn.Receipts, receipt)
			turn.Messages = append(turn.Messages, Message{Role: RoleTool, ToolCallID: call.ID, Name: call.Function.Name, Content: receipt.Output, Images: receipt.Images})
		}
		start = end
	}
	if err := persist("tool_turn", turn); err != nil {
		if shell != nil && shell.execution != nil {
			shell.execution.stopAll(false)
		}
		return turn, fmt.Errorf("工具结果提交失败；执行收据已保留，请恢复会话：%w", err)
	}
	*e = *candidate
	return turn, nil
}

func parallelToolBatchEnd(calls []ToolCall, start int) int {
	seen := map[int]bool{}
	end := start
	for end < len(calls) {
		call := calls[end]
		var err error
		call, err = canonicalTerminalCall(call)
		if err != nil {
			break
		}
		// 搜索彼此独立、只读，和 Shell 调用一样并行（每项最多一分钟）。
		if call.Function.Name == "web_search" {
			end++
			continue
		}
		if !IsShellTool(call.Function.Name) {
			break
		}
		var scheduling struct {
			Parallel  *bool `json:"parallel"`
			SessionID int   `json:"session_id"`
		}
		if json.Unmarshal([]byte(call.Function.Arguments), &scheduling) != nil || scheduling.Parallel != nil && !*scheduling.Parallel {
			break
		}
		if call.Function.Name != "exec_command" {
			if scheduling.SessionID <= 0 || seen[scheduling.SessionID] {
				break
			}
			seen[scheduling.SessionID] = true
		}
		end++
	}
	return max(start+1, end)
}

func interruptedToolTurn(intent ToolIntent, receipts map[string]ToolReceipt) (ToolTurn, error) {
	turn := ToolTurn{InvocationID: intent.InvocationID, Messages: []Message{intent.Response}}
	for _, call := range intent.Response.ToolCalls {
		key := intent.InvocationID + ":" + call.ID
		receipt, ok := receipts[key]
		if !ok {
			r := shellFailure("interrupted_unknown", "调用在结果提交前中断，是否产生副作用尚不确定；先检查执行记录与实际文件，不自动重跑")
			r.State = "interrupted_unknown"
			data, _ := json.Marshal(r)
			receipt = ToolReceipt{Key: key, ToolName: call.Function.Name, ArgumentHash: ToolArgumentHash(call), Output: string(data)}
		}
		if receipt.ArgumentHash != ToolArgumentHash(call) {
			return turn, fmt.Errorf("中断工具收据与调用参数不匹配")
		}
		turn.Receipts = append(turn.Receipts, receipt)
		turn.Messages = append(turn.Messages, Message{Role: RoleTool, ToolCallID: call.ID, Name: call.Function.Name, Content: receipt.Output, Images: receipt.Images})
	}
	return turn, ValidateToolTurn(turn)
}

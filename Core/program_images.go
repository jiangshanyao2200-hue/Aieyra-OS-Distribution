// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: programImageRun; programImageConfiguration; programImages
// Impact: python -B scripts/code-atlas.py show Core/program_images.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

// The canvas uses the existing image batch service. The host only keeps the
// cancellable in-flight request; durable results remain in the shared batch store.
import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"slices"
	"strings"
)

type programImageRun struct {
	cancel context.CancelFunc
	done   chan struct{}
}

func programImageConfiguration(choice imageGenChoice) string {
	value, _ := json.Marshal([]string{choice.ProfileID, choice.Model, choice.baseURL, choice.apiKey})
	digest := sha256.Sum256(value)
	return hex.EncodeToString(digest[:])
}

func (h *WorkspaceHost) programImages(ctx context.Context, raw json.RawMessage) (any, error) {
	if h.mode != HostOS || h.terminal {
		return nil, fmt.Errorf("画布生图仅在 OS 中可用")
	}
	var args imageBatchArgs
	if err := json.Unmarshal(raw, &args); err != nil {
		return nil, err
	}
	if args.Action == "models" {
		choice := resolveImageGenChoice(h.config)
		return map[string]any{"ok": true, "configured": choice.Ready, "model": choice.Model, "profile_id": choice.ProfileID, "reason": choice.Reason, "revision": programImageConfiguration(choice)}, nil
	}
	var binding struct {
		ExpectedConfiguration string `json:"expected_configuration"`
	}
	_ = json.Unmarshal(raw, &binding)
	if args.Action == "create" && binding.ExpectedConfiguration != "" && binding.ExpectedConfiguration != programImageConfiguration(resolveImageGenChoice(h.config)) {
		return nil, fmt.Errorf("图像模型连接已变化，请重新核对原任务")
	}
	id := args.BatchID
	if args.Action == "create" || args.Action == "generate" {
		id = args.RequestID
	}
	if !strings.HasPrefix(id, "canvas-") || !imageBatchID.MatchString(id) {
		return nil, fmt.Errorf("画布批次需要稳定的 canvas- 请求编号")
	}
	h.mu.Lock()
	if args.Action == "cancel" {
		run := h.programImageRuns[id]
		if run != nil {
			run.cancel()
		}
		h.mu.Unlock()
		return map[string]any{"ok": true, "batch_id": id, "cancelling": run != nil}, nil
	}
	if h.closed || h.updateFrozen {
		h.mu.Unlock()
		return nil, fmt.Errorf("OS 正在退出或更新")
	}
	h.mu.Unlock()
	manager, err := h.conversationManager()
	if err != nil {
		return nil, err
	}
	contact, err := manager.readContact(programContactID("workspace"))
	if err != nil {
		return nil, err
	}
	if contact.Defaults == nil || !slices.Contains(contact.Defaults.Tools, "image_gen") {
		return nil, fmt.Errorf("画布 Agent 的生图工具已停用")
	}
	owner := contact.ID
	if _, sessions, err := manager.liveContact(contact.ID); err == nil && len(sessions) > 0 {
		owner = sessions[0].ID
	}
	ctx = context.WithValue(ctx, imageGenTaskKey{}, owner)
	if args.Action == "status" || args.Action == "create" {
		return runImageGen(ctx, h.config, raw)
	}
	if args.Action != "run" && args.Action != "generate" && args.Action != "recover" {
		return nil, fmt.Errorf("未知画布图片操作")
	}
	h.mu.Lock()
	if h.closed || h.updateFrozen {
		h.mu.Unlock()
		return nil, fmt.Errorf("OS 正在退出或更新")
	}
	if h.programImageRuns == nil {
		h.programImageRuns = map[string]*programImageRun{}
	}
	if h.programImageRuns[id] != nil {
		h.mu.Unlock()
		return nil, fmt.Errorf("原图片批次正在执行，请查询状态")
	}
	runCtx, cancel := context.WithCancel(ctx)
	run := &programImageRun{cancel: cancel, done: make(chan struct{})}
	h.programImageRuns[id] = run
	h.mu.Unlock()
	defer func() { cancel(); h.mu.Lock(); delete(h.programImageRuns, id); close(run.done); h.mu.Unlock() }()
	return runImageGen(runCtx, h.config, raw)
}

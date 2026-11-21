// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: startupCompressionThreshold; startupCompactTimeout; startStartupLocked; startupArchive; startupHistoryDigest; prepareStartup; finishStartup; startupBoundary; awaitStartup; startupStatusLocked; recordStartupUsage; startupCompactCut
// Impact: python -B scripts/code-atlas.py show Core/workspace_startup.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

const startupCompressionThreshold = 100000
const startupCompactTimeout = 30 * time.Second

// Capture the old prefix before dispatch, then release the archive while the
// provider works. Only the request owner may commit a checkpoint at a boundary.
func (w *Workspace) startStartupLocked(settings *Settings, retry bool) {
	if w.startupDeferred {
		return
	}
	if w.fastMemoryOn(settings, WorkspaceMatrix) {
		// PAC loads synchronously at the main request boundary. Never hide an
		// uncommitted prefix while a background model is preparing it.
		w.startupPrepared, w.startupStarted = true, true
		return
	}
	if w.startupPrepared || w.startupStarted && !retry {
		return
	}
	if err := w.manager.admitFixedRole(context.Background(), WorkspaceMatrix); err != nil {
		w.startupError = w.manager.redact(err.Error())
		return
	}
	if w.startupCancel != nil {
		w.startupCancel()
	}
	w.startupEpoch++
	epoch := w.startupEpoch
	w.startupStarted = true
	w.startupError = ""
	// A retry prepares the same startup prefix, never newer user work.
	var err error
	restored := w.startupHistory
	if restored == nil {
		w.startupSource = w.state.Roles[WorkspaceMatrix]
		restored, err = w.startupArchive(w.startupSource)
		w.startupHistory = restored
	}
	w.startupCount = 0
	w.startupDigest = ""
	if restored != nil {
		w.startupCount = len(restored.Messages)
		w.startupDigest = startupHistoryDigest(restored.Messages)
	}
	done := make(chan struct{})
	w.startupDone = done
	if err != nil {
		w.startupError = w.manager.redact(err.Error())
		close(done)
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), startupCompactTimeout)
	ctx = withoutRequestRetry(WithProviderSession(ctx, w.state.ID))
	w.startupCancel = cancel
	w.startupWorkers++
	w.greetingWG.Add(1)
	go func() {
		defer w.greetingWG.Done()
		defer cancel()
		_, err := w.prepareStartup(ctx, settings, epoch)
		w.mu.Lock()
		defer w.mu.Unlock()
		w.startupWorkers--
		if epoch == w.startupEpoch {
			w.startupCancel = nil
			if err != nil {
				w.startupError = w.manager.redact(err.Error())
			}
			w.greeting.Revision++
		}
		close(done)
	}()
}

func (w *Workspace) startupArchive(id string) (*RestoredSession, error) {
	if id == "" {
		return &RestoredSession{}, nil
	}
	if w.Mode().unified() {
		w.manager.mu.Lock()
		job := w.manager.jobs[id]
		var archive *SessionArchive
		if job != nil {
			archive = job.archive
		}
		w.manager.mu.Unlock()
		if archive != nil {
			return archive.read()
		}
		return &RestoredSession{}, nil
	}
	config := filepath.Join(w.manager.dir, "config.json")
	path, err := SessionPath(config, id)
	if err != nil {
		return nil, err
	}
	if _, err = os.Stat(path); os.IsNotExist(err) {
		return &RestoredSession{}, nil
	} else if err != nil {
		return nil, err
	}
	archive, restored, err := RestoreSession(config, id)
	if archive != nil {
		archive.Close()
	}
	return restored, err
}

func startupHistoryDigest(messages []Message) string {
	return fmt.Sprintf("%x", sha256.Sum256(rawJSON(messages)))
}

func (w *Workspace) prepareStartup(ctx context.Context, settings *Settings, epoch uint64) (*Checkpoint, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	w.mu.Lock()
	if epoch != w.startupEpoch || w.closed {
		w.mu.Unlock()
		return nil, context.Canceled
	}
	if w.startupPrepared {
		cp := w.startupCheckpoint
		w.mu.Unlock()
		return cp, nil
	}
	id := w.state.Roles[WorkspaceMatrix]
	restored := w.startupHistory
	usageScope := w.backgroundUsageScopeLocked()
	w.mu.Unlock()
	if restored == nil {
		var err error
		restored, err = w.startupArchive(id)
		if err != nil {
			return nil, err
		}
	}
	previous := restored.Checkpoint
	history := restored.Messages
	if previous != nil {
		history = history[min(previous.Covered, len(history)):]
	}
	if len(history) == 0 || compactSourceTokens(previous, history) <= startupCompressionThreshold {
		return w.finishStartup(epoch, previous)
	}
	w.mu.Lock()
	if ctx.Err() != nil || epoch != w.startupEpoch || w.closed {
		w.mu.Unlock()
		return nil, context.Canceled
	}
	w.greeting.Revision++
	w.mu.Unlock()
	snapshot := compactionSettings(settings)
	// Bound each provider input at a complete message/tool boundary. This also
	// handles older archives whose uncompressed tail exceeds the selected model.
	limit := min(96000, max(1024, (snapshot.ContextBudget().InputLimit()-8192)/2))
	cp := previous
	for {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		cut := startupCompactCut(history, limit)
		if len(history) > 0 && cut == 0 {
			return nil, fmt.Errorf("历史中的单条消息或工具批次超过整理窗口；原始记录已保留")
		}
		next, compactErr := Compact(ctx, cp, history[:cut], func(c context.Context, req []Message) (Message, string, error) {
			if EstimateMessages(req) > snapshot.ContextBudget().InputLimit() {
				return Message{}, "", fmt.Errorf("启动整理超出模型窗口；原始记录已保留")
			}
			started := time.Now()
			uCtx := withoutRequestRetry(c)
			answer, usage, e := completeAgent(uCtx, New(snapshot), snapshot, req, nil)
			w.recordStartupUsage(usageScope, snapshot, "startup_compact", time.Since(started), usage, req, answer)
			return answer, answer.FinishReason, e
		})
		if compactErr != nil {
			return nil, compactErr
		}
		next.Plan = ClonePlan(restored.Plan.State)
		next.Compression = &ContextCompression{BeforeTokens: compactSourceTokens(cp, history[:cut]), AfterTokens: EstimateMessages([]Message{next.Message()})}
		cp, history = next, history[cut:]
		if len(history) == 0 {
			break
		}
	}
	return w.finishStartup(epoch, cp)
}

func (w *Workspace) finishStartup(epoch uint64, cp *Checkpoint) (*Checkpoint, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if epoch != w.startupEpoch || w.closed {
		return nil, context.Canceled
	}
	w.startupPrepared, w.startupCheckpoint = true, cp
	return cp, nil
}

// A copy is sampled once per request. Finishing compact cannot mutate an
// in-flight request; the original prefix stays available to bounded recall.
func (w *Workspace) startupBoundary(id string, history []Message, current *Checkpoint) (*Checkpoint, int, bool) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if id != w.startupSource || w.startupCount == 0 || len(history) < w.startupCount || startupHistoryDigest(history[:w.startupCount]) != w.startupDigest {
		return current, 0, false
	}
	cp := w.startupCheckpoint
	if !w.startupPrepared {
		return current, w.startupCount, true
	}
	if cp != nil && (current == nil || cp.Covered > current.Covered) {
		var clone Checkpoint
		_ = json.Unmarshal(rawJSON(cp), &clone)
		return &clone, 0, false
	}
	return current, 0, false
}

func (w *Workspace) awaitStartup(ctx context.Context) any {
	announced := false
	for {
		w.mu.Lock()
		done, epoch := w.startupDone, w.startupEpoch
		if w.closed || ctx.Err() != nil {
			w.mu.Unlock()
			return map[string]any{"ok": false, "error": "历史等待已取消"}
		}
		if done == nil {
			w.mu.Unlock()
			return map[string]any{"ok": false, "notice": "没有后台历史任务；仅使用实际记忆或 memory recall 可读取的记录。"}
		}
		w.mu.Unlock()
		select {
		case <-done:
		default:
			if !announced {
				w.recordOutput(WorkspaceMatrix, "等我先想想。", "commentary")
				announced = true
			}
		}
		select {
		case <-done:
		case <-ctx.Done():
			return map[string]any{"ok": false, "error": ctx.Err().Error()}
		}
		w.mu.Lock()
		if epoch != w.startupEpoch {
			w.mu.Unlock()
			continue
		}
		err, ready := w.startupError, w.startupPrepared
		w.mu.Unlock()
		if err != "" || !ready {
			return map[string]any{"ok": false, "error": err, "notice": runtimePrompt("Matrix/辅助指令/历史整理失败.txt")}
		}
		return map[string]any{"ok": true, "ready": true, "notice": runtimePrompt("Matrix/辅助指令/后台历史就绪.txt")}
	}
}

func (w *Workspace) startupStatusLocked() map[string]any {
	state := "pending"
	if w.startupPrepared {
		state = "ready"
	} else if w.startupError != "" {
		state = "failed"
	}
	return map[string]any{"state": state, "error": w.startupError}
}

func (w *Workspace) recordStartupUsage(scope string, settings *Settings, kind string, duration time.Duration, usage *Usage, input []Message, output Message) {
	w.mu.Lock()
	defer w.mu.Unlock()
	// Charge even if the user cancels or replaces the connection during a call.
	w.recordBackgroundUsageLocked(scope, settings, estimateUsage(agentUsage(len(w.greetingUsage)+1, kind, duration, usage), input, output))
}

func startupCompactCut(messages []Message, limit int) int {
	pending := map[string]bool{}
	cut, tokens := 0, 0
	for i, m := range messages {
		tokens += EstimateMessages([]Message{m})
		if tokens > limit {
			break
		}
		for _, call := range m.ToolCalls {
			pending[call.ID] = true
		}
		if m.Role == RoleTool {
			delete(pending, m.ToolCallID)
		}
		if len(pending) == 0 {
			cut = i + 1
		}
	}
	return cut
}

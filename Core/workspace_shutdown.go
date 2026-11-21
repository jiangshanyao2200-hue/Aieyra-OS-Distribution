// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: beginShutdown; shutdownStatus
// Impact: python -B scripts/code-atlas.py show Core/workspace_shutdown.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import "sync"

// Keep HTTP and native bridges alive until every workspace has cancelled its
// workers and saved/finished its station. A poll never holds the RPC for the
// sum of up to sixteen independent station timeouts.
func (h *WorkspaceHost) beginShutdown() <-chan struct{} {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.shutdownDone != nil {
		return h.shutdownDone
	}
	h.closed = true
	h.shutdownDone = make(chan struct{})
	h.shutdownErrors = make(map[string]string)
	conversations := h.conversations
	imageRuns := make([]*programImageRun, 0, len(h.programImageRuns))
	for _, run := range h.programImageRuns {
		run.cancel()
		imageRuns = append(imageRuns, run)
	}
	workspaces := make(map[string]*Workspace, len(h.workspaces))
	for id, w := range h.workspaces {
		workspaces[id] = w
	}
	go func() {
		var waiting sync.WaitGroup
		for id, w := range workspaces {
			waiting.Add(1)
			go func(id string, w *Workspace) {
				defer waiting.Done()
				if err := w.stop(); err != nil {
					// Keep private paths/bodies out of the host receipt.
					code := err.Error()
					if !stationErrorCode.MatchString(code) {
						code = "station_finish_unconfirmed"
					}
					h.mu.Lock()
					h.shutdownErrors[id] = code
					h.mu.Unlock()
				}
			}(id, w)
		}
		waiting.Wait()
		for _, run := range imageRuns {
			<-run.done
		}
		if conversations != nil {
			conversations.Close()
		}
		// 工位保存和任务清理仍使用共享服务；收齐之后再等待本次 helper 退出。
		if err := h.service.closeResult(); err != nil {
			h.mu.Lock()
			h.shutdownErrors["settings_service"] = err.Error()
			h.mu.Unlock()
		}
		close(h.shutdownDone)
	}()
	return h.shutdownDone
}

func (h *WorkspaceHost) shutdownStatus() map[string]any {
	done := h.beginShutdown()
	phase := "stopping"
	select {
	case <-done:
		phase = "stopped"
	default:
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	failures := make(map[string]string, len(h.shutdownErrors))
	for id, code := range h.shutdownErrors {
		failures[id] = code
	}
	return map[string]any{"phase": phase, "failures": failures}
}

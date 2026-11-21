// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: transcriptEnvelope; transcriptOutboxDirectory; transcribe; transcriptObserver; transcribeAt; drainTranscript; flushTranscript
// Impact: python -B scripts/code-atlas.py show Core/workspace_transcript_outbox.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

type transcriptEnvelope struct {
	Project string          `json:"project"`
	Session string          `json:"session"`
	Rows    []transcriptRow `json:"rows"`
}

func (w *Workspace) transcriptOutboxDirectory() string {
	// Session runtime directories are removed on normal close and stale-runtime
	// cleanup. Pending originals must outlive both, including a new workspace ID.
	if w.privateAgentScope {
		return filepath.Join(w.service.memoryDirectory, "transcript-outbox")
	}
	return filepath.Join(PrivatePaths(w.config).Memory, "transcript-outbox")
}

// Originals reach this durable outbox before asynchronous SQLite writes. Failed
// or interrupted commits remain here and replay idempotently on the next run.
// Only this workspace's files are read, never the production database directly.
func (w *Workspace) transcribe(rows []transcriptRow) {
	if w == nil {
		return
	}
	w.mu.Lock()
	session, workdir := w.state.ID, w.state.Workdir
	w.mu.Unlock()
	w.transcribeAt(session, workdir, rows)
}

// Capture immutable routing before attaching the observer. Archive.Append can
// run under w.mu while draining user supplements; its synchronous callback must
// never reacquire the workspace lock (or reverse the archive/workspace order).
func (w *Workspace) transcriptObserver(key string, redact func(string) string) func(int, []Message) {
	w.mu.Lock()
	session, workdir := w.state.ID, w.state.Workdir
	w.mu.Unlock()
	return func(pos int, messages []Message) {
		w.transcribeAt(session, workdir, transcriptRows(key, pos, messages, redact))
	}
}

func (w *Workspace) transcribeAt(session, workdir string, rows []transcriptRow) {
	if w == nil || w.service == nil {
		return
	}
	if settings, err := Load(w.config); err == nil && !settings.MemoryEnabled {
		return
	}
	f := &w.fast
	f.mu.Lock()
	defer f.mu.Unlock()
	// Retain new observations even when the durable directory cannot be read.
	f.queue = append(f.queue, rows...)
	dir := w.transcriptOutboxDirectory()
	if !f.loaded {
		entries, err := os.ReadDir(dir)
		if err != nil && !os.IsNotExist(err) {
			f.writeError = "原文待写队列读取失败"
			return
		}
		for _, entry := range entries {
			if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".json") {
				f.outbox = append(f.outbox, filepath.Join(dir, entry.Name()))
			}
		}
		sort.Strings(f.outbox)
		f.loaded = true
	}
	for len(f.queue) > 0 {
		batch := f.queue[:min(128, len(f.queue))]
		env := transcriptEnvelope{Project: w.memoryProject(workdir), Session: session, Rows: batch}
		data, err := json.Marshal(env)
		if err == nil {
			err = os.MkdirAll(dir, 0700)
		}
		name := fmt.Sprintf("%020d-%s.json", batch[0].At, workspaceHash(data))
		file := filepath.Join(dir, name)
		queued := false
		for _, pending := range f.outbox {
			if pending == file {
				queued = true
				break
			}
		}
		// Names are content hashes: an existing file already holds these exact
		// rows. Rewriting it races the drain reading it (Windows denies rename
		// over an open file) and would leave a permanent write error.
		if err == nil && !queued {
			if _, e := os.Stat(file); e != nil {
				err = atomicWorkspaceFile(dir, name, data)
			}
		}
		if err != nil {
			f.writeError = "原文暂存写入失败；原文仍保留在当前会话"
			break
		}
		if !queued {
			f.outbox = append(f.outbox, file)
		}
		f.queue = f.queue[len(batch):]
	}
	if f.running || len(f.outbox) == 0 {
		return
	}
	f.running = true
	f.drained = make(chan struct{})
	go w.drainTranscript()
}

func (w *Workspace) drainTranscript() {
	f := &w.fast
	stopLocked := func() { f.running = false; close(f.drained) }
	attempted := map[string]bool{}
	failed := false
	for {
		f.mu.Lock()
		file := ""
		for _, pending := range f.outbox {
			if !attempted[pending] {
				file = pending
				break
			}
		}
		if file == "" {
			if failed {
				f.writeError = "部分原文数据库提交未完成；已保留待写文件，其余原文继续保存"
			} else if len(f.queue) == 0 {
				f.writeError = ""
			}
			stopLocked()
			f.mu.Unlock()
			return
		}
		// One bad batch cannot hold back later sessions. Keep failures intact,
		// try every other batch once, then retry on the next observer/flush.
		attempted[file] = true
		f.mu.Unlock()
		data, err := os.ReadFile(file)
		// Another OS window may already have committed this shared durable file.
		acknowledged := os.IsNotExist(err)
		var env transcriptEnvelope
		if err == nil {
			err = json.Unmarshal(data, &env)
		}
		if err == nil && (env.Session == "" || env.Project == "" || len(env.Rows) == 0) {
			err = fmt.Errorf("invalid transcript outbox")
		}
		if err == nil {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			raw, e := w.service.CallTool(ctx, "memory", env.Session, rawJSON(map[string]any{"action": "transcript_append", "_project": env.Project, "rows": env.Rows}))
			_, err = memoryResult(raw, e)
			cancel()
		}
		if err == nil {
			err = os.Remove(file)
			if os.IsNotExist(err) {
				err = nil
			}
		} // acknowledged, owned outbox file only
		if acknowledged {
			err = nil
		}
		f.mu.Lock()
		if err != nil {
			failed = true
			f.mu.Unlock()
			continue
		}
		for i, pending := range f.outbox {
			if pending == file {
				f.outbox = append(f.outbox[:i], f.outbox[i+1:]...)
				break
			}
		}
		// A duplicate observer write can recreate the same content-named file
		// after this commit. Only failures are skipped for the rest of the pass.
		delete(attempted, file)
		f.mu.Unlock()
	}
}

func (w *Workspace) flushTranscript(limit time.Duration) {
	w.transcribe(nil)
	f := &w.fast
	f.mu.Lock()
	running, drained := f.running, f.drained
	f.mu.Unlock()
	if running {
		select {
		case <-drained:
		case <-time.After(limit):
		}
	}
}

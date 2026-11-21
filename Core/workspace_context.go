// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: eyraContextSession; contextStatistics; eyraContextBook; SessionIdentity; contextCleaning; contextDirectory; contextSessionLocked; loadContextBookLocked; contextArchivePath; saveContextBookLocked; persistContextChatLocked; contextArchiveLocked; contextIdleLocked; contextSourceLocked; contextEditableText; contextViewLocked; activateContextLocked; beginContextBookLocked; contextMutateLocked; contextCall; startContextCleaningLocked; compactionViewLocked
// Impact: python -B scripts/code-atlas.py show Core/workspace_context.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"github.com/aieyra/aieyra-os/CORE/sessionservice"
	contextport "github.com/aieyra/aieyra-os/contracts/context"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"
)

// The host identity stays fixed. Conversation identity and archive versions
// change only at an idle boundary, after the new durable pointer is committed.
type eyraContextSession struct {
	ID              string                `json:"id"`
	Title           string                `json:"title"`
	Archive         string                `json:"archive"`
	Memory          bool                  `json:"memory"`
	Created         string                `json:"created"`
	Messages        []workspaceMessage    `json:"messages"`
	RepairEpoch     uint64                `json:"repair_epoch,omitempty"`
	AskRequests     []WorkspaceAskRequest `json:"ask_requests,omitempty"`
	Versions        []string              `json:"versions,omitempty"`
	VersionMemory   map[string]bool       `json:"version_memory,omitempty"`
	Statistics      *contextStatistics    `json:"statistics,omitempty"`
	Models          map[string]string     `json:"models,omitempty"`
	BackgroundUsage map[string]any        `json:"background_usage,omitempty"`
}

type contextStatistics struct {
	Archive string         `json:"archive"`
	Context *AgentContext  `json:"context,omitempty"`
	Usage   map[string]any `json:"usage,omitempty"`
}
type eyraContextBook = sessionservice.Catalog[eyraContextSession]

func (s eyraContextSession) SessionIdentity() sessionservice.Identity {
	return sessionservice.Identity{ID: s.ID, Archive: s.Archive, Versions: s.Versions}
}

type contextCleaning struct {
	ID     string `json:"id"`
	State  string `json:"state"`
	Source string `json:"source"`
	Text   string `json:"text,omitempty"`
	Error  string `json:"error,omitempty"`
	Usage  *Usage `json:"usage,omitempty"`
	cancel context.CancelFunc
}

func (w *Workspace) contextDirectory() string {
	if w.contextRoot != "" {
		return w.contextRoot
	}
	sum := sha256.Sum256([]byte(filepath.Clean(w.state.Workdir)))
	return filepath.Join(PrivatePaths(w.config).Context, "eyra", fmt.Sprintf("%x", sum[:12]))
}
func (w *Workspace) contextSessionLocked() *eyraContextSession {
	if w.contextBook != nil {
		for i := range w.contextBook.Sessions {
			if w.contextBook.Sessions[i].ID == w.contextBook.Active {
				return &w.contextBook.Sessions[i]
			}
		}
	}
	return nil
}
func (w *Workspace) loadContextBookLocked() error {
	if !w.Mode().unified() || w.split != nil {
		return nil
	}
	if err := w.resolveContextDirectory(); err != nil {
		return err
	}
	// CLI shares the relocated project identity without loading or leasing the
	// desktop's selected conversation.
	if w.Mode() != HostOS {
		return nil
	}
	file := filepath.Join(w.contextDirectory(), "sessions.json")
	// Take the owner lease before reading the selected archive pointer.
	if _, err := os.Lstat(file); os.IsNotExist(err) {
		return nil
	} else if err != nil {
		return err
	}
	unlock, err := lockSession(filepath.Join(w.contextDirectory(), ".owner.lock"))
	if err != nil {
		return fmt.Errorf("会话已在另一主窗口中打开: %w", err)
	}
	book, digest, err := sessionservice.LoadCatalog[eyraContextSession](w.contextDirectory())
	if err != nil {
		unlock()
		return err
	}
	w.contextUnlock, w.contextBook, w.contextCatalogDigest = unlock, book, digest
	s := w.contextSessionLocked()
	if _, err = os.Stat(w.contextArchivePath(s.Archive)); err != nil {
		unlock()
		w.contextUnlock = nil
		w.contextBook = nil
		return err
	}
	if err = os.MkdirAll(filepath.Join(w.contextDirectory(), "workflow-"+s.Archive), 0700); err != nil {
		unlock()
		w.contextUnlock = nil
		w.contextBook = nil
		return err
	}
	restored, err := (&SessionArchive{Path: w.contextArchivePath(s.Archive), attachmentConfig: w.config}).read()
	if err != nil {
		unlock()
		w.contextUnlock, w.contextBook = nil, nil
		return err
	}
	if err = validateSessionContextProvider(s.ID, restored, w.config); err != nil {
		unlock()
		w.contextUnlock = nil
		w.contextBook = nil
		return err
	}

	w.activateContextLocked(s, restored)
	// A first greeting can now own a durable empty conversation. Preserve the
	// clean-close screen without turning restored accounting into a new request.
	if len(s.Messages) == 0 && len(restored.Messages) == 0 {
		w.resumeRecentReopen(0)
	}
	for i := range w.state.Messages {
		if workspacePendingInput(w.state.Messages[i]) {
			w.state.Messages[i].State = "interrupted"
		}
	}
	return nil
}
func (w *Workspace) contextArchivePath(id string) string {
	return filepath.Join(w.contextDirectory(), id+".jsonl")
}
func (w *Workspace) saveContextBookLocked(book *eyraContextBook) error {
	digest, err := sessionservice.CommitCatalog(w.contextDirectory(), book, w.contextCatalogDigest)
	if err == nil {
		w.contextCatalogDigest = digest
	}
	return err
}
func (w *Workspace) persistContextChatLocked() error {
	s := w.contextSessionLocked()
	if s == nil {
		return nil
	}
	prior, priorStats, priorModels, priorAsks := s.Messages, s.Statistics, s.Models, s.AskRequests
	s.Messages = append([]workspaceMessage{}, w.state.Messages...)
	s.AskRequests = cloneWorkspaceAsks(w.state.AskRequests)
	s.Models = cloneWorkspaceModels(w.state.Models)
	if id := w.state.Roles[WorkspaceMatrix]; id != "" {
		if row, e := w.manager.workspaceRoleStatus(w.state.ID, id); e == nil {
			context, _ := row["context"].(*AgentContext)
			usage, _ := row["usage"].(map[string]any)
			s.Statistics = &contextStatistics{Archive: s.Archive, Context: context, Usage: mergeWorkspaceUsage(w.contextUsageBase, usage)}
		}
	}
	if err := w.saveContextBookLocked(w.contextBook); err != nil {
		s.Messages = prior
		s.Statistics = priorStats
		s.Models = priorModels
		s.AskRequests = priorAsks
		return err
	}
	return nil
}
func (w *Workspace) contextArchiveLocked() (*SessionArchive, error) {
	w.manager.mu.Lock()
	job := w.manager.jobs[w.state.Roles[WorkspaceMatrix]]
	var active *SessionArchive
	if job != nil {
		active = job.archive
	}
	w.manager.mu.Unlock()
	if s := w.contextSessionLocked(); s != nil {
		if active != nil && active.Path == w.contextArchivePath(s.Archive) {
			return active, nil
		}
		return &SessionArchive{Path: w.contextArchivePath(s.Archive), attachmentConfig: w.config}, nil
	}
	if active != nil {
		return active, nil
	}
	return &SessionArchive{ephemeral: true}, nil
}
func (w *Workspace) contextIdleLocked() error {
	if w.closed || w.updateFrozen {
		return fmt.Errorf("主窗口正在关闭或升级")
	}
	w.manager.mu.Lock()
	defer w.manager.mu.Unlock()
	for _, id := range w.state.Roles {
		job := w.manager.jobs[id]
		if job == nil {
			continue
		}
		if activeAgent(job.record.State) {
			return fmt.Errorf("请先停止当前任务，再修改或切换上下文")
		}
		if job.done != nil {
			select {
			case <-job.done:
			default:
				return fmt.Errorf("任务正在收尾，请稍后重试")
			}
		}
	}
	for _, m := range w.state.Messages {
		if workspaceChatInput(m) && workspacePendingInput(m) {
			return fmt.Errorf("仍有待处理消息，请先发送完成或撤回")
		}
	}
	return nil
}
func (w *Workspace) contextSourceLocked() (*RestoredSession, string, error) {
	a, err := w.contextArchiveLocked()
	if err != nil {
		return nil, "", err
	}
	r, err := a.read()
	if err != nil {
		return nil, "", err
	}
	id, revision := w.state.ID, uint64(0)
	if w.contextBook != nil {
		id = w.contextBook.Active
		revision = w.contextBook.Revision
	}
	digest := sha256.Sum256(rawJSON([]any{id, revision, w.state.Revision, r.Messages, r.Checkpoint, r.Plan.State, r.ContextProvider}))
	return r, fmt.Sprintf("%x", digest), nil
}
func contextEditableText(r *RestoredSession) string {
	var parts []string
	start := 0
	if r.Checkpoint != nil {
		parts = append(parts, r.Checkpoint.Message().Content)
		start = min(r.Checkpoint.Covered, len(r.Messages))
	}
	for _, m := range r.Messages[start:] {
		if m.Content != "" {
			parts = append(parts, "["+string(m.Role)+"]\n"+m.Content)
		}
		if len(m.ToolCalls) > 0 {
			parts = append(parts, string(rawJSON(m.ToolCalls)))
		}
		if len(m.Images) > 0 {
			parts = append(parts, fmt.Sprintf("[图片附件 %d 张，原档案保留]", len(m.Images)))
		}
	}
	return strings.Join(parts, "\n\n")
}
func (w *Workspace) contextViewLocked() (any, error) {
	r, digest, err := w.contextSourceLocked()
	if err != nil {
		return nil, err
	}
	items := []map[string]any{}
	active := w.state.ID
	if w.contextBook != nil {
		active = w.contextBook.Active
		for _, s := range w.contextBook.Sessions {
			items = append(items, map[string]any{"id": s.ID, "title": s.Title, "created": s.Created, "versions": len(s.Versions)})
		}
	} else {
		items = append(items, map[string]any{"id": active, "title": "当前对话", "versions": 0})
	}
	var clean *contextCleaning
	if w.contextClean != nil {
		value := *w.contextClean
		clean = &value
	}
	busy := w.contextIdleLocked() != nil
	provider, err := w.contextProviderView(r)
	if err != nil {
		return nil, err
	}
	text := contextEditableText(r)
	return map[string]any{"ok": true, "revision": w.state.Revision, "session_id": active, "sessions": items, "source": digest, "text": utf8Prefix(text, 256<<10), "text_truncated": len(text) > 256<<10, "message_count": len(r.Messages), "checkpoint": r.Checkpoint, "compaction": w.compactionViewLocked(), "plan": r.Plan.State, "auto_memory": !w.contextMemoryOff.Load(), "busy": busy, "cleaning": clean, "provider": provider}, nil
}
func (w *Workspace) activateContextLocked(s *eyraContextSession, restored *RestoredSession) {
	w.state.Models = cloneWorkspaceModels(s.Models)
	w.contextUsageBase = nil
	if s.Statistics != nil {
		w.contextUsageBase = mergeWorkspaceUsage(s.Statistics.Usage)
	}
	w.identity = nil
	w.compaction = &contextCompaction{last: cloneCompaction(restored.Compaction)}
	if w.greetingCancel != nil {
		w.greetingCancel()
		w.greetingCancel = nil
	}
	if w.startupCancel != nil {
		w.startupCancel()
		w.startupCancel = nil
	}
	w.greetingEpoch++
	w.startupEpoch++
	w.greeting = WorkspaceGreeting{State: "skipped", Revision: w.greeting.Revision + 1}
	w.startupPrepared, w.startupStarted = true, true
	w.startupCheckpoint, w.startupHistory = nil, nil
	w.startupSource, w.startupDigest, w.startupError = "", "", ""
	w.startupCount, w.priorGeneration = 0, 0
	w.state.Roles = map[string]string{}
	w.state.Messages = append([]workspaceMessage{}, s.Messages...)
	w.state.AskRequests = cloneWorkspaceAsks(s.AskRequests)
	w.state.HistorySegment, w.state.HistoryAfter = s.Archive, ""
	w.workflowPlan = nil
	w.workflowAgent = ""
	w.workflowGeneration = 0
	w.live = map[string]WorkspaceLive{}
	w.turnFiles = nil
	w.contextMemoryOff.Store(!s.Memory)
	w.epoch = workspaceID()
	w.state.Revision++
}

// Snapshot the unmodified legacy archive on the first user mutation or incurred
// startup cost. Merely opening settings does not enable persistence.
func (w *Workspace) beginContextBookLocked() error {
	if w.contextBook != nil {
		return nil
	}
	dir := w.contextDirectory()
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	unlock, err := lockSession(filepath.Join(dir, ".owner.lock"))
	if err != nil {
		return err
	}
	a, err := w.contextArchiveLocked()
	if err != nil {
		unlock()
		return err
	}
	a.mu.Lock()
	data := append([]byte(nil), a.memory...)
	a.mu.Unlock()
	id := workspaceID()
	if err = atomicWorkspaceFile(dir, id+".jsonl", data); err != nil {
		unlock()
		return err
	}
	book := &eyraContextBook{Version: 1, Revision: 1, Active: id, Sessions: []eyraContextSession{{ID: id, Archive: id, Title: "此前对话", Memory: true, Created: time.Now().UTC().Format(time.RFC3339), Messages: append([]workspaceMessage{}, w.state.Messages...)}}}
	book.Sessions[0].Models = cloneWorkspaceModels(w.state.Models)
	book.Sessions[0].AskRequests = cloneWorkspaceAsks(w.state.AskRequests)
	book.Sessions[0].BackgroundUsage = workspaceUsage(w.greetingUsage)
	if err = os.MkdirAll(filepath.Join(dir, "workflow-"+id), 0700); err != nil {
		unlock()
		return err
	}
	if err = w.saveContextBookLocked(book); err != nil {
		unlock()
		return err
	}
	w.contextBook, w.contextUnlock = book, unlock
	w.initialContextID = id
	// Existing execution is idle; subsequent appends use the durable archive.
	w.manager.mu.Lock()
	if job := w.manager.jobs[w.state.Roles[WorkspaceMatrix]]; job != nil {
		job.archive = &SessionArchive{Path: w.contextArchivePath(id), attachmentConfig: w.config}
	}
	w.manager.mu.Unlock()
	return nil
}
func (w *Workspace) contextMutateLocked(action, source, text, title, id string, memory bool) (any, error) {
	if err := w.contextIdleLocked(); err != nil {
		return nil, err
	}
	original, current, err := w.contextSourceLocked()
	if err != nil {
		return nil, err
	}
	if source == "" || source != current {
		return nil, fmt.Errorf("上下文已变化，请重新读取；当前编辑内容已保留")
	}
	if action != "new" && action != "switch" && action != "restore" && !memory && original.ContextProvider != nil {
		p, e := resolveContextProvider(original.ContextProvider.Provider, w.config)
		if e != nil {
			return nil, e
		}
		if p.Describe().Storage == "memory" {
			return nil, fmt.Errorf("请先切换到会话摘要提供者，再关闭记忆")
		}
	}
	if len(text) > 256<<10 || !utf8.ValidString(text) || strings.ContainsRune(text, 0) {
		return nil, fmt.Errorf("上下文须为最多 256 KiB 的 UTF-8 文本")
	}
	if err = w.beginContextBookLocked(); err != nil {
		return nil, err
	}
	var next eyraContextBook
	_ = json.Unmarshal(rawJSON(w.contextBook), &next)
	for i := range next.Sessions {
		if next.Sessions[i].ID == next.Active {
			next.Sessions[i].Messages = append([]workspaceMessage{}, w.state.Messages...)
			next.Sessions[i].AskRequests = cloneWorkspaceAsks(w.state.AskRequests)
		}
	}
	var target *eyraContextSession
	if action == "new" {
		if len(next.Sessions) >= 200 {
			return nil, fmt.Errorf("会话数量已达 200")
		}
		id = workspaceID()
		if strings.TrimSpace(title) == "" {
			title = "新对话 " + time.Now().Format("01-02 15:04")
		}
		next.Sessions = append(next.Sessions, eyraContextSession{ID: id, Title: utf8Prefix(strings.TrimSpace(title), 120), Created: time.Now().UTC().Format(time.RFC3339)})
		next.Active = id
	} else if action == "switch" {
		next.Active = id
	}
	for i := range next.Sessions {
		if next.Sessions[i].ID == next.Active {
			target = &next.Sessions[i]
		}
	}
	if target == nil {
		return nil, fmt.Errorf("会话不存在")
	}
	if action == "switch" {
		if _, err = (&SessionArchive{Path: w.contextArchivePath(target.Archive)}).read(); err != nil {
			return nil, err
		}
	} else if action == "restore" {
		if len(target.Versions) == 0 {
			return nil, fmt.Errorf("没有可恢复的上一个版本")
		}
		last := len(target.Versions) - 1
		previous := target.Versions[last]
		if target.VersionMemory == nil {
			target.VersionMemory = map[string]bool{}
		}
		target.VersionMemory[target.Archive] = target.Memory
		target.Archive, target.Versions[last] = target.Versions[last], target.Archive
		if enabled, ok := target.VersionMemory[previous]; ok {
			target.Memory = enabled
		}
		if _, err = (&SessionArchive{Path: w.contextArchivePath(target.Archive)}).read(); err != nil {
			return nil, err
		}
	} else {
		version := workspaceID()
		a := &SessionArchive{ephemeral: true}
		if action == "edit" && strings.TrimSpace(text) != "" {
			if err = a.Append("message", Message{Role: RoleUser, Name: "user_context", Content: text}); err != nil {
				return nil, err
			}
		}
		if action == "memory" {
			prior, e := os.ReadFile(w.contextArchivePath(target.Archive))
			if e != nil {
				return nil, e
			}
			a.memory = prior
		}
		if action != "new" && action != "memory" && original.ContextProvider != nil {
			view, e := a.read()
			if e != nil {
				return nil, e
			}
			migration := contextProviderMigration{State: *original.ContextProvider, Source: contextProviderSource(view.Messages, view.Checkpoint)}
			if e = a.Append("context_provider", migration); e != nil {
				return nil, e
			}
		}
		if err = atomicWorkspaceFile(w.contextDirectory(), version+".jsonl", a.memory); err != nil {
			return nil, err
		}
		if target.Archive != "" {
			if target.VersionMemory == nil {
				target.VersionMemory = map[string]bool{}
			}
			target.VersionMemory[target.Archive] = target.Memory
			target.Versions = append(target.Versions, target.Archive)
		}
		target.Archive = version
		target.Memory = memory
		if action == "new" {
			target.Messages = []workspaceMessage{}
		}
	}
	next.Revision++
	if err = os.MkdirAll(filepath.Join(w.contextDirectory(), "workflow-"+target.Archive), 0700); err != nil {
		return nil, err
	}
	restored, err := (&SessionArchive{Path: w.contextArchivePath(target.Archive), attachmentConfig: w.config}).read()
	if err != nil {
		return nil, err
	}
	if err = validateSessionContextProvider(target.ID, restored, w.config); err != nil {
		return nil, err
	}
	if err = w.saveContextBookLocked(&next); err != nil {
		return nil, err
	}
	w.contextBook = &next
	w.activateContextLocked(target, restored)
	w.feed.publish(WorkspaceMatrix, "context_changed", map[string]any{"session_id": next.Active, "action": action})
	return w.contextViewLocked()
}

func (w *Workspace) contextCall(ctx context.Context, args json.RawMessage) (any, error) {
	if w.Mode() != HostOS || w.split != nil {
		return nil, fmt.Errorf("上下文管理仅在 Eyra 主对话中可用")
	}
	var p struct {
		Action     string                `json:"action"`
		Source     string                `json:"source"`
		Text       string                `json:"text"`
		Title      string                `json:"title"`
		ID         string                `json:"id"`
		AutoMemory bool                  `json:"auto_memory"`
		Provider   contextport.Reference `json:"provider"`
	}
	if err := json.Unmarshal(args, &p); err != nil {
		return nil, err
	}
	if p.Action == "provider" {
		return w.switchContextProvider(ctx, p.Source, p.Provider)
	}
	if p.Action == "records" {
		var a memoryRow
		if err := json.Unmarshal(args, &a); err != nil {
			return nil, err
		}
		a["action"] = a["memory_action"]
		switch memString(a["action"]) {
		case "search", "read", "update", "forget", "status":
			return memoryResult(w.memory(ctx, a))
		case "packets", "packet", "original", "snapshot", "history":
			return w.pacTool(ctx, a)
		default:
			return nil, fmt.Errorf("未知记忆管理操作")
		}
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	switch p.Action {
	case "", "view":
		return w.contextViewLocked()
	case "status":
		var clean *contextCleaning
		if w.contextClean != nil {
			copy := *w.contextClean
			clean = &copy
		}
		return map[string]any{"ok": true, "revision": w.state.Revision, "busy": w.contextIdleLocked() != nil, "cleaning": clean, "compaction": w.compactionViewLocked()}, nil
	case "new", "switch", "reset", "edit", "restore", "memory":
		return w.contextMutateLocked(p.Action, p.Source, p.Text, p.Title, p.ID, p.AutoMemory)
	case "clean":
		return w.startContextCleaningLocked(p.Source, p.Text)
	case "cancel_clean":
		if w.contextClean != nil && w.contextClean.State == "running" {
			if w.contextClean.cancel != nil {
				w.contextClean.cancel()
			}
			w.contextClean.State = "cancelled"
		}
		return w.contextViewLocked()
	default:
		return nil, fmt.Errorf("未知上下文操作")
	}
}

func (w *Workspace) startContextCleaningLocked(source, instructions string) (any, error) {
	if w.closed || w.updateFrozen {
		return nil, fmt.Errorf("主窗口正在关闭或升级")
	}
	if w.contextClean != nil && w.contextClean.State == "running" {
		return nil, fmt.Errorf("上下文清洗正在运行")
	}
	if err := w.manager.admitFixedRole(context.Background(), WorkspaceMatrix); err != nil {
		return nil, err
	}
	r, digest, err := w.contextSourceLocked()
	if err != nil {
		return nil, err
	}
	if source != "" && source != digest {
		return nil, fmt.Errorf("上下文已变化，请重新读取后清洗")
	}
	_, settings, err := w.modelSettingsLocked(WorkspaceMatrix)
	if err != nil {
		return nil, err
	}
	prompt, err := readPromptResource("Matrix/记忆/上下文清洗.txt")
	if err != nil {
		return nil, err
	}
	// Only explicit cleanup instructions and source data enter this fresh call.
	input := []Message{{Role: RoleSystem, Content: prompt}, {Role: RoleUser, Content: string(rawJSON(map[string]any{"request": instructions, "source_digest": digest, "context": contextEditableText(r)}))}}
	snapshot := compactionSettings(settings)
	// The editable cleanup draft is plain text; ordinary compaction keeps its JSON schema.
	snapshot.ResponseFormat = "text"
	if EstimateMessages(input) > snapshot.ContextBudget().InputLimit() {
		return nil, fmt.Errorf("上下文超过清洗模型窗口，请先在编辑器分段整理；原记录保留")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	ctx = withoutRequestRetry(WithProviderSession(ctx, workspaceID()))
	clean := &contextCleaning{ID: workspaceID(), State: "running", Source: digest, cancel: cancel}
	w.contextClean = clean
	includeMemory := w.service != nil && !w.contextMemoryOff.Load() && settings.MemoryEnabled
	usageScope := w.backgroundUsageScopeLocked()
	w.greetingWG.Add(1)
	go func() {
		defer w.greetingWG.Done()
		defer cancel()
		var answer Message
		var usage *Usage
		var e error
		started := time.Now()
		requested := false
		if includeMemory {
			var memory pacSnapshot
			memory, e = w.readPAC(ctx)
			if e == nil {
				input = append(input, Message{Role: RoleUser, Name: "memory_material", Content: string(rawJSON(memory))})
			}
		}
		if e == nil && EstimateMessages(input) > snapshot.ContextBudget().InputLimit() {
			e = fmt.Errorf("对话和自动带入的记忆超过清洗窗口，请先分段整理")
		}
		if e == nil {
			requested = true
			answer, usage, e = completeAgent(ctx, New(snapshot), snapshot, input, nil)
		}
		w.mu.Lock()
		defer w.mu.Unlock()
		if requested {
			w.recordBackgroundUsageLocked(usageScope, snapshot, estimateUsage(agentUsage(len(w.greetingUsage)+1, "context_clean", time.Since(started), usage), input, answer))
		}
		clean.Usage = usage
		if w.contextClean != clean || clean.State != "running" || w.closed {
			return
		}
		if e != nil {
			clean.State = "failed"
			clean.Error = w.manager.redact(e.Error())
			return
		}
		if ctx.Err() != nil {
			clean.State = "cancelled"
			return
		}
		if answer.FinishReason != "stop" || len(answer.ToolCalls) > 0 || strings.TrimSpace(answer.Content) == "" || len(answer.Content) > 256<<10 {
			clean.State = "failed"
			clean.Error = "清洗结果不完整，原上下文保持"
			return
		}
		clean.State = "ready"
		clean.Text = w.manager.redact(answer.Content)
	}()
	return w.contextViewLocked()
}

func (w *Workspace) compactionViewLocked() *CompactionState {
	if w.compaction == nil {
		return nil
	}
	v := w.compaction.snapshot()
	if compactionPending(v) && w.contextIdleLocked() == nil {
		v.State, v.Code = "interrupted", "PREVIOUS_RUN_INTERRUPTED"
	}
	return v
}

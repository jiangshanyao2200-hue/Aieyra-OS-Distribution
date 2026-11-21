// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: contextProviders; resolveContextProvider; legacyContextProvider; contextProviderMigration; validateSessionContextProvider; contextProviderSource; contextProviderView; hydrateContextCheckpoint; switchContextProvider
// Impact: python -B scripts/code-atlas.py show Core/context_provider.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"fmt"
	contextprovider "github.com/aieyra/aieyra-os/agent/context/contract"
	"github.com/aieyra/aieyra-os/agent/context/structured"
	"github.com/aieyra/aieyra-os/agent/official"
	contextpolicy "github.com/aieyra/aieyra-os/agent/official/Eyra/context"
	contextport "github.com/aieyra/aieyra-os/contracts/context"
	"os"
	"path/filepath"
	"strings"
)

func contextProviders() []contextprovider.Provider {
	return []contextprovider.Provider{contextpolicy.New(), structured.New()}
}
func resolveContextProvider(ref contextport.Reference, config ...string) (contextprovider.Provider, error) {
	if err := ref.Validate(); err != nil {
		return nil, err
	}
	for _, p := range contextProviders() {
		if p.Describe().Reference == ref {
			return p, nil
		}
	}
	if len(config) == 1 && ref.Digest != "" {
		return resolveContextPackage(context.Background(), config[0], ref)
	}
	return nil, fmt.Errorf("上下文提供者版本不可用：%s@%s（状态%d）；原档案已保留", ref.ID, ref.Version, ref.StateSchema)
}
func legacyContextProvider(memory bool) contextport.Reference {
	if memory {
		if d, ok := official.Role(WorkspaceMatrix); ok && d.ContextProvider != nil {
			return *d.ContextProvider
		}
		return contextpolicy.Reference
	}
	return structured.Reference
}

// The state envelope and optional hydrated checkpoint are appended to a new
// archive version. All original records keep their exact bytes and timestamps.
type contextProviderMigration struct {
	State      contextport.State `json:"state"`
	Source     string            `json:"source"`
	Checkpoint *Checkpoint       `json:"checkpoint,omitempty"`
}

func validateSessionContextProvider(session string, r *RestoredSession, config ...string) error {
	if r.ContextProvider == nil {
		return nil
	}
	if r.ContextProvider.Session != session {
		return fmt.Errorf("上下文提供者状态不属于当前会话")
	}
	if err := r.ContextProvider.Validate(); err != nil {
		return err
	}
	p, err := resolveContextProvider(r.ContextProvider.Provider, config...)
	if err != nil {
		// Unavailable dynamic code must block execution, not access to the
		// original archive or the user's explicit recovery/migration controls.
		if r.ContextProvider.Provider.Digest != "" {
			return nil
		}
		return err
	}
	_, err = p.Migrate(*r.ContextProvider, session)
	return err
}
func contextProviderSource(messages []Message, cp *Checkpoint) string {
	return contextport.Digest([]any{messages, cp})
}

func (w *Workspace) contextProviderView(r *RestoredSession) (any, error) {
	ref := legacyContextProvider(!w.contextMemoryOff.Load())
	if r.ContextProvider != nil {
		ref = r.ContextProvider.Provider
	}
	p, selectedErr := resolveContextProvider(ref, w.config)
	selected := contextprovider.Description{Reference: ref, Contract: contextport.Version, Name: ref.ID, Storage: "archive"}
	if selectedErr == nil {
		selected = p.Describe()
	}
	list := []contextprovider.Description{}
	providers, listErr := availableContextProviders(w.config)
	for _, item := range providers {
		list = append(list, item.Describe())
	}
	view := map[string]any{"selected": selected, "pinned": r.ContextProvider != nil, "available": list, "state": r.ContextProvider, "ready": selectedErr == nil}
	if selectedErr != nil {
		view["error"] = selectedErr.Error()
	}
	if listErr != nil {
		view["catalog_error"] = listErr.Error()
	}
	return view, nil
}

func (w *Workspace) hydrateContextCheckpoint(ctx context.Context, cp *Checkpoint) (*Checkpoint, error) {
	if cp != nil && cp.Packet == "" && cp.Segment != 0 && len(cp.Summary.Goals) == 0 {
		return nil, fmt.Errorf("旧记忆段缺少可验证的完整迁移正文；请先完成PAC转换，原会话未切换")
	}
	if cp == nil || cp.Packet == "" || len(cp.Imported) > 0 {
		return cp, nil
	}
	var clone Checkpoint
	if err := json.Unmarshal(rawJSON(cp), &clone); err != nil {
		return nil, err
	}
	var body strings.Builder
	offset := 0
	for {
		r, err := memoryResult(w.memory(ctx, memoryRow{"action": "pac_read", "id": cp.Packet, "offset": offset, "limit_chars": 8000}))
		if err != nil {
			return nil, fmt.Errorf("读取迁移所需的PAC失败，原会话未切换: %w", err)
		}
		record, ok := r["record"].(map[string]any)
		if !ok || memString(record["id"]) != cp.Packet {
			return nil, fmt.Errorf("迁移PAC身份不匹配")
		}
		body.WriteString(memString(record["content"]))
		if body.Len() > 2<<20 {
			return nil, fmt.Errorf("迁移PAC超过2 MiB，原会话未切换")
		}
		if r["has_more"] != true {
			break
		}
		next := int(memInt(r["next_offset"]))
		if next <= offset {
			return nil, fmt.Errorf("迁移PAC分页未推进")
		}
		offset = next
	}
	clone.Imported = []Message{{Role: RoleUser, Name: "imported_pac", Content: body.String()}}
	return &clone, nil
}

func (w *Workspace) switchContextProvider(ctx context.Context, source string, ref contextport.Reference) (any, error) {
	provider, err := resolveContextProvider(ref, w.config)
	if err != nil {
		return nil, err
	}
	w.mu.Lock()
	if err = w.contextIdleLocked(); err != nil {
		w.mu.Unlock()
		return nil, err
	}
	r, current, err := w.contextSourceLocked()
	if err != nil {
		w.mu.Unlock()
		return nil, err
	}
	if source == "" || source != current {
		w.mu.Unlock()
		return nil, fmt.Errorf("上下文已变化，请重新读取")
	}
	if provider.Describe().Storage == "memory" && (w.contextMemoryOff.Load() || w.service == nil) {
		w.mu.Unlock()
		return nil, fmt.Errorf("PAC提供者需要先启用当前会话记忆")
	}
	if compactionPending(r.Compaction) || w.contextClean != nil && w.contextClean.State == "running" {
		w.mu.Unlock()
		return nil, fmt.Errorf("上下文维护尚未结束，请稍后切换提供者")
	}
	if err = w.beginContextBookLocked(); err != nil {
		w.mu.Unlock()
		return nil, err
	}
	r, current, err = w.contextSourceLocked()
	if err != nil {
		w.mu.Unlock()
		return nil, err
	}
	session := w.contextBook.Active
	state := contextport.State{Schema: contextport.Version, Session: session, Provider: legacyContextProvider(!w.contextMemoryOff.Load())}
	if r.ContextProvider != nil {
		state = *r.ContextProvider
	}
	w.mu.Unlock()
	// The memory service acquires the workspace mutex itself. Revalidate the
	// source after this authorized read; a concurrent turn wins over migration.
	nextState, err := provider.Migrate(state, session)
	if err != nil {
		return nil, err
	}
	cp, err := w.hydrateContextCheckpoint(ctx, r.Checkpoint)
	if err != nil {
		return nil, err
	}
	if err = ctx.Err(); err != nil {
		return nil, err
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	if err = w.contextIdleLocked(); err != nil {
		return nil, err
	}
	freshView, fresh, err := w.contextSourceLocked()
	if err != nil {
		return nil, err
	}
	if fresh != current {
		return nil, fmt.Errorf("迁移期间上下文已变化，原会话未切换")
	}
	if compactionPending(freshView.Compaction) || w.contextClean != nil && w.contextClean.State == "running" {
		return nil, fmt.Errorf("迁移期间开始了上下文维护，原会话未切换")
	}
	var book eyraContextBook
	if err = json.Unmarshal(rawJSON(w.contextBook), &book); err != nil {
		return nil, err
	}
	var target *eyraContextSession
	for i := range book.Sessions {
		if book.Sessions[i].ID == book.Active {
			target = &book.Sessions[i]
		}
	}
	prior, err := os.ReadFile(w.contextArchivePath(target.Archive))
	if err != nil {
		return nil, err
	}
	a := &SessionArchive{ephemeral: true, memory: prior}
	migration := contextProviderMigration{State: nextState, Source: contextProviderSource(r.Messages, r.Checkpoint), Checkpoint: cp}
	if err = a.Append("context_provider", migration); err != nil {
		return nil, err
	}
	restored, err := a.read()
	if err != nil {
		return nil, err
	}
	version := workspaceID()
	if err = atomicWorkspaceFile(w.contextDirectory(), version+".jsonl", a.memory); err != nil {
		return nil, err
	}
	if target.VersionMemory == nil {
		target.VersionMemory = map[string]bool{}
	}
	target.VersionMemory[target.Archive] = target.Memory
	target.Versions = append(target.Versions, target.Archive)
	target.Archive = version
	target.Messages = append([]workspaceMessage{}, w.state.Messages...)
	book.Revision++
	if err = os.MkdirAll(filepath.Join(w.contextDirectory(), "workflow-"+version), 0700); err != nil {
		return nil, err
	}
	if err = ctx.Err(); err != nil {
		return nil, err
	}
	if err = w.saveContextBookLocked(&book); err != nil {
		return nil, err
	}
	w.contextBook = &book
	w.activateContextLocked(target, restored)
	w.feed.publish(WorkspaceMatrix, "context_changed", map[string]any{"session_id": book.Active, "action": "provider"})
	return w.contextViewLocked()
}

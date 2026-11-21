// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: isConversationToolContext; conversationProject
// Impact: python -B scripts/code-atlas.py show Core/conversation_project.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/aieyra/aieyra-os/contracts/storage"
	"os"
	"path/filepath"
	"strings"
)

func isConversationToolContext(ctx context.Context) bool {
	c, ok := ctx.Value(agentManagerKey{}).(agentManagerContext)
	if !ok || c.manager == nil {
		return false
	}
	r, err := c.manager.Status(c.manager.owner, c.owner)
	return err == nil && r.Spec.Kind == "conversation"
}

// The project facade owns only an instance/scope map and selected workdir.
// It never inserts a Matrix identity or main-host settings into tool context.
func (m *AgentManager) conversationProject(ctx context.Context, id string, raw json.RawMessage) (any, error) {
	m.mu.Lock()
	j := m.jobs[id]
	if j == nil || j.record.Spec.Kind != "conversation" {
		m.mu.Unlock()
		return nil, fmt.Errorf("会话工程实例不存在")
	}
	r := copyRecord(j.record)
	scope := r.ID
	if r.Link != nil {
		scope = r.Link.Scope
	} else if r.Spec.GroupID != "" {
		scope = r.Spec.GroupID
	}
	if m.conversationProjects == nil {
		m.conversationProjects = map[string]*Workspace{}
	}
	key := scope + ":" + r.Spec.Workdir
	w := m.conversationProjects[key]
	if w == nil {
		workdir := storage.Relocate(m.config, r.Spec.Workdir)
		w = &Workspace{config: m.config, dir: filepath.Join(m.dir, "projects", scope, workflowHash(r.Spec.Workdir)[:16]), state: workspaceState{ID: scope, Workdir: workdir}}
		products := filepath.Join(m.dir, "files")
		if rel, e := filepath.Rel(products, workdir); e == nil && (rel == "." || filepath.IsLocal(rel)) && !strings.HasPrefix(rel, "..") {
			w.projectProducts = products
		}
		m.conversationProjects[key] = w
	}
	m.mu.Unlock()
	if err := os.MkdirAll(w.dir, 0700); err != nil {
		return nil, err
	}
	return w.project(ctx, WorkspaceProject, raw)
}

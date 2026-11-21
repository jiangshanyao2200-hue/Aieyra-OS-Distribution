// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: resolveContextDirectory; memoryProject; memoryProjectIdentity
// Impact: python -B scripts/code-atlas.py show Core/workspace_context_path.go
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
	"strings"
	"time"

	"github.com/aieyra/aieyra-os/contracts/storage"
)

// Resolve only catalogs within the current private root. Migration preserves
// archive bytes and directory identities even when the working folder moves.
func (w *Workspace) resolveContextDirectory() error {
	w.contextRoot = w.contextDirectory()
	w.contextWorkdir = filepath.Clean(w.state.Workdir)
	w.contextOrigin = w.contextWorkdir
	selected := ""
	seen := map[string]bool{}
	works := append([]string{w.contextWorkdir}, storage.Bound(w.config).PreviousPaths(w.contextWorkdir)...)
	for _, work := range works {
		sum := sha256.Sum256([]byte(filepath.Clean(work)))
		dir := filepath.Join(PrivatePaths(w.config).Context, "eyra", fmt.Sprintf("%x", sum[:12]))
		if seen[dir] {
			continue
		}
		seen[dir] = true
		if _, err := os.Lstat(filepath.Join(dir, "sessions.json")); os.IsNotExist(err) {
			continue
		} else if err != nil {
			return err
		}
		if selected != "" {
			return fmt.Errorf("搬迁后的工作目录对应多个会话目录；请先核对归属，原记录未修改")
		}
		selected = dir
		w.contextOrigin = work
	}
	if selected != "" {
		w.contextRoot = selected
	}
	if len(works) > 1 && w.service != nil {
		identities := map[string]string{}
		var projects []string
		for _, work := range works {
			project := memoryProjectIdentity(work)
			if _, exists := identities[project]; !exists {
				identities[project] = work
				projects = append(projects, project)
			}
		}
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		found := map[string]bool{}
		// Inspect durable pending identities before the store. A concurrent
		// outbox commit may remove a file only after its database commit.
		pending, err := os.ReadDir(w.transcriptOutboxDirectory())
		if err != nil && !os.IsNotExist(err) {
			return err
		}
		for _, entry := range pending {
			if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
				continue
			}
			if err := ctx.Err(); err != nil {
				return err
			}
			data, err := os.ReadFile(filepath.Join(w.transcriptOutboxDirectory(), entry.Name()))
			if os.IsNotExist(err) {
				continue
			}
			var header struct {
				Project string `json:"project"`
			}
			if err != nil || json.Unmarshal(data, &header) != nil {
				return fmt.Errorf("搬迁后的原文待写项目归属无法读取；原件已保留")
			}
			if _, belongs := identities[header.Project]; belongs {
				found[header.Project] = true
			}
		}
		existing, err := w.service.existingMemoryProjects(ctx, projects)
		if err != nil {
			return err
		}
		for _, project := range existing {
			found[project] = true
		}
		if len(found) > 1 {
			return fmt.Errorf("搬迁后的工作目录对应多个记忆项目；请先核对归属，原记录未合并")
		}
		for project := range found {
			w.contextOrigin = identities[project]
		}
	}
	return nil
}

func (w *Workspace) memoryProject(workdir string) string {
	identity := filepath.Clean(workdir)
	if w.contextOrigin != "" && identity == w.contextWorkdir {
		identity = w.contextOrigin
	}
	return memoryProjectIdentity(identity)
}

func memoryProjectIdentity(workdir string) string {
	return fmt.Sprintf("project:%x", sha256.Sum256([]byte(strings.ToLower(filepath.Clean(workdir)))))
}

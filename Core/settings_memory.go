// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: callMemory; existingMemoryProjects; memoryStoreLocked
// Impact: python -B scripts/code-atlas.py show Core/settings_memory.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

func (s *SettingsService) callMemory(ctx context.Context, session string, args json.RawMessage) (json.RawMessage, error) {
	if s == nil {
		return nil, fmt.Errorf("记忆服务未初始化")
	}
	if err := s.admitProfile(); err != nil {
		return nil, err
	}
	var a memoryRow
	if err := json.Unmarshal(args, &a); err != nil {
		return nil, err
	}
	if a == nil {
		return nil, fmt.Errorf("记忆请求无效")
	}
	settings, err := Load(s.config)
	if err != nil {
		return nil, err
	}
	if !settings.MemoryEnabled {
		return rawJSON(memoryRow{"ok": false, "error": "永久记忆已关闭；可在设置中重新开启"}), nil
	}
	if a["action"] == "dream" && !settings.DreamsEnabled {
		return rawJSON(memoryRow{"ok": true, "dream": nil}), nil
	}
	project := memString(a["_project"])
	delete(a, "_project")
	if a["action"] == "surface" {
		a["token_budget"] = settings.MemorySurfaceTokens
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	store, err := s.memoryStoreLocked(false)
	if err != nil {
		return nil, err
	}
	r, err := store.Call(ctx, a, project, session)
	if err != nil {
		return rawJSON(memoryRow{"ok": false, "error": err.Error()}), nil
	}
	return json.Marshal(r)
}

// Existing project identities are host metadata, never a model tool or a
// request to enumerate another project's contents. No empty database is made.
func (s *SettingsService) existingMemoryProjects(ctx context.Context, projects []string) ([]string, error) {
	if err := s.admitProfile(); err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	store, err := s.memoryStoreLocked(true)
	if err != nil || store == nil {
		return nil, err
	}
	return store.ExistingProjects(ctx, projects)
}

func (s *SettingsService) memoryStoreLocked(existingOnly bool) (*memoryStore, error) {
	if s.closed {
		return nil, fmt.Errorf("记忆服务已关闭")
	}
	if s.memory != nil {
		return s.memory, nil
	}
	directory := s.memoryDirectory
	if directory == "" {
		directory = PrivatePaths(s.config).Memory
	}
	file := filepath.Join(directory, "eyra.sqlite")
	legacy := filepath.Join(filepath.Dir(s.config), "memory", "eyra.sqlite")
	if s.memoryDirectory == "" && filepath.Clean(file) != filepath.Clean(legacy) {
		for _, suffix := range []string{"", "-wal", "-shm", "-journal"} {
			_, e := os.Lstat(legacy + suffix)
			if e == nil {
				return nil, fmt.Errorf("检测到Config下的旧记忆，需先停写并保全后迁移到Data/memory；未自动打开、覆盖或合并旧库")
			}
			if !os.IsNotExist(e) {
				return nil, e
			}
		}
	}
	if existingOnly {
		if _, err := os.Lstat(file); os.IsNotExist(err) {
			return nil, nil
		} else if err != nil {
			return nil, err
		}
	}
	var err error
	s.memory, err = openMemoryStore(file, nil, s.startedAt)
	return s.memory, err
}

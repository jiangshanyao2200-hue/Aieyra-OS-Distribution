// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: ErrWorkspaceInUse; DesktopStartupWorkspace; startupWorkdirMatches; startupWorkspaceState; rememberActive
// Impact: python -B scripts/code-atlas.py show Core/workspace_recent.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
)

var ErrWorkspaceInUse = errors.New("workspace is already open")

// DesktopStartupWorkspace restores the user's last visible workspace. Headless
// clients and explicit workspace.open calls keep their existing new/resume contract.
func DesktopStartupWorkspace(config, workdir string) (string, string, error) {
	root := PrivatePaths(config).Workspaces
	var active struct {
		Version int    `json:"version"`
		ID      string `json:"id"`
	}
	if b, err := os.ReadFile(filepath.Join(root, "active.json")); err == nil {
		if json.Unmarshal(b, &active) != nil || active.Version != 1 || !sessionIDPattern.MatchString(active.ID) {
			return "", "", fmt.Errorf("上次工作区入口损坏，原文件已保留；请从会话记录明确打开工作区")
		}
		state, err := startupWorkspaceState(root, active.ID)
		if err == nil && startupWorkdirMatches(workdir, state.Workdir) {
			return state.ID, state.Workdir, nil
		}
		if err != nil && !os.IsNotExist(err) {
			return "", "", err
		}
	} else if !os.IsNotExist(err) {
		return "", "", err
	}
	// Upgrade from releases without an active pointer. Inspect bounded workspace
	// metadata newest-first; never read Matrix transcripts or execute old tasks.
	entries, err := os.ReadDir(root)
	if os.IsNotExist(err) {
		return "", workdir, nil
	}
	if err != nil {
		return "", "", err
	}
	type candidate struct {
		id string
		at int64
	}
	var candidates []candidate
	for _, entry := range entries {
		if !entry.IsDir() || !sessionIDPattern.MatchString(entry.Name()) {
			continue
		}
		info, e := os.Stat(filepath.Join(root, entry.Name(), "workspace.json"))
		if e == nil {
			candidates = append(candidates, candidate{entry.Name(), info.ModTime().UnixNano()})
		}
	}
	sort.Slice(candidates, func(i, j int) bool { return candidates[i].at > candidates[j].at })
	for _, item := range candidates {
		state, e := startupWorkspaceState(root, item.id)
		if e == nil && (len(state.Messages) > 0 || len(state.Roles) > 0) && startupWorkdirMatches(workdir, state.Workdir) {
			return state.ID, state.Workdir, nil
		}
	}
	return "", workdir, nil
}

func startupWorkdirMatches(requested, saved string) bool {
	if requested == "" {
		return true
	}
	a, err := filepath.Abs(requested)
	if err != nil {
		return false
	}
	b := filepath.Clean(saved)
	if runtime.GOOS == "windows" {
		return strings.EqualFold(a, b)
	}
	return a == b
}

func startupWorkspaceState(root, id string) (workspaceState, error) {
	var state workspaceState
	f, err := os.Open(filepath.Join(root, id, "workspace.json"))
	if err != nil {
		return state, err
	}
	defer f.Close()
	b, err := io.ReadAll(io.LimitReader(f, 64<<20+1))
	if err != nil {
		return state, err
	}
	if len(b) > 64<<20 || json.Unmarshal(b, &state) != nil || state.Version != 1 || state.ID != id || state.Models == nil || state.Roles == nil || !filepath.IsAbs(state.Workdir) {
		return state, fmt.Errorf("上次工作区记录损坏；原文件已保留")
	}
	info, err := os.Stat(state.Workdir)
	if err != nil {
		return state, err
	}
	if !info.IsDir() {
		return state, fmt.Errorf("上次工作区目录不存在")
	}
	return state, nil
}

func (w *Workspace) rememberActive() error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.closed {
		return fmt.Errorf("画布已经关闭")
	}
	return WriteMatrixJSON(filepath.Join(PrivatePaths(w.config).Workspaces, "active.json"), map[string]any{"version": 1, "id": w.state.ID})
}

// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/sessionservice/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: Target; CleanupStep; Retained; CleanupReceipt; cleanupDir; cleanupPath; readCleanup; ReadCleanup; saveCleanup; validateTargets; Cleanup
// Impact: python -B scripts/code-atlas.py show Core/sessionservice/cleanup.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package sessionservice

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"
)

// Target is an explicitly owned path relative to the caller's authorized root.
// Shared resources must be declared as retained and handled by their owner.
type Target struct {
	ID   string `json:"id"`
	Path string `json:"path"`
	Tree bool   `json:"tree,omitempty"`
}
type CleanupStep struct {
	Target
	State   string `json:"state"`
	Error   string `json:"error,omitempty"`
	Updated string `json:"updated,omitempty"`
}
type Retained struct {
	ID     string `json:"id"`
	Reason string `json:"reason"`
}
type CleanupReceipt struct {
	Schema   int           `json:"schema"`
	Session  string        `json:"session"`
	State    string        `json:"state"`
	Steps    []CleanupStep `json:"steps"`
	Retained []Retained    `json:"retained,omitempty"`
	Updated  string        `json:"updated"`
}

const cleanupDir = ".session-cleanup"

func cleanupPath(id string) (string, error) {
	if !idPattern.MatchString(id) {
		return "", fmt.Errorf("无效会话清理标识")
	}
	return filepath.Join(cleanupDir, id+".json"), nil
}
func readCleanup(root *os.Root, id string) (*CleanupReceipt, error) {
	file, err := cleanupPath(id)
	if err != nil {
		return nil, err
	}
	f, err := root.Open(file)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	b, err := io.ReadAll(io.LimitReader(f, 1<<20))
	if err != nil {
		return nil, err
	}
	var r CleanupReceipt
	if json.Unmarshal(b, &r) != nil || r.Schema != 1 || r.Session != id || !slices.Contains([]string{"pending", "failed", "completed"}, r.State) {
		return nil, fmt.Errorf("会话清理回执损坏，原件已保留")
	}
	return &r, nil
}
func ReadCleanup(directory, id string) (*CleanupReceipt, error) {
	root, err := os.OpenRoot(directory)
	if err != nil {
		return nil, err
	}
	defer root.Close()
	return readCleanup(root, id)
}
func saveCleanup(root *os.Root, r *CleanupReceipt) error {
	file, err := cleanupPath(r.Session)
	if err != nil {
		return err
	}
	if err = root.MkdirAll(cleanupDir, 0700); err != nil {
		return err
	}
	r.Updated = time.Now().UTC().Format(time.RFC3339Nano)
	b, err := json.Marshal(r)
	if err != nil {
		return err
	}
	temp := file + ".tmp"
	f, err := root.OpenFile(temp, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if os.IsExist(err) {
		// A crash may leave the prior temporary receipt. The durable receipt is
		// authoritative; remove only this exact temporary path inside the root.
		if err = root.Remove(temp); err != nil {
			return err
		}
		f, err = root.OpenFile(temp, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	}
	if err != nil {
		return err
	}
	defer root.Remove(temp)
	n, err := f.Write(b)
	if err == nil && n != len(b) {
		err = io.ErrShortWrite
	}
	if err == nil {
		err = f.Sync()
	}
	closed := f.Close()
	if err == nil {
		err = closed
	}
	if err != nil {
		return err
	}
	return root.Rename(temp, file)
}
func validateTargets(targets []Target) error {
	seen := map[string]bool{}
	for _, t := range targets {
		p := filepath.Clean(t.Path)
		if t.ID == "" || seen[t.ID] || p != t.Path || !filepath.IsLocal(p) || p == "." || p == cleanupDir || strings.HasPrefix(p, cleanupDir+string(os.PathSeparator)) {
			return fmt.Errorf("无效会话清理目标")
		}
		seen[t.ID] = true
	}
	if len(targets) == 0 {
		return fmt.Errorf("会话清理缺少目标")
	}
	return nil
}

// Cleanup persists each successful step before attempting the next. Repeating a
// completed operation returns its durable receipt. Callers serialize per owner
// and stop all writers before entering; Root prevents redirected sidecars from
// traversing outside the authorized directory.
func Cleanup(ctx context.Context, directory, id string, targets []Target, retained []Retained) (*CleanupReceipt, error) {
	if err := validateTargets(targets); err != nil {
		return nil, err
	}
	root, err := os.OpenRoot(directory)
	if err != nil {
		return nil, err
	}
	defer root.Close()
	r, err := readCleanup(root, id)
	if os.IsNotExist(err) {
		r = &CleanupReceipt{Schema: 1, Session: id, State: "pending", Retained: slices.Clone(retained)}
		for _, t := range targets {
			r.Steps = append(r.Steps, CleanupStep{Target: t, State: "pending"})
		}
		err = saveCleanup(root, r)
	}
	if err != nil {
		return nil, err
	}
	if len(r.Steps) != len(targets) {
		return r, fmt.Errorf("会话清理目标已变化，原回执已保留")
	}
	for i, t := range targets {
		if r.Steps[i].Target != t || !slices.Contains([]string{"pending", "failed", "completed"}, r.Steps[i].State) {
			return r, fmt.Errorf("会话清理目标或状态不匹配，原回执已保留")
		}
	}
	if r.State == "completed" {
		for _, step := range r.Steps {
			if step.State != "completed" {
				return r, fmt.Errorf("完成回执含未清理项目，原件已保留")
			}
		}
		return r, nil
	}
	for i := range r.Steps {
		step := &r.Steps[i]
		if step.State == "completed" {
			continue
		}
		err = ctx.Err()
		if err == nil {
			if step.Tree {
				err = root.RemoveAll(step.Path)
			} else {
				err = root.Remove(step.Path)
			}
			if os.IsNotExist(err) {
				err = nil
			}
		}
		step.Updated = time.Now().UTC().Format(time.RFC3339Nano)
		if err != nil {
			step.State, step.Error, r.State = "failed", err.Error(), "failed"
			if saved := saveCleanup(root, r); saved != nil {
				return r, fmt.Errorf("会话清理失败且回执未能保存: %v; %w", err, saved)
			}
			return r, fmt.Errorf("会话清理尚未完成，已保留逐项回执，可重试：%w", err)
		}
		step.State, step.Error, r.State = "completed", "", "pending"
		if err = saveCleanup(root, r); err != nil {
			return r, err
		}
	}
	r.State = "completed"
	if err = saveCleanup(root, r); err != nil {
		return r, err
	}
	return r, nil
}

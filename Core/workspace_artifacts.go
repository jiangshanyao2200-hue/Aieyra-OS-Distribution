// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: WorkspaceArtifact; fileStamp; artifactSkipDirs; artifactStateNames; artifactStatePaths; privateStateRoots; scanWorkdir; artifactKind; diffArtifacts; artifactPath
// Impact: python -B scripts/code-atlas.py show Core/workspace_artifacts.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/aieyra/aieyra-os/contracts/storage"
)

// 本轮产物（README.md 运行时 · 产物 B1）：Eyra 每轮开工时记下工作目录的文件清单，回复落地时再看一次，
// 新建或改过的文件挂在这条回复上，界面显示成卡片（打开、在文件夹中显示、预览）。
// 用 apply_patch 还是命令写的文件都算；只看路径、大小和修改时间，不读内容；深度和数量有上限，大目录不拖慢回复。

type WorkspaceArtifact struct {
	Path    string `json:"path"` // 相对工作目录，正斜杠
	Size    int64  `json:"size"`
	Kind    string `json:"kind"` // html / markdown / image / document / code / other
	Created bool   `json:"created,omitempty"`
}

type fileStamp struct {
	size int64
	mod  int64
}

const (
	artifactScanDepth = 4
	artifactScanLimit = 4000
	artifactListLimit = 12
)

var artifactSkipDirs = map[string]bool{"node_modules": true, ".git": true, ".venv": true, "venv": true, "__pycache__": true, ".cache": true, ".next": true}

// 工作目录如果正好包含 OS 自己的状态（配置、任务记录、终端日志、桌面配置档），那些不是 Eyra 交付的文件，不列为产物。
var artifactStateNames = []string{"config.json", "control.json", "companion-profile.json", "interface-preferences.json", "os-appearance.json", "sessions", "matrix", "matrix-api", "workspaces", "project-maps", "reports", "memory", "runtime", "link-hub", "control-private"}

func artifactStatePaths(config string) map[string]bool {
	if config == "" {
		return nil
	}
	skip := map[string]bool{}
	for _, path := range privateStateRoots(config) {
		skip[strings.ToLower(filepath.Clean(path))] = true
	}
	return skip
}

// Keep the original spelling for symlink resolution on case-sensitive hosts.
// Both project indexing and output detection use these same private roots.
func privateStateRoots(config string) []string {
	dir := DataDir(config)
	roots := []string{config, filepath.Join(dir, filepath.Base(config)+".catalog-cache"), filepath.Join(dir, storage.OwnerDirectory), filepath.Join(dir, storage.MigrationBarrier), filepath.Join(dir, ".aieyra-migration-owner.lock")}
	if p := storage.Bound(config); p.Unified {
		roots = append(roots, filepath.Dir(config), p.Overrides, filepath.Join(p.Root, storage.ProfileMarker), filepath.Join(p.Root, storage.OriginsFile), filepath.Join(p.Root, storage.MigrationReceiptFile), filepath.Join(p.Root, ".aieyra-transfer.json"), filepath.Join(p.Root, ".aieyra-transfer-work"))
	}
	if strings.EqualFold(filepath.Base(filepath.Dir(config)), "Config") {
		roots = append(roots, filepath.Dir(config), dir)
	}
	for _, area := range storage.Describe(dir) {
		roots = append(roots, area.Path)
	}
	for _, name := range artifactStateNames {
		roots = append(roots, filepath.Join(dir, name))
	}
	return roots
}

func scanWorkdir(root string, state map[string]bool) map[string]fileStamp {
	files := map[string]fileStamp{}
	var walk func(dir string, depth int)
	walk = func(dir string, depth int) {
		entries, err := os.ReadDir(dir)
		if err != nil {
			return
		}
		for _, entry := range entries {
			if len(files) >= artifactScanLimit {
				return
			}
			name, path := entry.Name(), filepath.Join(dir, entry.Name())
			if state[strings.ToLower(path)] {
				continue
			}
			if entry.IsDir() {
				if depth < artifactScanDepth && !artifactSkipDirs[strings.ToLower(name)] {
					walk(path, depth+1)
				}
				continue
			}
			if !entry.Type().IsRegular() || strings.HasPrefix(name, ".") {
				continue
			}
			info, err := entry.Info()
			rel, relErr := filepath.Rel(root, path)
			if err != nil || relErr != nil {
				continue
			}
			files[filepath.ToSlash(rel)] = fileStamp{info.Size(), info.ModTime().UnixNano()}
		}
	}
	walk(root, 0)
	return files
}

func artifactKind(path string) string {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".html", ".htm":
		return "html"
	case ".md", ".markdown":
		return "markdown"
	case ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico":
		return "image"
	case ".pdf", ".docx", ".doc", ".xlsx", ".xls", ".pptx", ".ppt", ".csv", ".txt":
		return "document"
	case ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".css", ".json", ".py", ".go", ".rs", ".java", ".c", ".cpp", ".h", ".cs", ".ps1", ".sh", ".bat", ".yaml", ".yml", ".toml", ".xml", ".sql":
		return "code"
	}
	return "other"
}

// diffArtifacts 返回这一轮新建或改过的文件，最近改动的在前，最多 artifactListLimit 个。
func diffArtifacts(before, after map[string]fileStamp) []WorkspaceArtifact {
	type changed struct {
		artifact WorkspaceArtifact
		mod      int64
	}
	var list []changed
	for path, now := range after {
		old, existed := before[path]
		if existed && old == now {
			continue
		}
		list = append(list, changed{WorkspaceArtifact{Path: path, Size: now.size, Kind: artifactKind(path), Created: !existed}, now.mod})
	}
	sort.Slice(list, func(i, j int) bool {
		if list[i].mod != list[j].mod {
			return list[i].mod > list[j].mod
		}
		return list[i].artifact.Path < list[j].artifact.Path
	})
	if len(list) > artifactListLimit {
		list = list[:artifactListLimit]
	}
	out := make([]WorkspaceArtifact, len(list))
	for i := range list {
		out[i] = list[i].artifact
	}
	return out
}

// workspace.artifact：把回复卡片上的相对路径换成工作目录里的绝对路径，供宿主打开、在文件夹中显示或预览。
// 只认工作目录里现存的普通文件；绝对路径、..、经符号链接逃出工作目录的一律拒绝。
func (w *Workspace) artifactPath(args json.RawMessage) (any, error) {
	var p struct {
		Path string `json:"path"`
	}
	if err := json.Unmarshal(args, &p); err != nil {
		return nil, err
	}
	w.mu.Lock()
	root := w.state.Workdir
	w.mu.Unlock()
	rel := filepath.FromSlash(strings.TrimSpace(p.Path))
	if rel == "" || filepath.IsAbs(rel) || filepath.VolumeName(rel) != "" || strings.HasPrefix(rel, string(filepath.Separator)) {
		return nil, fmt.Errorf("产物路径无效")
	}
	base, err := filepath.EvalSymlinks(root)
	if err != nil {
		return nil, fmt.Errorf("工作目录不可用")
	}
	resolved, err := filepath.EvalSymlinks(filepath.Join(root, rel))
	if err != nil {
		return nil, fmt.Errorf("文件已不存在")
	}
	inside, err := filepath.Rel(base, resolved)
	if err != nil || inside == ".." || strings.HasPrefix(inside, ".."+string(filepath.Separator)) || filepath.IsAbs(inside) {
		return nil, fmt.Errorf("产物不在工作目录里")
	}
	info, err := os.Stat(resolved)
	if err != nil || !info.Mode().IsRegular() {
		return nil, fmt.Errorf("文件已不存在")
	}
	return map[string]any{"path": resolved, "name": filepath.Base(resolved), "kind": artifactKind(resolved), "size": info.Size()}, nil
}

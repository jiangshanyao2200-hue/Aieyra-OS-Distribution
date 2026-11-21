// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: workspaceHash; projectWorkdir; projectPathGuard; project; ListWorkspaces; listWorkspaceDirectory
// Impact: python -B scripts/code-atlas.py show Core/workspace_project.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/aieyra/aieyra-os/CORE/platform"
)

func workspaceHash(b []byte) string { sum := sha256.Sum256(b); return hex.EncodeToString(sum[:]) }

func (w *Workspace) projectWorkdir(selection string) (string, error) {
	w.mu.Lock()
	workdir := w.state.Workdir
	w.mu.Unlock()
	switch selection {
	case "", "workspace":
		return workdir, nil
	case "os":
		root := platform.AppRoot()
		if root != "" {
			if info, err := os.Stat(root); err == nil && info.IsDir() {
				return root, nil
			}
		}
		return "", fmt.Errorf("OS source root is unavailable")
	default:
		return "", fmt.Errorf("project root must be workspace or os; external projects use their selected workspace")
	}
}

func (w *Workspace) projectPathGuard(workdir string) func(string) bool {
	canonical := func(name string) string {
		abs, _ := filepath.Abs(name)
		if real, err := filepath.EvalSymlinks(abs); err == nil {
			abs = real
		}
		return strings.ToLower(filepath.Clean(abs))
	}
	private := []string{canonical(w.dir), canonical(PrivatePaths(w.config).ProjectMaps)}
	for _, path := range privateStateRoots(w.config) {
		private = append(private, canonical(path))
	}
	appRoot := platform.AppRoot()
	if appRoot != "" {
		for _, name := range []string{"Config", "Data", "Prompt", "UserData", ".aieyra-updates"} {
			private = append(private, canonical(filepath.Join(appRoot, name)))
		}
	}
	config := canonical(w.config)
	products := ""
	if w.projectProducts != "" {
		abs, e := filepath.Abs(w.projectProducts)
		real, re := filepath.EvalSymlinks(w.projectProducts)
		if e == nil && re == nil && strings.EqualFold(filepath.Clean(abs), filepath.Clean(real)) && canonical(workdir) == canonical(w.state.Workdir) {
			products = canonical(abs)
		}
	}
	return func(name string) bool {
		file := canonical(filepath.Join(workdir, filepath.FromSlash(name)))
		if file == config {
			return true
		}
		if products != "" && (file == products || strings.HasPrefix(file, products+string(filepath.Separator))) {
			return false
		}
		for _, root := range private {
			if file == root || strings.HasPrefix(file, root+string(filepath.Separator)) {
				return true
			}
		}
		return false
	}
}

func (w *Workspace) project(ctx context.Context, role string, raw json.RawMessage) (any, error) {
	if role != WorkspaceMatrix && role != WorkspaceProject && role != WorkspaceExecution {
		return nil, fmt.Errorf("project access not assigned")
	}
	var p struct {
		Root    string `json:"root"`
		Action  string `json:"action"`
		Path    string `json:"path"`
		Query   string `json:"query"`
		Start   int    `json:"start_line"`
		Limit   int    `json:"limit"`
		Offset  int    `json:"offset"`
		Text    string `json:"text"`
		Version string `json:"expected_version"`
	}
	if err := json.Unmarshal(raw, &p); err != nil {
		return nil, err
	}
	// Current tool surface names this a source map; old calls remain readable.
	if p.Action == "map_read" {
		p.Action = "memory_read"
	} else if p.Action == "map_write" {
		p.Action = "memory_write"
	}
	if strings.HasPrefix(p.Action, "index_") {
		return w.index(ctx, role, raw)
	}
	if p.Action == "memory_read" || p.Action == "memory_write" {
		w.mu.Lock()
		defer w.mu.Unlock()
		file := filepath.Join(w.dir, "project-memory.md")
		data, err := os.ReadFile(file)
		if err != nil && !os.IsNotExist(err) {
			return nil, err
		}
		version := workspaceHash(data)
		if p.Action == "memory_read" {
			return map[string]any{"text": string(data), "version": version, "authority": "source-map", "freshness": "verify source before changes"}, nil
		}
		if role != WorkspaceProject && role != WorkspaceMatrix {
			return nil, fmt.Errorf("only project maintains its memory")
		}
		if p.Version != version {
			return nil, fmt.Errorf("memory version changed; read before editing")
		}
		if len(p.Text) > 256<<10 {
			return nil, fmt.Errorf("memory exceeds 256 KiB; condense the map")
		}
		tmp, err := os.CreateTemp(w.dir, ".memory-*.tmp")
		if err != nil {
			return nil, err
		}
		name := tmp.Name()
		defer os.Remove(name)
		_, err = tmp.WriteString(p.Text)
		if err == nil {
			err = tmp.Sync()
		}
		ce := tmp.Close()
		if err == nil {
			err = ce
		}
		if err != nil {
			return nil, err
		}
		if err = os.Rename(name, file); err != nil {
			return nil, err
		}
		return map[string]any{"ok": true, "version": workspaceHash([]byte(p.Text))}, nil
	}
	if p.Path == "" {
		p.Path = "."
	}
	p.Path = filepath.Clean(p.Path)
	if !filepath.IsLocal(p.Path) {
		return nil, fmt.Errorf("path must stay inside the selected project")
	}
	workdir, err := w.projectWorkdir(p.Root)
	if err != nil {
		return nil, err
	}
	// os.Root confines even symlinks/junctions. Deny the product configuration
	// and workspace storage separately when the selected project contains them.
	protected := w.projectPathGuard(workdir)
	if protected(p.Path) {
		return nil, fmt.Errorf("credential and workspace stores are private")
	}
	root, err := os.OpenRoot(workdir)
	if err != nil {
		return nil, err
	}
	defer root.Close()
	limit := p.Limit
	if limit <= 0 {
		limit = 120
	}
	limit = min(limit, 400)
	read := func(name string) ([]byte, error) {
		if protected(name) {
			return nil, fmt.Errorf("private path")
		}
		f, e := root.Open(name)
		if e != nil {
			return nil, e
		}
		defer f.Close()
		info, e := f.Stat()
		if e != nil {
			return nil, e
		}
		if !info.Mode().IsRegular() {
			return nil, fmt.Errorf("not a regular file")
		}
		b, e := io.ReadAll(io.LimitReader(f, (2<<20)+1))
		if len(b) > 2<<20 {
			return nil, fmt.Errorf("file exceeds 2 MiB; narrow the requested artifact")
		}
		if !utf8.Valid(b) || strings.ContainsRune(string(b), 0) {
			return nil, fmt.Errorf("not a UTF-8 text file")
		}
		return b, e
	}
	evidence := func() {
		if role == WorkspaceProject {
			w.mu.Lock()
			w.state.LastRead = time.Now().UTC().Format(time.RFC3339Nano)
			_ = w.saveLocked()
			w.mu.Unlock()
		}
	}
	switch p.Action {
	case "list":
		f, e := root.Open(p.Path)
		if e != nil {
			return nil, e
		}
		defer f.Close()
		entries, e := f.ReadDir(-1)
		if e != nil {
			return nil, e
		}
		offset := max(0, p.Offset)
		end := min(len(entries), offset+limit)
		rows := []any{}
		for i := min(offset, len(entries)); i < end; i++ {
			entry := entries[i]
			rows = append(rows, map[string]any{"name": entry.Name(), "directory": entry.IsDir(), "symlink": entry.Type()&os.ModeSymlink != 0})
		}
		return map[string]any{"path": p.Path, "entries": rows, "next_offset": end, "has_more": end < len(entries)}, nil
	case "read":
		b, e := read(p.Path)
		if e != nil {
			return nil, e
		}
		lines := strings.Split(string(b), "\n")
		start := max(1, p.Start)
		end := min(len(lines), start-1+limit)
		rows := []any{}
		total := 0
		for i := min(start-1, len(lines)); i < end; i++ {
			line := utf8Prefix(lines[i], 16000)
			if total+len(line) > 48000 {
				end = i
				break
			}
			rows = append(rows, map[string]any{"line": i + 1, "text": line, "truncated": len(line) != len(lines[i])})
			total += len(line)
		}
		evidence()
		return map[string]any{"path": p.Path, "sha256": workspaceHash(b), "lines": rows, "next_line": end + 1, "has_more": end < len(lines), "total_lines": len(lines)}, nil
	case "search":
		if p.Query == "" || len(p.Query) > 1000 {
			return nil, fmt.Errorf("provide a literal search query of 1..1000 bytes")
		}
		rows := []any{}
		scanned, skipped, matches := 0, 0, 0
		more := false
		err = fs.WalkDir(root.FS(), filepath.ToSlash(p.Path), func(name string, d fs.DirEntry, e error) error {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			if e != nil {
				skipped++
				return nil
			}
			if d.IsDir() {
				switch d.Name() {
				case ".git", "node_modules", ".cache", "target", "dist":
					return fs.SkipDir
				}
				return nil
			}
			if d.Type()&os.ModeSymlink != 0 || protected(name) {
				skipped++
				return nil
			}
			scanned++
			if scanned > 2000 {
				more = true
				return fs.SkipAll
			}
			b, e := read(filepath.FromSlash(name))
			if e != nil {
				skipped++
				return nil
			}
			scanner := bufio.NewScanner(strings.NewReader(string(b)))
			scanner.Buffer(make([]byte, 4096), (2<<20)+1)
			line := 0
			digest := ""
			for scanner.Scan() {
				line++
				if line%128 == 0 && ctx.Err() != nil {
					return ctx.Err()
				}
				if strings.Contains(scanner.Text(), p.Query) {
					matches++
					if matches <= max(0, p.Offset) {
						continue
					}
					if digest == "" {
						digest = workspaceHash(b)
					}
					rows = append(rows, map[string]any{"path": name, "line": line, "text": utf8Prefix(scanner.Text(), 1200), "sha256": digest})
					if len(rows) >= limit {
						more = true
						return fs.SkipAll
					}
				}
			}
			if scanner.Err() != nil {
				skipped++
			}
			return nil
		})
		if err != nil {
			return nil, err
		}
		evidence()
		return map[string]any{"query": p.Query, "matches": rows, "has_more": more, "next_offset": matches, "files_scanned": min(scanned, 2000), "skipped_files": skipped, "scope_note": "bounded literal search; narrow path when file limit is reached"}, nil
	}
	return nil, fmt.Errorf("unknown project action")
}

func ListWorkspaces(config string) (any, error) {
	return listWorkspaceDirectory(PrivatePaths(config).Workspaces)
}

func listWorkspaceDirectory(dir string) (any, error) {
	paths, err := filepath.Glob(filepath.Join(dir, "*", "workspace.json"))
	if err != nil {
		return nil, err
	}
	result := []any{}
	for _, path := range paths {
		b, e := os.ReadFile(path)
		var state workspaceState
		if e != nil || json.Unmarshal(b, &state) != nil {
			continue
		}
		result = append(result, map[string]any{"id": state.ID, "workdir": state.Workdir, "messages": len(state.Messages)})
	}
	return result, nil
}

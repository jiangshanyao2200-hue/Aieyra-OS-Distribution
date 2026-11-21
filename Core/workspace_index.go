// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: MapSymbol; MapFile; ProjectMap; mapSymbolLine; mapImportLine; mapSkip; mapLanguage; mapParse; index
// Impact: python -B scripts/code-atlas.py show Core/workspace_index.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

// The project map stores bounded structure, never authority or full source text.
import (
	"context"
	"encoding/json"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

type MapSymbol struct {
	Name string `json:"name"`
	Kind string `json:"kind"`
	Line int    `json:"line"`
	End  int    `json:"end_line"`
}
type MapFile struct {
	Path        string      `json:"path"`
	Hash        string      `json:"sha256"`
	Bytes       int         `json:"bytes"`
	Language    string      `json:"language"`
	Precision   string      `json:"precision"`
	Symbols     []MapSymbol `json:"symbols"`
	Imports     []string    `json:"imports"`
	Test        bool        `json:"test"`
	Summary     string      `json:"summary,omitempty"`
	SummaryHash string      `json:"summary_sha256,omitempty"`
}
type ProjectMap struct {
	Version  int                `json:"version"`
	Root     string             `json:"root"`
	Revision int                `json:"revision"`
	Files    map[string]MapFile `json:"files"`
	Updated  string             `json:"updated"`
	Scanned  string             `json:"scanned,omitempty"`
	Partial  bool               `json:"partial"`
}

var mapSymbolLine = regexp.MustCompile(`^\s*(?:(?:export|default|async|public|private|protected|static|abstract|declare)\s+)*(?:function\s*\*?|class|interface|type|enum|def|const|let|var)\s+([A-Za-z_$][\w$]*)`)
var mapImportLine = regexp.MustCompile(`(?:\bfrom\s*|\brequire\s*\(|\bimport\s*\(?)["']([^"']{1,200})["']`)

func mapSkip(name string) bool {
	for _, p := range strings.Split(strings.ToLower(filepath.ToSlash(name)), "/") {
		switch p {
		case ".git", "node_modules", "vendor", "dist", "target", ".cache", ".venv", "__pycache__", "prompt", "prompts", "memory", "workspaces", "matrix-home", "aidebug", ".codex", ".agents":
			return true
		}
		if p == ".env" || strings.HasPrefix(p, ".env.") || p == "config.json" || strings.HasSuffix(p, ".pem") || strings.HasSuffix(p, ".key") {
			return true
		}
	}
	return false
}
func mapLanguage(name string) string {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".go":
		return "go"
	case ".js", ".mjs", ".cjs", ".jsx":
		return "javascript"
	case ".ts", ".tsx":
		return "typescript"
	case ".py":
		return "python"
	case ".rs":
		return "rust"
	case ".java":
		return "java"
	case ".cs":
		return "csharp"
	case ".c", ".h", ".cpp", ".hpp":
		return "c"
	case ".md":
		return "markdown"
	}
	return ""
}
func mapParse(name string, b []byte) MapFile {
	f := MapFile{Path: name, Hash: workspaceHash(b), Bytes: len(b), Language: mapLanguage(name), Precision: "lexical-navigation-only", Test: strings.Contains(strings.ToLower(name), "test") || strings.Contains(strings.ToLower(name), "spec"), Symbols: []MapSymbol{}, Imports: []string{}}
	if f.Language == "go" {
		set := token.NewFileSet()
		parsed, e := parser.ParseFile(set, name, b, 0)
		if e != nil {
			f.Precision = "parse-error"
			return f
		}
		f.Precision = "go-ast"
		for _, i := range parsed.Imports {
			if v, e := strconv.Unquote(i.Path.Value); e == nil && len(f.Imports) < 80 {
				f.Imports = append(f.Imports, v)
			}
		}
		add := func(name, kind string, start, end token.Pos) {
			if len(f.Symbols) < 160 {
				f.Symbols = append(f.Symbols, MapSymbol{name, kind, set.Position(start).Line, set.Position(end).Line})
			}
		}
		for _, d := range parsed.Decls {
			switch v := d.(type) {
			case *ast.FuncDecl:
				add(v.Name.Name, "function", v.Pos(), v.End())
			case *ast.GenDecl:
				for _, s := range v.Specs {
					switch x := s.(type) {
					case *ast.TypeSpec:
						add(x.Name.Name, "type", x.Pos(), x.End())
					case *ast.ValueSpec:
						for _, n := range x.Names {
							add(n.Name, v.Tok.String(), x.Pos(), x.End())
						}
					}
				}
			}
		}
		return f
	}
	for i, line := range strings.Split(string(b), "\n") {
		if len(f.Symbols) < 160 {
			if m := mapSymbolLine.FindStringSubmatch(line); m != nil {
				f.Symbols = append(f.Symbols, MapSymbol{m[1], "lexical", i + 1, i + 1})
			} else if f.Language == "markdown" && strings.HasPrefix(line, "#") {
				f.Symbols = append(f.Symbols, MapSymbol{utf8Prefix(strings.TrimSpace(strings.TrimLeft(line, "#")), 160), "heading", i + 1, i + 1})
			}
		}
		if len(f.Imports) < 80 {
			for _, m := range mapImportLine.FindAllStringSubmatch(line, 4) {
				if len(f.Imports) < 80 {
					f.Imports = append(f.Imports, m[1])
				}
			}
		}
	}
	return f
}
func (w *Workspace) index(ctx context.Context, role string, raw json.RawMessage) (any, error) {
	if role != WorkspaceMatrix && role != WorkspaceProject && role != WorkspaceExecution {
		return nil, fmt.Errorf("project access not assigned")
	}
	var p struct {
		Root     string `json:"root"`
		Action   string `json:"action"`
		Path     string `json:"path"`
		Query    string `json:"query"`
		Text     string `json:"text"`
		Expected string `json:"expected_version"`
		Limit    int    `json:"limit"`
	}
	if len(raw) > 16384 || json.Unmarshal(raw, &p) != nil {
		return nil, fmt.Errorf("invalid project map request")
	}
	workdir, e := w.projectWorkdir(p.Root)
	if e != nil {
		return nil, e
	}
	real, e := filepath.EvalSymlinks(workdir)
	if e != nil {
		return nil, e
	}
	key := real
	if os.PathSeparator == '\\' {
		key = strings.ToLower(key)
	}
	dir := filepath.Join(PrivatePaths(w.config).ProjectMaps, workspaceHash([]byte(key)))
	if e = os.MkdirAll(dir, 0700); e != nil {
		return nil, e
	}
	lock, e := os.OpenFile(filepath.Join(dir, "write.lock"), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if e != nil {
		return nil, fmt.Errorf("project map is busy; inspect an abandoned lock before removing it: %w", e)
	}
	_, _ = fmt.Fprintf(lock, "pid=%d\ntime=%s", os.Getpid(), time.Now().UTC().Format(time.RFC3339))
	defer func() { lock.Close(); os.Remove(filepath.Join(dir, "write.lock")) }()
	m := ProjectMap{Version: 1, Root: workspaceHash([]byte(key)), Files: map[string]MapFile{}}
	file, e := os.Open(filepath.Join(dir, "index.json"))
	if e == nil {
		b, re := io.ReadAll(io.LimitReader(file, (16<<20)+1))
		file.Close()
		if re != nil || len(b) > 16<<20 || json.Unmarshal(b, &m) != nil || m.Version != 1 || m.Root != workspaceHash([]byte(key)) || m.Files == nil || len(m.Files) > 2000 {
			return nil, fmt.Errorf("project map damaged or unsupported; original retained")
		}
	} else if !os.IsNotExist(e) {
		return nil, e
	}
	root, e := os.OpenRoot(real)
	if e != nil {
		return nil, e
	}
	defer root.Close()
	protected := w.projectPathGuard(real)
	read := func(name string) ([]byte, error) {
		if !filepath.IsLocal(filepath.FromSlash(name)) || mapSkip(name) || protected(name) {
			return nil, fmt.Errorf("private or invalid map path")
		}
		full := filepath.Join(real, filepath.FromSlash(name))
		resolved, e := filepath.EvalSymlinks(full)
		if e != nil {
			return nil, e
		}
		store, _ := filepath.Abs(PrivatePaths(w.config).ProjectMaps)
		if strings.EqualFold(resolved, w.config) || strings.EqualFold(resolved, w.dir) || strings.HasPrefix(strings.ToLower(resolved), strings.ToLower(w.dir)+string(filepath.Separator)) || strings.HasPrefix(strings.ToLower(resolved), strings.ToLower(store)+string(filepath.Separator)) {
			return nil, fmt.Errorf("private store")
		}
		f, e := root.Open(filepath.FromSlash(name))
		if e != nil {
			return nil, e
		}
		defer f.Close()
		st, e := f.Stat()
		if e != nil || !st.Mode().IsRegular() || st.Size() > 1<<20 {
			return nil, fmt.Errorf("map file must be regular text under 1MiB")
		}
		b, e := io.ReadAll(io.LimitReader(f, (1<<20)+1))
		after, se := f.Stat()
		if e != nil || se != nil || len(b) > 1<<20 || int64(len(b)) != st.Size() || after.Size() != st.Size() || !after.ModTime().Equal(st.ModTime()) || !utf8.Valid(b) || strings.ContainsRune(string(b), 0) {
			return nil, fmt.Errorf("map read changed or is not bounded UTF-8")
		}
		return b, nil
	}
	save := func() error {
		m.Revision++
		m.Updated = time.Now().UTC().Format(time.RFC3339Nano)
		b, e := json.Marshal(m)
		if e != nil {
			return e
		}
		if len(b) > 16<<20 {
			return fmt.Errorf("project map capacity exceeded")
		}
		return atomicWorkspaceFile(dir, "index.json", b)
	}
	switch p.Action {
	case "index_refresh":
		if p.Path == "" {
			p.Path = "."
		}
		p.Path = filepath.ToSlash(filepath.Clean(p.Path))
		if !filepath.IsLocal(filepath.FromSlash(p.Path)) || mapSkip(p.Path) {
			return nil, fmt.Errorf("map scope must stay in project")
		}
		seen := map[string]bool{}
		scanned, parsed, reused, skipped, walked, bytes := 0, 0, 0, 0, 0, 0
		partial := false
		err := fs.WalkDir(root.FS(), p.Path, func(name string, d fs.DirEntry, err error) error {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			walked++
			if walked > 10000 {
				partial = true
				return fs.SkipAll
			}
			if err != nil {
				skipped++
				partial = true
				return nil
			}
			if mapSkip(name) || protected(name) {
				if d.IsDir() {
					return fs.SkipDir
				}
				return nil
			}
			if d.Type()&os.ModeSymlink != 0 {
				skipped++
				return nil
			}
			if d.IsDir() {
				return nil
			}
			if mapLanguage(name) == "" {
				return nil
			}
			if scanned >= 2000 || bytes >= 64<<20 {
				partial = true
				return fs.SkipAll
			}
			scanned++
			seen[name] = true
			b, e := read(name)
			if e != nil {
				skipped++
				partial = true
				delete(m.Files, name)
				return nil
			}
			bytes += len(b)
			old, ok := m.Files[name]
			if ok && old.Hash == workspaceHash(b) {
				reused++
				return nil
			}
			if !ok && len(m.Files) >= 2000 {
				partial = true
				return fs.SkipAll
			}
			next := mapParse(name, b)
			next.Summary, next.SummaryHash = old.Summary, old.SummaryHash
			m.Files[name] = next
			parsed++
			return nil
		})
		if err != nil {
			return nil, err
		}
		removed := 0
		if !partial {
			for name := range m.Files {
				if (p.Path == "." || name == p.Path || strings.HasPrefix(name, p.Path+"/")) && !seen[name] {
					delete(m.Files, name)
					removed++
				}
			}
		}
		m.Partial = partial || p.Path != "."
		m.Scanned = time.Now().UTC().Format(time.RFC3339Nano)
		if e = save(); e != nil {
			return nil, e
		}
		return map[string]any{"ok": true, "revision": m.Revision, "files": len(m.Files), "scanned": scanned, "parsed": parsed, "reused": reused, "removed": removed, "skipped": skipped, "read_bytes": bytes, "partial": m.Partial, "notice": "Host hashes scanned content, reparses only changes. Disk reads are separate from model tokens. Partial scopes do not establish whole-project freshness."}, nil
	case "index_query":
		if len(p.Query) > 200 || p.Query == "" {
			return nil, fmt.Errorf("provide a map query of 1-200 bytes")
		}
		limit := min(20, max(1, p.Limit))
		if p.Limit == 0 {
			limit = 8
		}
		terms := strings.Fields(strings.ToLower(p.Query))
		type candidate struct {
			File  MapFile
			Score int
		}
		var candidates []candidate
		for _, f := range m.Files {
			score := 0
			for _, term := range terms {
				if strings.Contains(strings.ToLower(f.Path), term) {
					score += 6
				}
				for _, s := range f.Symbols {
					if strings.Contains(strings.ToLower(s.Name), term) {
						score += 4
					}
				}
				for _, i := range f.Imports {
					if strings.Contains(strings.ToLower(i), term) {
						score++
					}
				}
			}
			if score > 0 {
				candidates = append(candidates, candidate{f, score})
			}
		}
		sort.Slice(candidates, func(i, j int) bool {
			if candidates[i].Score == candidates[j].Score {
				return candidates[i].File.Path < candidates[j].File.Path
			}
			return candidates[i].Score > candidates[j].Score
		})
		out := []any{}
		readBytes := 0
		changed := false
		for _, c := range candidates[:min(limit, len(candidates))] {
			if ctx.Err() != nil {
				return nil, ctx.Err()
			}
			f := c.File
			b, e := read(f.Path)
			fresh := "unavailable"
			if e == nil {
				readBytes += len(b)
				fresh = "current"
				if workspaceHash(b) != f.Hash {
					n := mapParse(f.Path, b)
					n.Summary, n.SummaryHash = f.Summary, f.SummaryHash
					f = n
					m.Files[f.Path] = f
					changed = true
				}
			}
			summary := f.Summary
			summaryState := "missing"
			if summary != "" {
				summaryState = "current"
				if fresh != "current" || f.Hash != f.SummaryHash {
					summary = ""
					summaryState = "stale"
				}
			}
			symbols := f.Symbols
			if len(symbols) > 24 {
				symbols = symbols[:24]
			}
			imports := f.Imports
			if len(imports) > 20 {
				imports = imports[:20]
			}
			out = append(out, map[string]any{"path": f.Path, "sha256": f.Hash, "bytes": f.Bytes, "language": f.Language, "precision": f.Precision, "freshness": fresh, "symbols": symbols, "symbols_total": len(f.Symbols), "imports": imports, "test_candidate": f.Test, "summary": summary, "summary_state": summaryState})
		}
		if changed {
			if e = save(); e != nil {
				return nil, e
			}
		}
		return map[string]any{"ok": true, "revision": m.Revision, "matches": out, "candidates": len(candidates), "read_bytes": readBytes, "partial": m.Partial, "last_scan": m.Scanned, "updated": m.Updated, "notice": runtimePrompt("Matrix/工具说明/工程索引结果.txt")}, nil
	case "index_annotate":
		if role == WorkspaceExecution {
			return nil, fmt.Errorf("executor cannot author project cognition")
		}
		p.Path = filepath.ToSlash(filepath.Clean(p.Path))
		f, ok := m.Files[p.Path]
		if !ok {
			return nil, fmt.Errorf("refresh this path before annotation")
		}
		if !planText(p.Text, 3000) {
			return nil, fmt.Errorf("summary must be 1-3000 bytes")
		}
		b, e := read(p.Path)
		if e != nil {
			return nil, e
		}
		if workspaceHash(b) != f.Hash || p.Expected != f.Hash {
			return nil, fmt.Errorf("source changed; refresh and inspect before annotation")
		}
		f.Summary, f.SummaryHash = p.Text, f.Hash
		m.Files[p.Path] = f
		if e = save(); e != nil {
			return nil, e
		}
		return map[string]any{"ok": true, "revision": m.Revision, "sha256": f.Hash, "authority": "agent-authored navigation, not source truth"}, nil
	}
	return nil, fmt.Errorf("unknown project map action")
}

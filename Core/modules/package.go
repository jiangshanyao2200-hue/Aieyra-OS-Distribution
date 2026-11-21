// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/modules/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: Package; loadSource; ReadSourceFile; ordinaryPath; boundedRead; Load; FromFiles; write
// Impact: python -B scripts/code-atlas.py show Core/modules/package.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package modules

import (
	"archive/zip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

type Package struct {
	Manifest Manifest
	Files    map[string][]byte
	Digest   string
}

func (m *Manager) loadSource(ctx context.Context, source string) (*Package, error) {
	if m.LoadSource != nil {
		return m.LoadSource(ctx, source)
	}
	return Load(ctx, source)
}

// ReadSourceFile gives host format adapters the same bounded, unlinked input
// policy as ordinary packages. It does not grant trust or execution rights.
func ReadSourceFile(ctx context.Context, source string, limit int64) ([]byte, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if !filepath.IsAbs(source) || limit < 0 || limit > MaxBytes+MaxManifest {
		return nil, fmt.Errorf("invalid source path or limit")
	}
	if err := ordinaryPath(source); err != nil {
		return nil, err
	}
	info, err := os.Stat(source)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Size() > limit {
		return nil, fmt.Errorf("invalid or oversized source file")
	}
	f, err := os.Open(source)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	opened, err := f.Stat()
	if err != nil {
		return nil, err
	}
	if !opened.Mode().IsRegular() || opened.Size() > limit || !os.SameFile(info, opened) {
		return nil, fmt.Errorf("invalid or oversized source file")
	}
	if err = singleFile(f); err != nil {
		return nil, err
	}
	b, err := boundedRead(f, limit)
	if err == nil {
		err = ctx.Err()
	}
	return b, err
}

// ordinaryPath rejects linked ancestors as well as a linked final component.
func ordinaryPath(name string) error {
	abs, err := filepath.Abs(name)
	if err != nil {
		return err
	}
	for p := abs; ; p = filepath.Dir(p) {
		info, e := os.Lstat(p)
		if e != nil && !os.IsNotExist(e) {
			return e
		}
		if e == nil && linked(info) {
			return fmt.Errorf("linked package path: %s", p)
		}
		if filepath.Dir(p) == p {
			break
		}
	}
	return nil
}

func boundedRead(reader io.Reader, limit int64) ([]byte, error) {
	b, err := io.ReadAll(io.LimitReader(reader, limit+1))
	if err == nil && int64(len(b)) > limit {
		err = fmt.Errorf("package input exceeds size limit")
	}
	return b, err
}

func Load(ctx context.Context, source string) (*Package, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if !filepath.IsAbs(source) {
		return nil, fmt.Errorf("package source must be absolute")
	}
	if err := ordinaryPath(source); err != nil {
		return nil, err
	}
	info, err := os.Stat(source)
	if err != nil {
		return nil, err
	}
	files := map[string][]byte{}
	seen := map[string]bool{}
	var total int64
	entries := 0
	add := func(name string, reader io.Reader, size int64) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := FileName(name); err != nil {
			return err
		}
		key := strings.ToLower(name)
		if seen[key] || len(files) > MaxFiles {
			return fmt.Errorf("duplicate file or file limit exceeded: %s", name)
		}
		seen[key] = true
		limit := MaxBytes
		if key == "manifest.json" {
			limit = MaxManifest
		}
		if size < 0 || size > limit || total+size > MaxBytes+MaxManifest {
			return fmt.Errorf("package size limit exceeded")
		}
		data, e := boundedRead(reader, min(limit, MaxBytes+MaxManifest-total))
		if e != nil {
			return e
		}
		total += int64(len(data))
		files[name] = data
		return nil
	}
	if info.IsDir() {
		err = filepath.WalkDir(source, func(name string, entry fs.DirEntry, e error) error {
			entries++
			if entries > MaxFiles*4 {
				return fmt.Errorf("package entry limit exceeded")
			}
			if e != nil {
				return e
			}
			if ctx.Err() != nil {
				return ctx.Err()
			}
			if entry.Type()&os.ModeSymlink != 0 {
				return fmt.Errorf("package links are forbidden: %s", name)
			}
			st, e := entry.Info()
			if e != nil {
				return e
			}
			if linked(st) {
				return fmt.Errorf("linked package directory or file")
			}
			if entry.IsDir() {
				return nil
			}
			if !st.Mode().IsRegular() {
				return fmt.Errorf("package contains non-regular file")
			}
			rel, e := filepath.Rel(source, name)
			if e != nil {
				return e
			}
			f, e := os.Open(name)
			if e != nil {
				return e
			}
			defer f.Close()
			if e = singleFile(f); e != nil {
				return e
			}
			return add(filepath.ToSlash(rel), f, st.Size())
		})
	} else {
		if !info.Mode().IsRegular() || info.Size() > MaxBytes+MaxManifest {
			return nil, fmt.Errorf("invalid package archive")
		}
		archive, e := zip.OpenReader(source)
		if e != nil {
			return nil, e
		}
		defer archive.Close()
		if len(archive.File) > MaxFiles*4 {
			return nil, fmt.Errorf("archive entry limit exceeded")
		}
		for _, file := range archive.File {
			if file.Mode()&os.ModeSymlink != 0 {
				err = fmt.Errorf("archive links are forbidden")
				break
			}
			if file.FileInfo().IsDir() {
				if e = FileName(strings.TrimSuffix(file.Name, "/")); e != nil {
					err = e
					break
				}
				continue
			}
			if !file.Mode().IsRegular() || file.UncompressedSize64 > uint64(MaxBytes) {
				err = fmt.Errorf("invalid archive file")
				break
			}
			reader, e := file.Open()
			if e != nil {
				err = e
				break
			}
			err = add(file.Name, reader, int64(file.UncompressedSize64))
			_ = reader.Close()
			if err != nil {
				break
			}
		}
	}
	if err != nil {
		return nil, err
	}
	return FromFiles(files)
}

// FromFiles is also used by the legacy .aieyra adapter after its own hash check.
// There is one manifest/integrity validator for every package entry path.
func FromFiles(files map[string][]byte) (*Package, error) {
	raw, ok := files["manifest.json"]
	if !ok {
		return nil, fmt.Errorf("manifest.json missing at package root")
	}
	m, err := DecodeManifest(raw)
	if err != nil {
		return nil, err
	}
	if len(files) != len(m.Files)+1 {
		return nil, fmt.Errorf("package contains undeclared or missing files")
	}
	for name, declared := range m.Files {
		b, ok := files[name]
		if !ok || int64(len(b)) != declared.Size || sum(b) != declared.SHA256 {
			return nil, fmt.Errorf("file integrity mismatch: %s", name)
		}
	}
	if _, err = m.PublisherKey(); err != nil {
		return nil, err
	}
	canonical, err := json.Marshal(m)
	if err != nil {
		return nil, err
	}
	copyFiles := make(map[string][]byte, len(files))
	for n, b := range files {
		copyFiles[n] = append([]byte(nil), b...)
	}
	copyFiles["manifest.json"] = canonical
	return &Package{Manifest: m, Files: copyFiles, Digest: sum(canonical)}, nil
}

func (p *Package) write(directory string) error {
	if err := ordinaryPath(directory); err != nil {
		return err
	}
	if err := os.MkdirAll(directory, 0700); err != nil {
		return err
	}
	names := make([]string, 0, len(p.Files))
	for name := range p.Files {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		file := filepath.Join(directory, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(file), 0700); err != nil {
			return err
		}
		f, err := os.OpenFile(file, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if err != nil {
			return err
		}
		_, err = f.Write(p.Files[name])
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
	}
	return nil
}

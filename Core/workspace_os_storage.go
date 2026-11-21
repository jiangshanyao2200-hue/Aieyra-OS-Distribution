// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: reportDirectory; refreshSnapshotReportsLocked; refreshReportsLocked; loadOSReport; saveReportLocked; workflowDirectory; prepareOSRuntime; releaseOSRuntime
// Impact: python -B scripts/code-atlas.py show Core/workspace_os_storage.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// 独立报告不属于会话，多个 OS 窗口共享正文与逐报告修订。
func (w *Workspace) reportDirectory() string {
	if w.privateAgentScope {
		return filepath.Join(w.dir, "reports")
	}
	if w.Mode().unified() {
		return filepath.Join(PrivatePaths(w.config).Reports, "os")
	}
	return w.dir
}

// Streaming snapshots share a short cache; explicit report actions always read
// the latest metadata while holding the per-report cross-process lock.
func (w *Workspace) refreshSnapshotReportsLocked(now time.Time) error {
	if !w.reportsReadAt.IsZero() && now.Sub(w.reportsReadAt) < time.Second {
		return nil
	}
	return w.refreshReportsLocked()
}

func (w *Workspace) refreshReportsLocked() error {
	if !w.Mode().unified() && !w.privateAgentScope {
		return nil
	}
	dir := w.reportDirectory()
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return err
	}
	var docs []WorkspaceDocument
	for _, entry := range entries {
		id := strings.TrimSuffix(entry.Name(), ".json")
		if entry.IsDir() || entry.Name() == id || !sessionIDPattern.MatchString(id) {
			continue
		}
		doc, err := w.loadOSReport(id)
		if err != nil {
			return err
		}
		docs = append(docs, doc)
	}
	sort.Slice(docs, func(i, j int) bool {
		if docs[i].At == docs[j].At {
			return docs[i].ID < docs[j].ID
		}
		return docs[i].At < docs[j].At
	})
	w.state.Documents = docs
	w.reportsReadAt = time.Now()
	return nil
}

func (w *Workspace) loadOSReport(id string) (WorkspaceDocument, error) {
	var doc WorkspaceDocument
	if !sessionIDPattern.MatchString(id) {
		return doc, fmt.Errorf("文档编号无效")
	}
	root, err := os.OpenRoot(w.reportDirectory())
	if err != nil {
		return doc, err
	}
	defer root.Close()
	f, err := root.Open(id + ".json")
	if err != nil {
		return doc, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return doc, err
	}
	if !info.Mode().IsRegular() || info.Size() > 64<<10 {
		return doc, fmt.Errorf("报告元数据过大或不是普通文件")
	}
	if err = json.NewDecoder(io.LimitReader(f, 64<<10)).Decode(&doc); err != nil || doc.ID != id || (doc.Format != "md" && doc.Format != "html") {
		return doc, fmt.Errorf("报告元数据损坏，原文件已保留")
	}
	return doc, nil
}

func (w *Workspace) saveReportLocked(doc WorkspaceDocument) error {
	if !w.Mode().unified() && !w.privateAgentScope {
		return w.saveLocked()
	}
	data, err := json.Marshal(doc)
	if err != nil {
		return err
	}
	if err = atomicWorkspaceFile(w.reportDirectory(), doc.ID+".json", data); err != nil {
		return err
	}
	w.state.Revision++
	w.reportsReadAt = time.Time{}
	return nil
}

func (w *Workspace) workflowDirectory() string {
	if s := w.contextSessionLocked(); s != nil {
		return filepath.Join(w.contextDirectory(), "workflow-"+s.Archive)
	}
	if w.Mode().unified() {
		return w.manager.dir
	}
	return w.dir
}

// 仅清理带本版本标记、且系统锁可取的临时运行目录。锁放在目录外，
// 避免 Windows 删除打开的文件失败；崩溃后的清理由下一次启动接续。
func (w *Workspace) prepareOSRuntime() error {
	base := filepath.Dir(w.dir)
	unlock, err := lockSession(w.dir + ".lock")
	if err != nil {
		return err
	}
	w.runtimeUnlock = unlock
	if err = os.WriteFile(filepath.Join(w.dir, ".ephemeral-os"), []byte("aieyra-os-ephemeral/1\n"), 0600); err != nil {
		w.releaseOSRuntime()
		return err
	}
	entries, _ := os.ReadDir(base)
	for _, entry := range entries {
		if !entry.IsDir() || entry.Type()&os.ModeSymlink != 0 || !sessionIDPattern.MatchString(entry.Name()) || filepath.Join(base, entry.Name()) == w.dir {
			continue
		}
		dir := filepath.Join(base, entry.Name())
		if !ordinaryRuntimeDirectory(dir) {
			continue
		}
		mark, e := os.ReadFile(filepath.Join(dir, ".ephemeral-os"))
		if e != nil || string(mark) != "aieyra-os-ephemeral/1\n" {
			continue
		}
		release, e := lockSession(dir + ".lock")
		if e != nil {
			continue
		}
		_ = os.RemoveAll(dir)
		release()
	}
	return nil
}

func (w *Workspace) releaseOSRuntime() {
	if w.runtimeUnlock == nil {
		return
	}
	// 主机已经等待桌面退出，任务窗口也已关闭。报告和调度记录在目录外。
	_ = os.RemoveAll(w.dir)
	w.runtimeUnlock()
	w.runtimeUnlock = nil
}

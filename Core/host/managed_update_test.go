// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/host/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: testUpdatePlan; TestManagedUpdateTransactionAndRollback; TestManagedUpdateRecoveryPreservesLaterEdit; TestManagedUpdateRejectsConcurrentEdit; TestManagedUpdateRejectsCandidateTamper; TestManagedUpdatePartialJournalRecovery; TestManagedUpdateProtectsPersonalPaths; TestManagedUpdatePreservesFileAddedAfterBackup; TestManagedUpdateRejectsHardLink; TestManagedUpdatePublicDocumentsAndModulePaths
// Impact: python -B scripts/code-atlas.py show Core/host/managed_update_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package host

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func testUpdatePlan(t *testing.T) (updatePlan, string) {
	t.Helper()
	root := t.TempDir()
	candidate := filepath.Join(root, ".aieyra-updates", "test", "candidate")
	p := updatePlan{Schema: 1, Root: root, Candidate: candidate, Release: "test", Version: "0.2.12", Sequence: 2, Config: filepath.Join(root, "personal", "config.json"), Workdir: root, Phase: "ready", Files: map[string]updateFile{}, Previous: map[string]updateFile{}}
	write := func(base, name, text string, files map[string]updateFile) {
		f := filepath.Join(base, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(f), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(f, []byte(text), 0600); err != nil {
			t.Fatal(err)
		}
		meta, err := updateDigest(f)
		if err != nil {
			t.Fatal(err)
		}
		files[name] = meta
	}
	write(root, "Client/Desktop/a.cjs", "old", p.Previous)
	write(root, "Core/deleted.txt", "previous", p.Previous)
	write(root, "Core/growth.txt", "personal growth", p.Previous)
	write(candidate, "Client/Desktop/a.cjs", "new", p.Files)
	write(candidate, "Core/added.txt", "added", p.Files)
	write(candidate, "Core/growth.txt", "personal growth", p.Files)
	planFile := filepath.Join(filepath.Dir(candidate), "apply.json")
	if err := writeUpdateJSON(planFile, p); err != nil {
		t.Fatal(err)
	}
	return p, planFile
}
func TestManagedUpdateTransactionAndRollback(t *testing.T) {
	p, file := testUpdatePlan(t)
	// Real replacement and rollback may never touch unified private data.
	private := []string{"Data/Config/config.json", "Data/Memory/precious.bin", "Data/Sessions/context/history.json", "Data/Overrides/Prompt/Matrix/private.txt", "Data/Workspace/drawing.svg"}
	for _, name := range private {
		target := filepath.Join(p.Root, filepath.FromSlash(name))
		_ = os.MkdirAll(filepath.Dir(target), 0700)
		if err := os.WriteFile(target, []byte("user-owned:"+name), 0600); err != nil {
			t.Fatal(err)
		}
		if _, err := updatePath(p.Root, name); err == nil {
			t.Fatal("private path allowed", name)
		}
	}
	assertPrivate := func() {
		for _, name := range private {
			data, err := os.ReadFile(filepath.Join(p.Root, filepath.FromSlash(name)))
			if err != nil || string(data) != "user-owned:"+name {
				t.Fatal("update changed private bytes", name, err)
			}
		}
	}
	if err := prepareUpdateBackup(&p, file); err != nil {
		t.Fatal(err)
	}
	if err := applyUpdateFiles(&p, file); err != nil {
		t.Fatal(err)
	}
	assertPrivate()
	if err := checkUpdateFiles(p.Root, p.Files); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(p.Root, "Core/deleted.txt")); !os.IsNotExist(err) {
		t.Fatal("deleted file remains")
	}
	if err := rollbackUpdate(&p, file); err != nil {
		t.Fatal(err)
	}
	assertPrivate()
	if err := checkUpdateFiles(p.Root, p.Previous); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(p.Root, "Core/added.txt")); !os.IsNotExist(err) {
		t.Fatal("new file remains after rollback")
	}
	if p.Phase != "rolled_back" {
		t.Fatal(p.Phase)
	}
}
func TestManagedUpdateRecoveryPreservesLaterEdit(t *testing.T) {
	p, file := testUpdatePlan(t)
	if err := prepareUpdateBackup(&p, file); err != nil {
		t.Fatal(err)
	}
	if err := applyUpdateFiles(&p, file); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(p.Root, "Client/Desktop/a.cjs")
	if err := os.WriteFile(target, []byte("growth after interruption"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := rollbackUpdate(&p, file); err == nil {
		t.Fatal("overwrote later local edit")
	}
	data, _ := os.ReadFile(target)
	if string(data) != "growth after interruption" {
		t.Fatal("lost growth")
	}
}
func TestManagedUpdateRejectsConcurrentEdit(t *testing.T) {
	p, file := testUpdatePlan(t)
	if err := prepareUpdateBackup(&p, file); err != nil {
		t.Fatal(err)
	}
	_ = os.WriteFile(filepath.Join(p.Root, "Core/growth.txt"), []byte("later growth"), 0600)
	if err := applyUpdateFiles(&p, file); err == nil {
		t.Fatal("accepted stale inventory")
	}
	b, _ := os.ReadFile(filepath.Join(p.Root, "Core/growth.txt"))
	if string(b) != "later growth" {
		t.Fatal("overwrote concurrent edit")
	}
}
func TestManagedUpdateRejectsCandidateTamper(t *testing.T) {
	p, file := testUpdatePlan(t)
	_ = os.WriteFile(filepath.Join(p.Candidate, "Client/Desktop/a.cjs"), []byte("tampered"), 0600)
	if err := prepareUpdateBackup(&p, file); err == nil {
		t.Fatal("accepted tampered candidate")
	}
}
func TestManagedUpdatePartialJournalRecovery(t *testing.T) {
	p, file := testUpdatePlan(t)
	if err := prepareUpdateBackup(&p, file); err != nil {
		t.Fatal(err)
	}
	p.Applied = []string{"Client/Desktop/a.cjs", "Core/added.txt"}
	p.Phase = "applying"
	if err := writeUpdateJSON(file, p); err != nil {
		t.Fatal(err)
	}
	// 一个文件已原子替换，下一条意图尚未执行时断电。
	_ = os.WriteFile(filepath.Join(p.Root, "Client/Desktop/a.cjs"), []byte("new"), 0600)
	p, err := loadUpdatePlan(file)
	if err != nil {
		t.Fatal(err)
	}
	if err = rollbackUpdate(&p, file); err != nil {
		t.Fatal(err)
	}
	if err = checkUpdateFiles(p.Root, p.Previous); err != nil {
		t.Fatal(err)
	}
}
func TestManagedUpdateProtectsPersonalPaths(t *testing.T) {
	root := t.TempDir()
	for _, name := range []string{"Agent/official/Vaya/prompts/提示词.txt.write-lock", "Agent/official/Vaya/prompts/提示词.txt.backup." + strings.Repeat("a", 64), "API/third-party/private/adapter.go", "API/config.json", "Program/third-party/private/main.js", "Program/local/private/main.js", "../x", "Client/Desktop/config.json", "Prompt/自我.txt", "Client/Desktop/auth.json", "Client/Desktop/.env.local", "Core/history/a", "Client/Desktop/a:stream", "Core/NUL.txt", "Core/COM1", "Core/a\n.go", "Core/memory/export.txt", "Client/Desktop/Memory/nested/data", "Core/eyra.sqlite", "Core/eyra.sqlite-wal", "Client/Desktop/eyra.SQLITE3-SHM", "Client/Desktop/data.db-journal", "Core/data.db"} {
		if _, err := updatePath(root, name); err == nil {
			t.Fatalf("accepted %q", name)
		}
	}
	for _, name := range []string{"scripts/build-provenance.py", "scripts/development-docs.py", "Agent/official/Eyra/prompts/contracts/团队主控.txt", "Agent/official/Eyra/context/prompts/整理.txt", "API/transport/client.go", "API/go.mod", "Program/runtime/desktop.cjs", "Program/go.mod", "Contracts/product-layout.json", "SDK/examples/program-notebook/manifest.json", "Core/memoryservice/schema.sql", "Core/memoryservice/store.go", "Client/Desktop/test/fixtures/legacy-memory-store.cjs", "Aieyra Browser.exe", "Control/app/service/main.py", "Control/app/runtime/python/python.exe", "Link/app/runtime/link/aieyra-link.exe", "Prompt/Matrix/默认/边界.txt", "Config/运行参数.json"} {
		if _, err := updatePath(root, name); err != nil {
			t.Fatalf("rejected source %q: %v", name, err)
		}
	}
}

func TestManagedUpdatePreservesFileAddedAfterBackup(t *testing.T) {
	p, file := testUpdatePlan(t)
	if err := prepareUpdateBackup(&p, file); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(p.Root, "Core/added.txt")
	if err := os.WriteFile(target, []byte("later local creation"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := applyUpdateFiles(&p, file); err == nil {
		t.Fatal("accepted a newly occupied target")
	}
	if len(p.Applied) != 0 {
		t.Fatal("changed files before rechecking new targets")
	}
	data, _ := os.ReadFile(target)
	if string(data) != "later local creation" {
		t.Fatal("lost new file")
	}
}
func TestManagedUpdateRejectsHardLink(t *testing.T) {
	p, file := testUpdatePlan(t)
	source := filepath.Join(p.Root, "Core/growth.txt")
	if err := os.Link(source, filepath.Join(p.Root, "personal-link.txt")); err != nil {
		t.Skip(err)
	}
	if err := prepareUpdateBackup(&p, file); err == nil {
		t.Fatal("accepted hard link")
	}
}

// The helper must accept every exact document selected by the package builder,
// while similarly named private files remain protected.
func TestManagedUpdatePublicDocumentsAndModulePaths(t *testing.T) {
	root := t.TempDir()
	data, err := os.ReadFile("../../Contracts/development-documents.json")
	if err != nil {
		t.Fatal(err)
	}
	var layout struct {
		Documents []string          `json:"documents"`
		Templates map[string]string `json:"templates"`
	}
	if err := json.Unmarshal(data, &layout); err != nil {
		t.Fatal(err)
	}
	allowed := append(layout.Documents, "scripts/winres.py", "Agent/context/history/policy.go", "Link/cloud/client/remote-link.mjs", "Link/cloud/desktop_owner.py", "Link/cloud/protocol.py", "Aieyra Together.exe", "Program/official/workspace/node_modules/exceljs/lib/doc/data/theme1.json")
	for name := range layout.Templates {
		allowed = append(allowed, name)
	}
	for _, name := range allowed {
		if _, err := updatePath(root, name); err != nil {
			t.Errorf("rejected %s: %v", name, err)
		}
	}
	for _, name := range []string{"docs/private.md", "docs/CURRENT.md", "AIDEBUG/evidence/AGENTS.md", "AIDEBUG/AGENTS.md/extra", "Core/docs/AGENTS.md", "Control/app/cloud/private.py", "Link/cloud/private.py", "Link/cloud/client/private.mjs", "Core/cloud/client.go", "Agent/context/history/history/private.go", "Agent/context/history/Data/private.go", "Agent/context/History/policy.go", "Core/history/policy.go", "scripts/PUBLIC-AGENTS.md"} {
		if _, err := updatePath(root, name); err == nil {
			t.Errorf("accepted private path %s", name)
		}
	}
}

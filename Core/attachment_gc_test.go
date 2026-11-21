// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: gcFixture; gcAsset; gcWrite; gcExists; TestAttachmentGCReferencesAndLegacy; TestAttachmentGCConservativeFailures; TestAttachmentGCRetainedModuleReferences; TestAttachmentGCModuleDamageOrLiveWriterRetainsAll; TestAttachmentGCContextLifetimes; TestAttachmentLeaseHelper; TestAttachmentGCNativeProcessLocks
// Impact: python -B scripts/code-atlas.py show Core/attachment_gc_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"bufio"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func gcFixture(t *testing.T) (string, string) {
	t.Helper()
	base := t.TempDir()
	return filepath.Join(base, "config.json"), base
}
func gcAsset(t *testing.T, base, text string) string {
	t.Helper()
	h := fmt.Sprintf("%x", sha256.Sum256([]byte(text)))
	dir := filepath.Join(base, "runtime", "attachments", "v2")
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, h), []byte(text), 0600); err != nil {
		t.Fatal(err)
	}
	gcWrite(t, filepath.Join(dir, h+".json"), map[string]any{"version": 2, "sha256": h, "bytes": len(text)})
	return h
}
func gcWrite(t *testing.T, p string, value any) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(p), 0700); err != nil {
		t.Fatal(err)
	}
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(p, data, 0600); err != nil {
		t.Fatal(err)
	}
}
func gcExists(t *testing.T, base, h string) bool {
	t.Helper()
	_, err := os.Stat(filepath.Join(base, "runtime", "attachments", "v2", h))
	if err != nil && !os.IsNotExist(err) {
		t.Fatal(err)
	}
	return err == nil
}
func TestAttachmentGCReferencesAndLegacy(t *testing.T) {
	config, base := gcFixture(t)
	draft := gcAsset(t, base, "draft")
	pending := gcAsset(t, base, "pending")
	sent := gcAsset(t, base, "uncertain send")
	history := gcAsset(t, base, "archive")
	conversation := gcAsset(t, base, "conversation archive")
	memory := gcAsset(t, base, "memory")
	orphan := gcAsset(t, base, "orphan")
	escaped := gcAsset(t, base, "escaped json")
	unknown := gcAsset(t, base, "unmanaged")
	if err := os.Remove(filepath.Join(base, "runtime", "attachments", "v2", unknown+".json")); err != nil {
		t.Fatal(err)
	}
	owner := strings.Repeat("a", 32)
	gcWrite(t, filepath.Join(base, "runtime", "attachments", "references-v2", owner+".json"), map[string]any{"version": 2, "owner": owner, "refs": []string{draft}, "pending": map[string][]string{"receipt": {pending}}, "sends": map[string][]string{"request": {sent}}})
	gcWrite(t, filepath.Join(base, "sessions", owner+".jsonl"), map[string]any{"content": "archive path: " + history})
	gcWrite(t, filepath.Join(base, "conversations", "sessions", owner+".jsonl"), map[string]any{"content": "conversation asset: " + conversation})
	memdir := filepath.Join(base, "memory")
	if err := os.MkdirAll(memdir, 0700); err != nil {
		t.Fatal(err)
	}
	db, err := sql.Open("sqlite", filepath.Join(memdir, "eyra.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec("CREATE TABLE chunks(content TEXT); INSERT INTO chunks(content) VALUES (?)", strings.Repeat("x", 65536)+memory); err != nil {
		t.Fatal(err)
	}
	db.Close()
	if err = scanAttachmentReferences(filepath.Join(memdir, "eyra.sqlite"), func(string) {}); err != nil {
		t.Fatal("SQLite census:", err)
	}
	encoded := strings.ReplaceAll(fmt.Sprintf("%q", escaped), string(escaped[0]), fmt.Sprintf(`\u%04x`, escaped[0]))
	p := filepath.Join(base, "reports", "escaped.json")
	os.MkdirAll(filepath.Dir(p), 0700)
	os.WriteFile(p, []byte(encoded), 0600)
	legacy := filepath.Join(base, "runtime", "attachments", orphan)
	if err = os.WriteFile(legacy, []byte("old namespace must stay"), 0600); err != nil {
		t.Fatal(err)
	}
	got := collectAttachments(config)
	if got.Skipped != "" || got.Removed != 1 {
		t.Fatalf("GC: %+v", got)
	}
	if gcExists(t, base, orphan) {
		t.Fatal("orphan retained")
	}
	for _, h := range []string{draft, pending, sent, history, conversation, memory, escaped, unknown} {
		if !gcExists(t, base, h) {
			t.Fatalf("reference deleted: %s", h)
		}
	}
	if _, err = os.Stat(legacy); err != nil {
		t.Fatal("legacy snapshot deleted", err)
	}
}
func TestAttachmentGCConservativeFailures(t *testing.T) {
	for _, kind := range []string{"history", "journal", "catalog", "asset", "legacy_lock", "discovery"} {
		t.Run(kind, func(t *testing.T) {
			config, base := gcFixture(t)
			h := gcAsset(t, base, "keep me")
			p := filepath.Join(base, "sessions", strings.Repeat("b", 32)+".jsonl")
			os.MkdirAll(filepath.Dir(p), 0700)
			switch kind {
			case "history":
				os.WriteFile(p, []byte("{broken"), 0600)
			case "journal":
				gcWrite(t, filepath.Join(base, "runtime", "attachments", "references-v2", strings.Repeat("a", 32)+".json"), map[string]any{"version": 99})
			case "catalog":
				os.WriteFile(filepath.Join(base, "runtime", "attachments", "v2", h+".json"), []byte("{}"), 0600)
			case "asset":
				os.WriteFile(filepath.Join(base, "runtime", "attachments", "v2", h), []byte("tampered"), 0600)
			case "legacy_lock":
				gcWrite(t, p, map[string]any{"no": "reference"})
				release, err := lockSession(strings.TrimSuffix(p, ".jsonl") + ".lock")
				if err != nil {
					t.Fatal(err)
				}
				defer release()
			case "discovery":
				gcWrite(t, filepath.Join(base, "matrix-api", "owner.json"), map[string]any{"pid": os.Getpid()})
			}
			got := collectAttachments(config)
			if got.Skipped == "" || got.Removed != 0 || !gcExists(t, base, h) {
				t.Fatalf("unsafe result: %+v", got)
			}
		})
	}
}

// Modules retain attachments after their execution host has released its lease.
// Closing the host must not make these durable references look like orphans.
func TestAttachmentGCRetainedModuleReferences(t *testing.T) {
	for _, relative := range []string{"Agents/instance/history.json", "workflows/owner/workflow/state.json", "image-batches/batch/request.json", "cli/workspaces/old/history.json", "Programs/example/store.json", "gallery/index.json", "generated-images/index.json"} {
		t.Run(relative, func(t *testing.T) {
			config, base := gcFixture(t)
			retained := gcAsset(t, base, "retained by "+relative)
			orphan := gcAsset(t, base, "unreferenced")
			gcWrite(t, filepath.Join(base, filepath.FromSlash(relative)), map[string]any{"asset": retained})
			got := collectAttachments(config)
			if got.Skipped != "" || got.Removed != 1 || !gcExists(t, base, retained) || gcExists(t, base, orphan) {
				t.Fatalf("durable module reference lost: %+v", got)
			}
		})
	}
}

func TestAttachmentGCModuleDamageOrLiveWriterRetainsAll(t *testing.T) {
	for _, area := range []string{"Agents/instance", "workflows/owner/workflow", "image-batches/batch", "Programs/example"} {
		for _, active := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/active=%v", area, active), func(t *testing.T) {
				config, base := gcFixture(t)
				asset := gcAsset(t, base, "preserved until owner is known")
				dir := filepath.Join(base, filepath.FromSlash(area))
				if err := os.MkdirAll(dir, 0700); err != nil {
					t.Fatal(err)
				}
				if active {
					release, err := lockSession(filepath.Join(dir, "runner.lock"))
					if err != nil {
						t.Fatal(err)
					}
					defer release()
				} else if err := os.WriteFile(filepath.Join(dir, "state.json"), []byte("{broken"), 0600); err != nil {
					t.Fatal(err)
				}
				got := collectAttachments(config)
				if got.Skipped == "" || got.Removed != 0 || !gcExists(t, base, asset) {
					t.Fatal("uncertain module lost assets", got)
				}
			})
		}
	}
}
func TestAttachmentGCContextLifetimes(t *testing.T) {
	config, base := gcFixture(t)
	h := gcAsset(t, base, "live context")
	service := NewSettingsService(config)
	m, err := NewAgentManager(config, strings.Repeat("a", 32), service)
	if err != nil {
		t.Fatal(err)
	}
	if got := collectAttachments(config); got.Skipped != "active_context" || !gcExists(t, base, h) {
		t.Fatalf("manager lost context: %+v", got)
	}
	m.Close()
	service.Close()
	a, err := NewSessionArchive(config)
	if err != nil {
		t.Fatal(err)
	}
	if err = a.Start("fixture"); err != nil {
		t.Fatal(err)
	}
	if got := collectAttachments(config); got.Skipped != "active_context" || !gcExists(t, base, h) {
		t.Fatalf("archive lost context: %+v", got)
	}
	a.Close()
	if got := collectAttachments(config); got.Skipped != "" || got.Removed != 1 {
		t.Fatalf("closed context retained: %+v", got)
	}
}
func TestAttachmentLeaseHelper(t *testing.T) {
	config := os.Getenv("AIEYRA_ATTACHMENT_LOCK_HELPER")
	if config == "" {
		return
	}
	release, err := attachmentLease(config)
	if err != nil {
		fmt.Println("error", err)
		os.Exit(2)
	}
	fmt.Println("ready")
	bufio.NewReader(os.Stdin).ReadString('\n')
	if os.Getenv("AIEYRA_ATTACHMENT_HELPER_EXIT") == "kernel" {
		os.Exit(0)
	}
	release()
	os.Exit(0)
}
func TestAttachmentGCNativeProcessLocks(t *testing.T) {
	config, base := gcFixture(t)
	h := gcAsset(t, base, "two native readers")
	var children []*exec.Cmd
	var inputs []interface{ Close() error }
	for i := 0; i < 2; i++ {
		cmd := exec.Command(os.Args[0], "-test.run=^TestAttachmentLeaseHelper$")
		cmd.Env = append(os.Environ(), "AIEYRA_ATTACHMENT_LOCK_HELPER="+config, "AIEYRA_ATTACHMENT_HELPER_EXIT=kernel")
		in, err := cmd.StdinPipe()
		if err != nil {
			t.Fatal(err)
		}
		out, err := cmd.StdoutPipe()
		if err != nil {
			t.Fatal(err)
		}
		if err = cmd.Start(); err != nil {
			t.Fatal(err)
		}
		children = append(children, cmd)
		inputs = append(inputs, in)
		line, err := bufio.NewReader(out).ReadString('\n')
		if err != nil || line != "ready\n" {
			t.Fatalf("helper %q %v", line, err)
		}
	}
	t.Cleanup(func() {
		for i, c := range children {
			inputs[i].Close()
			if c.ProcessState == nil {
				c.Wait()
			}
		}
	})
	if got := collectAttachments(config); got.Skipped != "active_context" {
		t.Fatalf("native readers: %+v", got)
	}
	inputs[0].Close()
	if err := children[0].Wait(); err != nil {
		t.Fatal(err)
	}
	if got := collectAttachments(config); got.Skipped != "active_context" || !gcExists(t, base, h) {
		t.Fatalf("second reader: %+v", got)
	}
	inputs[1].Close()
	if err := children[1].Wait(); err != nil {
		t.Fatal(err)
	}
	if got := collectAttachments(config); got.Skipped != "" || got.Removed != 1 {
		t.Fatalf("kernel release: %+v", got)
	}
}

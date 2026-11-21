// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/userdata/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: offlineHooks; migrationFixture; assertOriginals; TestMigrationPreservesOpaqueHistoryAndRepeatedMove; TestMigrationResumesEveryDurableBoundary; TestMigrationRefusesOwnersLocksAndOldProcesses; TestMigrationConflictsAndChangedSourceStayFenced; TestMigrationRefusesUnknownNonemptyAndOverlap; TestMigrationRejectsDestinationLink; TestMigrationCorruptCompletedReceiptCannotRedirect; TestMigrationLegacyMemoryAndFlatLayout; TestMigrationCancellationRetainsBothCopiesAndCannotUndoReady; TestMigrationKeepsActualComposerDraftScopeAcrossMoves
// Impact: python -B scripts/code-atlas.py show Core/userdata/migrate_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package userdata

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/aieyra/aieyra-os/CORE/sessionservice"
	"github.com/aieyra/aieyra-os/contracts/storage"
)

func offlineHooks() migrationHooks {
	return migrationHooks{processes: func(string, string, string) ([]int, error) { return nil, nil }}
}
func migrationFixture(t *testing.T) (string, string, map[string][]byte) {
	t.Helper()
	base := t.TempDir()
	config := filepath.Join(base, "old", "Config", "config.json")
	dest := filepath.Join(base, "UserData")
	values := map[string][]byte{
		filepath.Join(base, "old", "Data", "Overrides", "Agent", "official", "Cota", "prompts", "提示词.txt"): []byte("private role override"),
		config: []byte(`{"prompt_dir":"","unknown":{"kept":true}}`),
		filepath.Join(base, "old", "Config", "companion-profile.json"):             []byte(`{"name":"migration fixture"}`),
		filepath.Join(base, "old", "Data", "sessions", "one.jsonl"):                []byte("historical message: " + filepath.Join(base, "old", "Data", "runtime", "attachments", "hash") + "\n"),
		filepath.Join(base, "old", "Data", "runtime", "attachments", "v2", "hash"): []byte("immutable attachment"),
		filepath.Join(base, "old", "Data", "runtime", "attachment-usage-v2.lock"):  nil,
		filepath.Join(base, "old", "Data", "memory", "memory.db"):                  []byte("opaque synthetic database bytes"),
		filepath.Join(base, "old", "Data", "extra", "unknown.bin"):                 []byte{0, 255, 2},
		filepath.Join(base, "old", "Prompt", "Matrix", "self.txt"):                 []byte("fixture prompt override"),
	}
	for file, data := range values {
		if err := os.MkdirAll(filepath.Dir(file), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(file, data, 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.MkdirAll(filepath.Join(base, "old", "Data", "notes", "empty"), 0700); err != nil {
		t.Fatal(err)
	}
	return config, dest, values
}
func assertOriginals(t *testing.T, files map[string][]byte) {
	t.Helper()
	for file, want := range files {
		got, err := os.ReadFile(file)
		if err != nil || string(got) != string(want) {
			t.Fatalf("original changed %s: %v", file, err)
		}
	}
}
func TestMigrationPreservesOpaqueHistoryAndRepeatedMove(t *testing.T) {
	config, dest, files := migrationFixture(t)
	p, err := migrate(context.Background(), config, dest, offlineHooks())
	if err != nil {
		t.Fatal(err)
	}
	assertOriginals(t, files)
	if got, err := storage.ResolveConfig(config); err != nil || got != p.Config {
		t.Fatal(got, err)
	}
	if _, err := storage.Bind(config); err == nil {
		t.Fatal("old writers admitted after migration")
	}
	for old, want := range files {
		file := p.Relocate(old)
		if file == old {
			t.Fatalf("unmapped source %s", old)
		}
		got, err := os.ReadFile(file)
		if err != nil || string(got) != string(want) {
			t.Fatalf("copied file differs %s: %v", file, err)
		}
	}
	if st, err := os.Stat(filepath.Join(dest, "Programs", "notes", "empty")); err != nil || !st.IsDir() {
		t.Fatal("empty directory lost", err)
	}
	next := filepath.Join(filepath.Dir(dest), "SecondMove")
	p2, err := migrate(context.Background(), p.Config, next, offlineHooks())
	if err != nil {
		t.Fatal(err)
	}
	if p2.ID != p.ID {
		t.Fatal("unified identity changed on move")
	}
	if got, err := storage.ResolveConfig(config); err != nil || got != p2.Config {
		t.Fatal("redirect chain", got, err)
	}
	// The new profile must work even when both previous data trees are absent.
	if err = os.Rename(filepath.Dir(filepath.Dir(config)), filepath.Join(filepath.Dir(dest), "old-retained")); err != nil {
		t.Fatal(err)
	}
	if err = os.Rename(dest, dest+"-retained"); err != nil {
		t.Fatal(err)
	}
	for old, want := range files {
		got, e := os.ReadFile(p2.Relocate(old))
		if e != nil || string(got) != string(want) {
			t.Fatal("old reference still needs source", e)
		}
	}
}
func TestMigrationResumesEveryDurableBoundary(t *testing.T) {
	for _, stage := range []string{"fenced", "declared", "copied:Config/config.json", "verified", "sealed", "ready", "complete"} {
		t.Run(stage, func(t *testing.T) {
			config, dest, files := migrationFixture(t)
			hooks := offlineHooks()
			stop := errors.New("simulated interruption")
			hooks.checkpoint = func(s string) error {
				if s == stage {
					return stop
				}
				return nil
			}
			if _, err := migrate(context.Background(), config, dest, hooks); !errors.Is(err, stop) {
				t.Fatal("checkpoint not reached", err)
			}
			if stage == "declared" {
				if _, err := Init(dest); err == nil {
					t.Fatal("Init activated migration")
				}
			}
			if stage == "ready" {
				// A completed target may already have new writes before source handoff.
				if err := os.WriteFile(filepath.Join(dest, "Config", "config.json"), []byte(`{"new_user_change":true}`), 0600); err != nil {
					t.Fatal(err)
				}
			}
			p, err := migrate(context.Background(), config, dest, offlineHooks())
			if err != nil {
				t.Fatal(err)
			}
			if _, err = storage.ResolveConfig(config); err != nil {
				t.Fatal(err)
			}
			assertOriginals(t, files)
			if stage == "ready" {
				b, _ := os.ReadFile(p.Config)
				if !strings.Contains(string(b), "new_user_change") {
					t.Fatal("recovery overwrote new destination writes")
				}
			}
		})
	}
}
func TestMigrationRefusesOwnersLocksAndOldProcesses(t *testing.T) {
	for _, kind := range []string{"registered", "lock", "older", "unknown"} {
		t.Run(kind, func(t *testing.T) {
			config, dest, files := migrationFixture(t)
			hooks := offlineHooks()
			release := func() {}
			switch kind {
			case "registered":
				var err error
				release, err = storage.Enter(config)
				if err != nil {
					t.Fatal(err)
				}
			case "lock":
				var err error
				release, err = sessionservice.Lock(filepath.Join(filepath.Dir(filepath.Dir(config)), "Data", "runtime", "attachment-usage-v2.lock"))
				if err != nil {
					t.Fatal(err)
				}
			case "older":
				hooks.processes = func(string, string, string) ([]int, error) { return []int{123}, nil }
			case "unknown":
				hooks.processes = func(string, string, string) ([]int, error) { return nil, errors.New("inspection failed") }
			}
			if _, err := migrate(context.Background(), config, dest, hooks); err == nil {
				release()
				t.Fatal("active or unknown owner accepted")
			}
			release()
			if _, err := storage.Bind(config); err != nil {
				t.Fatal("refused transfer stranded source", err)
			}
			assertOriginals(t, files)
			if _, err := migrate(context.Background(), config, dest, offlineHooks()); err != nil {
				t.Fatal("could not retry after owner exited", err)
			}
		})
	}
}
func TestMigrationConflictsAndChangedSourceStayFenced(t *testing.T) {
	for _, kind := range []string{"target", "source", "journal", "redirect", "new-file"} {
		t.Run(kind, func(t *testing.T) {
			config, dest, files := migrationFixture(t)
			hooks := offlineHooks()
			hooks.checkpoint = func(s string) error {
				if s == "copied:Config/config.json" {
					return errors.New("stop")
				}
				return nil
			}
			if _, err := migrate(context.Background(), config, dest, hooks); err == nil {
				t.Fatal("did not interrupt")
			}
			switch kind {
			case "target":
				os.WriteFile(filepath.Join(dest, "Config", "config.json"), []byte(`{"unrelated":true}`), 0600)
			case "source":
				os.WriteFile(config, []byte(`{"changed_source":true}`), 0600)
				files[config] = []byte(`{"changed_source":true}`)
			case "journal":
				os.WriteFile(filepath.Join(dest, journalName), []byte("{broken"), 0600)
			case "redirect":
				m, _ := storage.ReadMigration(filepath.Join(filepath.Dir(filepath.Dir(config)), "Data"), storage.MigrationBarrier)
				m.Destination = dest + "-wrong"
				writeJSON(filepath.Join(m.SourceRoot, storage.MigrationBarrier), m)
			case "new-file":
				os.WriteFile(filepath.Join(dest, "unrelated.txt"), []byte("keep"), 0600)
			}
			if _, err := migrate(context.Background(), config, dest, offlineHooks()); err == nil {
				t.Fatal("conflict accepted")
			}
			if _, err := storage.ResolveConfig(config); err == nil {
				t.Fatal("unverified transfer activated")
			}
			assertOriginals(t, files)
		})
	}
}
func TestMigrationRefusesUnknownNonemptyAndOverlap(t *testing.T) {
	config, dest, files := migrationFixture(t)
	os.MkdirAll(dest, 0700)
	keep := filepath.Join(dest, "keep")
	os.WriteFile(keep, []byte("untouched"), 0600)
	if _, err := migrate(context.Background(), config, dest, offlineHooks()); err == nil {
		t.Fatal("nonempty accepted")
	}
	if b, _ := os.ReadFile(keep); string(b) != "untouched" {
		t.Fatal("destination altered")
	}
	if _, err := migrate(context.Background(), config, filepath.Join(filepath.Dir(config), "nested"), offlineHooks()); err == nil {
		t.Fatal("overlap accepted")
	}
	assertOriginals(t, files)
}
func TestMigrationRejectsDestinationLink(t *testing.T) {
	config, dest, files := migrationFixture(t)
	outside := t.TempDir()
	if err := os.Symlink(outside, dest); err != nil {
		t.Skip("symlinks unavailable")
	}
	if _, err := migrate(context.Background(), config, dest, offlineHooks()); err == nil {
		t.Fatal("link accepted")
	}
	assertOriginals(t, files)
}
func TestMigrationCorruptCompletedReceiptCannotRedirect(t *testing.T) {
	config, dest, _ := migrationFixture(t)
	if _, err := migrate(context.Background(), config, dest, offlineHooks()); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(dest, storage.MigrationReceiptFile)
	b, _ := os.ReadFile(file)
	var m storage.Migration
	json.Unmarshal(b, &m)
	m.ProfileID = strings.Repeat("f", 32)
	writeJSON(file, m)
	if _, err := storage.ResolveConfig(config); err == nil {
		t.Fatal("corrupt destination accepted")
	}
}

func TestMigrationLegacyMemoryAndFlatLayout(t *testing.T) {
	t.Run("legacy-memory", func(t *testing.T) {
		config, dest, files := migrationFixture(t)
		memory := filepath.Join(filepath.Dir(filepath.Dir(config)), "Data", "memory")
		old := filepath.Join(filepath.Dir(config), "memory")
		if err := os.Rename(memory, old); err != nil {
			t.Fatal(err)
		}
		for file, data := range files {
			if strings.HasPrefix(file, memory+string(filepath.Separator)) {
				delete(files, file)
				files[filepath.Join(old, filepath.Base(file))] = data
			}
		}
		p, err := migrate(context.Background(), config, dest, offlineHooks())
		if err != nil {
			t.Fatal(err)
		}
		for file, data := range files {
			if got, e := os.ReadFile(p.Relocate(file)); e != nil || string(got) != string(data) {
				t.Fatal(file, e)
			}
		}
	})
	t.Run("memory-collision", func(t *testing.T) {
		config, dest, _ := migrationFixture(t)
		old := filepath.Join(filepath.Dir(config), "memory")
		os.MkdirAll(old, 0700)
		os.WriteFile(filepath.Join(old, "eyra.sqlite-wal"), []byte("different database WAL"), 0600)
		if _, err := migrate(context.Background(), config, dest, offlineHooks()); err == nil {
			t.Fatal("separate databases combined")
		}
	})
	t.Run("flat", func(t *testing.T) {
		base := t.TempDir()
		old := filepath.Join(base, "flat")
		os.MkdirAll(old, 0700)
		config := filepath.Join(old, "config.json")
		os.WriteFile(config, []byte("{}"), 0600)
		os.WriteFile(filepath.Join(old, "companion-profile.json"), []byte(`{"name":"fixture"}`), 0600)
		os.WriteFile(filepath.Join(old, "unknown.txt"), []byte("user work"), 0600)
		p, err := migrate(context.Background(), config, filepath.Join(base, "new"), offlineHooks())
		if err != nil {
			t.Fatal(err)
		}
		if b, e := os.ReadFile(filepath.Join(p.Root, "Legacy", "Adjacent", "unknown.txt")); e != nil || string(b) != "user work" {
			t.Fatal(e)
		}
	})
}

func TestMigrationCancellationRetainsBothCopiesAndCannotUndoReady(t *testing.T) {
	config, dest, files := migrationFixture(t)
	hooks := offlineHooks()
	hooks.checkpoint = func(s string) error {
		if s == "copied:Config/config.json" {
			return errors.New("interrupted")
		}
		return nil
	}
	if _, err := migrate(context.Background(), config, dest, hooks); err == nil {
		t.Fatal("did not interrupt")
	}
	if err := CancelMigration(config, dest); err != nil {
		t.Fatal(err)
	}
	if _, err := storage.Bind(config); err != nil {
		t.Fatal(err)
	}
	assertOriginals(t, files)
	if _, err := os.Stat(filepath.Join(dest, "Config", "config.json")); err != nil {
		t.Fatal("partial copy was deleted", err)
	}
	if _, err := migrate(context.Background(), config, dest, offlineHooks()); err == nil {
		t.Fatal("cancelled copy reused")
	}
	dest += "-fresh"
	if _, err := migrate(context.Background(), config, dest, offlineHooks()); err != nil {
		t.Fatal(err)
	}
	if err := CancelMigration(config, dest); err == nil {
		t.Fatal("completed destination rolled back")
	}
}

func TestMigrationKeepsActualComposerDraftScopeAcrossMoves(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Fatal(err)
	}
	config, dest, _ := migrationFixture(t)
	work := t.TempDir()
	moduleRoot, err := filepath.Abs("../..")
	if err != nil {
		t.Fatal(err)
	}
	call := func(config, mode string) string {
		t.Helper()
		cmd := exec.Command(node, "-e", `(async()=>{const [root,config,work,mode]=process.argv.slice(1),store=require(root+'/Client/Desktop/host/composer-draft.cjs').createComposerDraft(config,work);if(mode==='write'){const opened=await store.open();await store.save({token:opened.token,sequence:1,draft:{value:'unsent migration fixture',pastes:'',attachments:[]}});}else{const draft=await store.inspect();if(draft.value!=='unsent migration fixture')throw Error('moved draft disappeared');}await store.close();process.stdout.write(require('node:path').basename(store.file));})().catch(e=>{console.error(e);process.exitCode=1;});`, moduleRoot, config, work, mode)
		b, e := cmd.CombinedOutput()
		if e != nil {
			t.Fatalf("actual composer persistence: %v %s", e, b)
		}
		return string(b)
	}
	identity := call(config, "write")
	p, err := migrate(context.Background(), config, dest, offlineHooks())
	if err != nil {
		t.Fatal(err)
	}
	if p.IdentityConfig() != config {
		t.Fatal("original identity changed")
	}
	old := filepath.Dir(filepath.Dir(config))
	if err = os.Rename(old, old+"-retained"); err != nil {
		t.Fatal(err)
	}
	if call(p.Config, "read") != identity {
		t.Fatal("draft filename changed")
	}
	next, err := migrate(context.Background(), p.Config, dest+"-second", offlineHooks())
	if err != nil {
		t.Fatal(err)
	}
	if call(next.Config, "read") != identity {
		t.Fatal("second move lost identity")
	}
}

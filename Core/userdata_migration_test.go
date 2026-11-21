// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestMigrationPreservesCLIOnlyProjectMemory; TestMigrationRestoresManagedConversationWhenWorkdirMoves; TestMigrationActualArchiveAttachmentsAndNodeGalleryWithoutSource
// Impact: python -B scripts/code-atlas.py show Core/userdata_migration_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/aieyra/aieyra-os/CORE/userdata"
	"github.com/aieyra/aieyra-os/contracts/storage"
)

func TestMigrationPreservesCLIOnlyProjectMemory(t *testing.T) {
	for _, pending := range []bool{false, true} {
		t.Run(fmt.Sprintf("pending=%v", pending), func(t *testing.T) {
			m, root := matrixTestManager(t, func(http.ResponseWriter, *http.Request) { t.Error("migration must not call a model") })
			config, work := m.config, filepath.Join(root, "work", "cli-only")
			if err := os.MkdirAll(work, 0700); err != nil {
				t.Fatal(err)
			}
			open := func(config, work string) (*Workspace, *SettingsService) {
				s := NewSettingsService(config)
				h := NewWorkspaceHost(config, "", "")
				if err := h.SetMode(HostCLI); err != nil {
					t.Fatal(err)
				}
				w, err := newWorkspace(config, "", work, "", s, h)
				if err != nil {
					s.Close()
					t.Fatal(err)
				}
				t.Cleanup(func() { w.Close(); s.Close() })
				return w, s
			}
			call := func(w *Workspace, a map[string]any) map[string]any {
				t.Helper()
				raw, err := w.memory(context.Background(), a)
				var result map[string]any
				if err != nil || json.Unmarshal(raw, &result) != nil || result["ok"] != true {
					t.Fatalf("memory call failed: %s %v", raw, err)
				}
				return result
			}
			w, service := open(config, work)
			project := w.memoryProject(work)
			var record map[string]any
			if pending {
				service.Close()
				w.transcribe(transcriptRows(w.state.ID+"/cli", 0, []Message{{Role: RoleUser, Content: "cli-only durable original"}}, nil))
				w.flushTranscript(time.Second)
				if _, err := os.Stat(filepath.Join(PrivatePaths(config).Memory, "eyra.sqlite")); !os.IsNotExist(err) {
					t.Fatal("pending-only fixture already has a database", err)
				}
			} else {
				record = call(w, map[string]any{"action": "record", "scope": "project", "title": "CLI project", "content": "cli-only durable original"})["record"].(map[string]any)
			}
			if _, err := os.Stat(filepath.Join(w.contextDirectory(), "sessions.json")); !os.IsNotExist(err) {
				t.Fatal("CLI-only fixture acquired a desktop catalog", err)
			}
			w.Close()
			service.Close()
			m.Close()
			for move := 0; move < 2; move++ {
				p, err := userdata.Migrate(context.Background(), config, filepath.Join(t.TempDir(), "UserData"))
				if err != nil {
					t.Fatal(err)
				}
				work = p.Relocate(work)
				if err = os.Rename(root, root+"-retained"); err != nil {
					t.Fatal(err)
				}
				reopened, s := open(p.Config, work)
				if reopened.memoryProject(work) != project {
					t.Fatal("CLI project memory identity changed")
				}
				if pending {
					reopened.flushTranscript(time.Second)
					got := call(reopened, map[string]any{"action": "transcript_history", "exclude_prefix": "unrelated/", "limit": 50})
					if !strings.Contains(string(rawJSON(got)), "cli-only durable original") {
						t.Fatal("pending original was lost")
					}
				} else {
					got := call(reopened, map[string]any{"action": "read", "id": record["id"]})["record"].(map[string]any)
					if got["content"] != record["content"] {
						t.Fatal("original memory changed")
					}
				}
				reopened.Close()
				s.Close()
				config, root = p.Config, p.Root
			}
			otherWork := filepath.Join(root, "work", "another-cli-project")
			if err := os.MkdirAll(otherWork, 0700); err != nil {
				t.Fatal(err)
			}
			other, otherService := open(config, otherWork)
			if other.memoryProject(otherWork) == project {
				t.Fatal("migration crossed the CLI project boundary")
			}
			if !pending {
				raw, err := other.memory(context.Background(), map[string]any{"action": "read", "id": record["id"]})
				if err != nil || strings.Contains(string(raw), "cli-only durable original") || !strings.Contains(string(raw), `"ok":false`) {
					t.Fatal("another CLI project could read the original memory", err)
				}
			}
			other.Close()
			otherService.Close()
			// A second real scope under the new path must not be silently merged.
			s := NewSettingsService(config)
			raw, err := s.CallTool(context.Background(), "memory", "conflict", rawJSON(map[string]any{"action": "record", "_project": memoryProjectIdentity(work), "scope": "project", "title": "distinct scope", "content": "separate original"}))
			if err != nil || !strings.Contains(string(raw), "separate original") {
				t.Fatal("conflict fixture failed", err)
			}
			s.Close()
			s = NewSettingsService(config)
			h := NewWorkspaceHost(config, "", "")
			if err = h.SetMode(HostCLI); err != nil {
				t.Fatal(err)
			}
			conflicting, err := newWorkspace(config, "", work, "", s, h)
			if err == nil {
				conflicting.Close()
				t.Fatal("conflicting project identities were silently merged")
			}
			if !strings.Contains(err.Error(), "多个记忆项目") {
				t.Fatal("conflict did not fail at the identity boundary", err)
			}
			if !pending {
				raw, err := s.CallTool(context.Background(), "memory", "verify", rawJSON(map[string]any{"action": "read", "_project": project, "id": record["id"]}))
				if err != nil || !strings.Contains(string(raw), "cli-only durable original") {
					t.Fatal("conflict changed the original memory", err)
				}
			}
			s.Close()
		})
	}
}

func TestMigrationRestoresManagedConversationWhenWorkdirMoves(t *testing.T) {
	calls := 0
	m, old := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
		calls++
		fixtureAnswer(w, "moved", "original reply", nil)
	})
	work := filepath.Join(old, "work", "中文项目")
	if err := os.MkdirAll(work, 0700); err != nil {
		t.Fatal(err)
	}
	w := modeWorkspace(t, m.config, work, HostOS)
	id := contextTestAction(t, w, "new", map[string]any{"title": "moving project"})["session_id"]
	original := "preserve original project " + work
	project := w.memoryProject(work)
	contextTestTurn(t, w, original)
	archive := w.contextArchivePath(w.contextSessionLocked().Archive)
	w.Close()
	w.host.Close()
	m.Close()
	bytesBefore, err := os.ReadFile(archive)
	if err != nil {
		t.Fatal(err)
	}
	config, currentRoot, currentWork := m.config, old, work
	for move := 0; move < 2; move++ {
		p, err := userdata.Migrate(context.Background(), config, filepath.Join(t.TempDir(), "UserData"))
		if err != nil {
			t.Fatal(err)
		}
		currentWork = p.Relocate(currentWork)
		if err = os.Rename(currentRoot, currentRoot+"-retained"); err != nil {
			t.Fatal(err)
		}
		reopened := modeWorkspace(t, p.Config, currentWork, HostOS)
		v := contextTestView(t, reopened)
		if reopened.memoryProject(currentWork) != project {
			t.Fatal("migration changed the memory project identity")
		}
		if v["session_id"] != id || !strings.Contains(v["text"].(string), original) {
			t.Fatalf("move %d opened a different conversation: got %v, expected %v", move+1, v["session_id"], id)
		}
		got, err := os.ReadFile(p.Relocate(archive))
		if err != nil || !bytes.Equal(got, bytesBefore) {
			t.Fatal("moved original archive changed", err)
		}
		reopened.Close()
		reopened.host.Close()
		cli := modeWorkspace(t, p.Config, currentWork, HostCLI)
		if cli.memoryProject(currentWork) != project {
			t.Fatal("standalone CLI changed the migrated memory project identity")
		}
		cli.Close()
		cli.host.Close()
		bytesBefore, err = os.ReadFile(p.Relocate(archive))
		if err != nil {
			t.Fatal(err)
		}
		config, currentRoot = p.Config, p.Root
	}
	if calls != 1 {
		t.Fatal("migration replayed a model request", calls)
	}
	// Another project must remain empty. Conflicting old/new catalogs must not
	// silently select either conversation or overwrite either durable record.
	other := filepath.Join(currentRoot, "another-project")
	if err = os.MkdirAll(other, 0700); err != nil {
		t.Fatal(err)
	}
	empty := modeWorkspace(t, config, other, HostOS)
	if strings.Contains(contextTestView(t, empty)["text"].(string), original) {
		t.Fatal("migration crossed project boundary")
	}
	empty.Close()
	empty.host.Close()
	p := storage.Bound(config)
	catalog := filepath.Join(filepath.Dir(p.Relocate(archive)), "sessions.json")
	stored, err := os.ReadFile(catalog)
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256([]byte(filepath.Clean(currentWork)))
	conflicting := filepath.Join(PrivatePaths(config).Context, "eyra", fmt.Sprintf("%x", sum[:12]), "sessions.json")
	if err = os.MkdirAll(filepath.Dir(conflicting), 0700); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(conflicting, stored, 0600); err != nil {
		t.Fatal(err)
	}
	h := NewWorkspaceHost(config, "", "")
	defer h.Close()
	if err = h.SetMode(HostOS); err != nil {
		t.Fatal(err)
	}
	opened, err := newWorkspace(config, "", currentWork, "", nil, h)
	if err == nil {
		opened.Close()
		t.Fatal("ambiguous migrated catalogs were admitted")
	}
	for _, file := range []string{catalog, conflicting} {
		got, e := os.ReadFile(file)
		if e != nil || !bytes.Equal(got, stored) {
			t.Fatal("ambiguous catalog changed", e)
		}
	}
}

func TestMigrationActualArchiveAttachmentsAndNodeGalleryWithoutSource(t *testing.T) {
	base := t.TempDir()
	old := filepath.Join(base, "old")
	config := filepath.Join(old, "Config", "config.json")
	if err := os.MkdirAll(filepath.Dir(config), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(config, []byte(`{}`), 0600); err != nil {
		t.Fatal(err)
	}
	if err := ValidatePrivateProfile(config); err != nil {
		t.Fatal(err)
	}
	picture := image.NewRGBA(image.Rect(0, 0, 2, 2))
	picture.Set(0, 0, color.RGBA{R: 255, A: 255})
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, picture); err != nil {
		t.Fatal(err)
	}
	payload := encoded.Bytes()
	digest := fmt.Sprintf("%x", sha256.Sum256(payload))
	paths := PrivatePaths(config)
	asset := filepath.Join(paths.Attachments, "v2", digest)
	gallery := filepath.Join(paths.Gallery, "assets", digest+".png")
	for _, file := range []string{asset, gallery} {
		os.MkdirAll(filepath.Dir(file), 0700)
		if err := os.WriteFile(file, payload, 0600); err != nil {
			t.Fatal(err)
		}
	}
	library := map[string]any{"version": 1, "hidden": map[string]bool{}, "items": []any{map[string]any{"id": digest, "sha256": digest, "path": gallery, "source": "imported", "mime": "image/png", "width": 2, "height": 2}}}
	if err := os.WriteFile(filepath.Join(paths.Gallery, "library.json"), rawJSON(library), 0600); err != nil {
		t.Fatal(err)
	}
	a, err := NewSessionArchive(config)
	if err != nil {
		t.Fatal(err)
	}
	if err = a.Lock(); err != nil {
		t.Fatal(err)
	}
	if err = a.Start(ModelFlash); err != nil {
		t.Fatal(err)
	}
	message := Message{Role: RoleUser, Content: "keep literal old path " + asset, Images: []ImageAttachment{{Name: "fixture.png", Asset: asset, SHA256: digest, MIME: "image/png", Bytes: len(payload), Width: 2, Height: 2}}}
	if err = a.Append("message", message); err != nil {
		t.Fatal(err)
	}
	a.Close()
	original, err := os.ReadFile(a.Path)
	if err != nil {
		t.Fatal(err)
	}
	p, err := userdata.Migrate(context.Background(), config, filepath.Join(base, "UserData"))
	if err != nil {
		t.Fatal(err)
	}
	if resolved, err := storage.ResolveConfig(config); err != nil || resolved != p.Config {
		t.Fatal(resolved, err)
	}
	node, err := exec.LookPath("node")
	if err != nil {
		t.Fatal("Node required for cross-client migration integration", err)
	}
	moduleRoot, err := filepath.Abs("..")
	if err != nil {
		t.Fatal(err)
	}
	follow := exec.Command(node, "-e", `const p=require(process.argv[1]+'/Contracts/storage/profile.cjs');if(p.resolve(process.argv[2])!==process.argv[3])throw Error('JS redirect differs');`, moduleRoot, config, p.Config)
	if out, err := follow.CombinedOutput(); err != nil {
		t.Fatalf("Node migration entry: %v %s", err, out)
	}
	if err = os.Rename(old, old+"-retained"); err != nil {
		t.Fatal(err)
	}
	restoredArchive, restored, err := RestoreSession(p.Config, a.ID())
	if err != nil {
		t.Fatal(err)
	}
	defer restoredArchive.Close()
	if len(restored.Messages) != 1 || restored.Messages[0].Content != message.Content || restored.Messages[0].Images[0].Asset != asset {
		t.Fatal("history was rewritten")
	}
	copied, err := os.ReadFile(restoredArchive.Path)
	if err != nil || !bytes.Equal(copied, original) {
		t.Fatal("opaque archive changed", err)
	}
	images := requestImages(true, p.Config)(restored.Messages[0])
	if len(images) != 1 || images[0].DataURL == "" {
		t.Fatal("historical request image could not be read")
	}
	composer := ComposerAttachment{Name: "fixture.png", Asset: asset, SHA256: digest, MIME: "image/png", Bytes: len(payload), Kind: "image"}
	s := Defaults()
	s.Model = ModelFlash
	s.APIProtocol = ProtocolResponses
	if _, err = prepareComposerAttachments(p.Config, []ComposerAttachment{composer}, s); err != nil {
		t.Fatal("composer cannot read moved asset", err)
	}
	receipt, _ := json.Marshal(composer)
	cmd := exec.Command(node, "-e", `(async()=>{
 const [root,config,serialized,id]=process.argv.slice(1),fs=require('node:fs'),p=require(root+'/Contracts/storage/profile.cjs');
 const release=p.use(config);try{
  const a=JSON.parse(serialized),store=require(root+'/Client/Desktop/host/attachments.cjs').createAttachmentStore(config);
  const data=await store.readVerified(a);if(!data.length)throw Error('attachment unavailable');
  const library=require(root+'/Client/Desktop/host/image-library.cjs').createImageLibrary(config,{decode:bytes=>({width:2,height:2,mime:'image/png',data:bytes})});
  const item=await library.resolve(id);if(!fs.existsSync(item.path)||!item.path.startsWith(p.bind(config).root))throw Error('gallery escaped profile');
  const image=await library.preview(id);if(!image.data.startsWith('data:image/png;base64,'))throw Error('gallery preview failed');
  if(a.asset!==JSON.parse(serialized).asset)throw Error('serialized history mutated');
 }finally{release();}
})().catch(e=>{console.error(e);process.exitCode=1});`, moduleRoot, p.Config, string(receipt), digest)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("Node actual file consumers: %v %s", err, out)
	}
}

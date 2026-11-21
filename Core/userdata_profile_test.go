// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestUserDataServicesUseDeclaredRoot; TestUserDataIncompleteProfileRejectsEveryAdmissionBeforeEffects; TestUserDataPromptDefaultsAndOverridesRemainSeparate
// Impact: python -B scripts/code-atlas.py show Core/userdata_profile_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/aieyra/aieyra-os/CORE/userdata"
	"github.com/aieyra/aieyra-os/contracts/storage"
)

func TestUserDataServicesUseDeclaredRoot(t *testing.T) {
	p, err := userdata.Init(filepath.Join(t.TempDir(), "UserData"))
	if err != nil {
		t.Fatal(err)
	}
	s, err := Load(p.Config)
	if err != nil {
		t.Fatal(err)
	}
	s.Language = "en-US"
	if err = s.Save(); err != nil {
		t.Fatal(err)
	}
	archive, err := NewSessionArchive(p.Config)
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Dir(archive.Path) != filepath.Join(p.Root, "Sessions", "standalone") {
		t.Fatal(archive.Path)
	}
	id := "0123456789abcdef0123456789abcdef"
	session, err := SessionPath(p.Config, id)
	if err != nil || filepath.Dir(session) != filepath.Dir(archive.Path) {
		t.Fatal(session, err)
	}
	child, err := childPromptFile(p.Config, id)
	if err != nil || child != filepath.Join(p.Overrides, "Prompt", "子代", id, "提示词.txt") {
		t.Fatal(child, err)
	}
	usage, err := attachmentUsagePath(p.Config)
	if err != nil || filepath.Dir(usage) != filepath.Join(p.Root, "Runtime") {
		t.Fatal(usage, err)
	}
	if _, err = os.Stat(filepath.Join(p.Root, "Data")); !os.IsNotExist(err) {
		t.Fatal("created legacy root", err)
	}
}

func TestUserDataIncompleteProfileRejectsEveryAdmissionBeforeEffects(t *testing.T) {
	for name, call := range map[string]func(string) error{
		"load":    func(c string) error { _, e := Load(c); return e },
		"archive": func(c string) error { _, e := NewSessionArchive(c); return e },
		"session": func(c string) error { _, e := SessionPath(c, "0123456789abcdef0123456789abcdef"); return e },
		"manager": func(c string) error { _, e := NewAgentManager(c, "0123456789abcdef0123456789abcdef", nil); return e },
		"workspace": func(c string) error {
			h := NewWorkspaceHost(c, "", "")
			defer h.Close()
			_, e := h.Open("", t.TempDir())
			return e
		},
		"settings": func(c string) error {
			s := NewSettingsService(c)
			defer s.Close()
			_, e := s.address(context.Background())
			return e
		},
		"attachments": func(c string) error { _, e := attachmentUsagePath(c); return e },
		"images": func(c string) error {
			_, e := runImageGen(context.Background(), c, json.RawMessage(`{"action":"list"}`))
			return e
		},
	} {
		t.Run(name, func(t *testing.T) {
			root := t.TempDir()
			file := filepath.Join(root, storage.ProfileMarker)
			raw := []byte(`{"schema":"aieyra.user-data/1","id":"0123456789abcdef0123456789abcdef","state":"initializing","config":"Config/config.json"}`)
			if err := os.WriteFile(file, raw, 0600); err != nil {
				t.Fatal(err)
			}
			if err := call(filepath.Join(root, "Config", "config.json")); err == nil {
				t.Fatal("unfinished profile admitted")
			}
			entries, _ := os.ReadDir(root)
			if len(entries) != 1 {
				t.Fatal("admission wrote private data", entries)
			}
		})
	}
}

func TestUserDataPromptDefaultsAndOverridesRemainSeparate(t *testing.T) {
	a, err := userdata.Init(filepath.Join(t.TempDir(), "a"))
	if err != nil {
		t.Fatal(err)
	}
	b, err := userdata.Init(filepath.Join(t.TempDir(), "b"))
	if err != nil {
		t.Fatal(err)
	}
	install := t.TempDir()
	t.Setenv("AIEYRA_RESOURCE_ROOT", install)
	write := func(base, name, body string) string {
		p := filepath.Join(base, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(p), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(body), 0600); err != nil {
			t.Fatal(err)
		}
		return p
	}
	write(install, "Config/提示词索引.json", `{"resources":[{"file":"Matrix/manual.txt","path":"Tool/base/official/example/manual.txt","legacy_sha256":"0000000000000000000000000000000000000000000000000000000000000000"}]}`)
	write(install, "Prompt/Matrix/manual.txt", "installation customization")
	official := write(install, "Tool/base/official/example/manual.txt", "official default")
	release, err := UsePrivateProfile(a.Config)
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	if got := ResolvePromptDir(""); got != filepath.Join(a.Overrides, "Prompt", "Matrix") {
		t.Fatal(got)
	}
	role := filepath.Join(storage.Resolve(a.Root).Agents, "Eyra", "prompts")
	write(role, "边界.txt", "")
	if got := ResolvePromptDir(""); got != role {
		t.Fatal("role-owned personal prompts not selected", got)
	}
	if layer, err := PromptLayer(ResolvePromptDir(""), "boundary"); err != nil || layer.Path == "" || layer.Body != "" {
		t.Fatal("empty personal layer was lost", layer, err)
	}
	if got := ResolvePromptDir(a.Overrides); got != a.Overrides {
		t.Fatal("explicit directory was overridden", got)
	}
	if got, err := promptResourcePath("Matrix/manual.txt"); err != nil || got != official {
		t.Fatal(got, err)
	}
	personal := write(a.Overrides, "Prompt/Matrix/manual.txt", "personal customization")
	if got, err := promptResourcePath("Matrix/manual.txt"); err != nil || got != personal {
		t.Fatal(got, err)
	}
	release()
	releaseB, err := UsePrivateProfile(b.Config)
	if err != nil {
		t.Fatal(err)
	}
	defer releaseB()
	if got, err := promptResourcePath("Matrix/manual.txt"); err != nil || got != official {
		t.Fatal(got, err)
	}
}

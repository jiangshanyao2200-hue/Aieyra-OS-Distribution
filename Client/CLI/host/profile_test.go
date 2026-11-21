// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/CLI/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: TestProfileCommandInitializesInspectsAndResolvesSharedLayout; TestProfilePrepareUsesInstallationLocalData; TestProfileEmptyConfigurationAcceptsOneVerifiedInitialization
// Impact: python -B scripts/code-atlas.py show Client/CLI/host/profile_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package cli

import (
	"bytes"
	"context"
	"encoding/json"
	"github.com/aieyra/aieyra-os/CORE/userdata"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
)

func TestProfileCommandInitializesInspectsAndResolvesSharedLayout(t *testing.T) {
	root := filepath.Join(t.TempDir(), "UserData")
	var out, diagnostic bytes.Buffer
	if err := Run(context.Background(), []string{"profile", "init", "--root", root}, nil, &out, &diagnostic, "test"); err != nil {
		t.Fatal(err, diagnostic.String())
	}
	var p struct {
		Config  string
		Unified bool
	}
	if err := json.Unmarshal(out.Bytes(), &p); err != nil || !p.Unified || p.Config != filepath.Join(root, "Config", "config.json") {
		t.Fatal(out.String(), err)
	}
	out.Reset()
	if err := Run(context.Background(), []string{"mods", "--config", p.Config}, bytes.NewBufferString(`{"action":"capabilities"}`), &out, &diagnostic, "test"); err != nil {
		t.Fatal(err)
	}
	var layout struct {
		Layout struct{ Data, Packages string }
	}
	if err := json.Unmarshal(out.Bytes(), &layout); err != nil {
		t.Fatal(err)
	}
	if layout.Layout.Data != root || layout.Layout.Packages != filepath.Join(root, "Packages", "registry") {
		t.Fatal(out.String())
	}
	if _, err := os.Stat(filepath.Join(root, "Data")); !os.IsNotExist(err) {
		t.Fatal("CLI created legacy root", err)
	}
	out.Reset()
	if err := Run(context.Background(), []string{"profile", "inspect", "--root", root}, nil, &out, &diagnostic, "test"); err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(out.Bytes(), []byte(`"state":"ready"`)) {
		t.Fatal(out.String())
	}
}

func TestProfilePrepareUsesInstallationLocalData(t *testing.T) {
	root := t.TempDir()
	var out, diagnostic bytes.Buffer
	if err := Run(context.Background(), []string{"profile", "prepare", "--root", root}, nil, &out, &diagnostic, "test"); err != nil {
		t.Fatal(err)
	}
	var p struct {
		Config  string
		Unified bool
	}
	if err := json.Unmarshal(out.Bytes(), &p); err != nil || !p.Unified || p.Config != filepath.Join(root, "Data", "Config", "config.json") {
		t.Fatal(out.String(), err)
	}
}

func TestProfileEmptyConfigurationAcceptsOneVerifiedInitialization(t *testing.T) {
	sharedSettingsRoot(t)
	p, err := userdata.Init(filepath.Join(t.TempDir(), "UserData"))
	if err != nil {
		t.Fatal(err)
	}
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1); answer(w, "profile-init", "hello", nil) }))
	defer server.Close()
	t.Setenv("CLI_PROFILE_TEST_KEY", "synthetic-profile-key")
	args := []string{"init", "--config", p.Config, "--base-url", server.URL, "--model", "fixture", "--key-env", "CLI_PROFILE_TEST_KEY"}
	out, diagnostic, err := runTest(t, args, "")
	if err != nil || calls.Load() != 1 || !strings.Contains(out, `"response_verified":true`) {
		t.Fatal(err, calls.Load(), out, diagnostic)
	}
	before, err := os.ReadFile(p.Config)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := runTest(t, args, ""); err == nil {
		t.Fatal("overwrote configured profile")
	}
	after, _ := os.ReadFile(p.Config)
	if !bytes.Equal(before, after) || calls.Load() != 1 {
		t.Fatal("repeated verification or changed settings")
	}
	if strings.Contains(out+diagnostic, "synthetic-profile-key") {
		t.Fatal("credential leaked")
	}
}

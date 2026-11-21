// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/extensionhost/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestOfficialToolsRegisterExactPayloadAndPreserveDisable; TestOfficialNativeToolRejectsModifiedPayloadAndOldHost; TestOfficialTerminalPreviousInstalledPayloadUpgrade; TestOfficialTerminalUpgradeBeforeTranscriptHandoff
// Impact: python -B scripts/code-atlas.py show Core/extensionhost/official_tools_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package extensionhost

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/aieyra/aieyra-os/CORE/modules"
	toolowner "github.com/aieyra/aieyra-os/tool"
)

func TestOfficialToolsRegisterExactPayloadAndPreserveDisable(t *testing.T) {
	m, ctx := New(t.TempDir(), Desktop()), context.Background()
	for _, row := range toolowner.Officials() {
		r, err := m.Call(ctx, modules.Request{Action: "resolve", ID: row.ID})
		if err != nil || r.Item == nil || r.Item.Origin != "official" {
			t.Fatal(row.ID, err)
		}
		p, err := modules.Load(ctx, r.Directory)
		if err != nil {
			t.Fatal(err)
		}
		definition, err := Tool(p)
		if err != nil || definition.Native != row.Name {
			t.Fatal(row.ID, definition, err)
		}
		if len(p.Manifest.Files) < 6 {
			t.Fatal("tool omitted implementation, manual or views", row.ID)
		}
		_, err = m.Call(ctx, modules.Request{Action: "disable", ID: row.ID, ExpectedDigest: r.Item.Digest, ExpectedRevision: &r.Revision, RequestID: "disable-" + row.Name})
		if err != nil {
			t.Fatal(err)
		}
		m = New(m.Root, Desktop())
		if _, err = m.Call(ctx, modules.Request{Action: "resolve", ID: row.ID}); err == nil {
			t.Fatal("disabled tool revived", row.ID)
		}
	}
}

func TestOfficialNativeToolRejectsModifiedPayloadAndOldHost(t *testing.T) {
	files, err := toolowner.PackageFiles("aieyra.tool.terminal")
	if err != nil {
		t.Fatal(err)
	}
	p, err := modules.FromFiles(files)
	if err != nil {
		t.Fatal(err)
	}
	host := Desktop()
	host.Contracts["tool"] = "1.0.0"
	if modules.Check(p.Manifest, host, nil).Compatible {
		t.Fatal("old host accepted native adapter")
	}
	files["execute.go"] = append(files["execute.go"], []byte("\n// altered native execution\n")...)
	sum := sha256.Sum256(files["execute.go"])
	p.Manifest.Files["execute.go"] = modules.File{SHA256: hex.EncodeToString(sum[:]), Size: int64(len(files["execute.go"]))}
	files["manifest.json"], _ = json.Marshal(p.Manifest)
	dir := t.TempDir()
	for name, raw := range files {
		f := filepath.Join(dir, name)
		if err = os.MkdirAll(filepath.Dir(f), 0700); err != nil {
			t.Fatal(err)
		}
		if err = os.WriteFile(f, raw, 0600); err != nil {
			t.Fatal(err)
		}
	}
	m := New(t.TempDir(), Desktop())
	if inspected, err := m.Inspect(context.Background(), dir); err == nil && inspected.Compatibility.Compatible {
		t.Fatal("rewritten native source obtained compiled execution authority")
	}
}

func TestOfficialTerminalPreviousInstalledPayloadUpgrade(t *testing.T) {
	dir := os.Getenv("AIEYRA_PREVIOUS_TOOL_PACKAGE")
	if dir == "" {
		t.Skip("exact previous public tool package supplied by acceptance")
	}
	prior, err := modules.Load(context.Background(), dir)
	if err != nil {
		t.Fatal(err)
	}
	if prior.Manifest.ID != "aieyra.tool.terminal" || prior.Digest != "5089f1faeffa4f21f5cec81e3ed9f7ecf28841b47f6ac0b370548404d8353883" {
		t.Fatal("unexpected previous terminal payload")
	}
	verifyOfficialProgramUpgrade(t, prior, "presentation/desktop.mjs")
}

func TestOfficialTerminalUpgradeBeforeTranscriptHandoff(t *testing.T) {
	dir := os.Getenv("AIEYRA_TERMINAL_BEFORE_HANDOFF")
	if dir == "" {
		t.Skip("exact previous 1.0.4 public terminal package supplied by acceptance")
	}
	prior, err := modules.Load(context.Background(), dir)
	if err != nil {
		t.Fatal(err)
	}
	if prior.Manifest.ID != "aieyra.tool.terminal" || prior.Manifest.Version != "1.0.4" || prior.Digest != "5c72b1c185f2d11b62ac72173faf3ccea4a96f6e5c38a43d51402a6a76357205" {
		t.Fatal("unexpected pre-handoff terminal payload")
	}
	verifyOfficialProgramUpgrade(t, prior, "presentation/desktop.mjs")
}

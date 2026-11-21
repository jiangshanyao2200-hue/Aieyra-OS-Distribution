// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestAgentPackageExportPreservesSignatureAndBounds; TestAgentPackageExportPublicOnlyAndFreshImport; TestAgentPackageExportExactDisabledOldSourceAndFailures
// Impact: python -B scripts/code-atlas.py show Core/agent_package_export_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/aieyra/aieyra-os/CORE/modules"
	agent "github.com/aieyra/aieyra-os/agent/contract"
)

func TestAgentPackageExportPreservesSignatureAndBounds(t *testing.T) {
	p, err := modules.Load(context.Background(), filepath.Join(mustProjectRoot(t), "SDK/examples/agent-reviewer"))
	if err != nil {
		t.Fatal(err)
	}
	pub, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	var canonical any
	if err = json.Unmarshal(rawJSON(p.Manifest), &canonical); err != nil {
		t.Fatal(err)
	}
	p.Manifest.Signature = &modules.Signature{PublicKey: base64.StdEncoding.EncodeToString(pub), Value: base64.StdEncoding.EncodeToString(ed25519.Sign(key, rawJSON(canonical)))}
	p.Files["manifest.json"] = rawJSON(p.Manifest)
	p, err = modules.FromFiles(p.Files)
	if err != nil {
		t.Fatal(err)
	}
	archive, err := archiveAgentTemplate(context.Background(), p)
	if err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(t.TempDir(), "signed.zip")
	if err = os.WriteFile(file, archive, 0600); err != nil {
		t.Fatal(err)
	}
	loaded, err := modules.Load(context.Background(), file)
	if err != nil || loaded.Digest != p.Digest || !reflect.DeepEqual(loaded.Manifest.Signature, p.Manifest.Signature) {
		t.Fatal("signature was stripped or changed", err)
	}
	p.Manifest.Signature = nil
	p.Files["large-public-asset.txt"] = bytes.Repeat([]byte("a"), maxAgentTemplateBytes)
	sum := sha256.Sum256(p.Files["large-public-asset.txt"])
	p.Manifest.Files["large-public-asset.txt"] = modules.File{Size: maxAgentTemplateBytes, SHA256: hex.EncodeToString(sum[:])}
	p.Files["manifest.json"] = rawJSON(p.Manifest)
	p, err = modules.FromFiles(p.Files)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = archiveAgentTemplate(context.Background(), p); err == nil || !strings.Contains(err.Error(), "2 MiB") {
		t.Fatal("export did not enforce its transport budget", err)
	}
}

func TestAgentPackageExportPublicOnlyAndFreshImport(t *testing.T) {
	_, w, m, dir, identity := packageAgentFixture(t, func(http.ResponseWriter, *http.Request) { t.Error("export or creation called a model") })
	a := newPackageAgent(t, m, identity, "private-export", dir)
	private := "PRIVATE_EXPORT_SENTINEL"
	a = changePackageAgent(t, m, a, agentPackageCommand{Action: "configure", Prompt: &private, Title: private})
	m.mu.Lock()
	j := m.jobs[a.ID]
	j.record.Result = private
	j.record.Spec.ModelID = private
	j.record.Instance.Workflow = &agent.WorkflowBinding{ID: private, Owner: private, Package: private}
	m.mu.Unlock()
	memoryDir := filepath.Join(PrivatePaths(m.config).Agents, a.ID, "memory")
	if err := os.MkdirAll(memoryDir, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(memoryDir, "private.txt"), []byte(private), 0600); err != nil {
		t.Fatal(err)
	}
	w.prompt = private
	raw, err := w.packageAgentsCall(context.Background(), rawJSON(agentPackageCommand{Action: "export", ID: a.ID}))
	if err != nil {
		t.Fatal(err)
	}
	out := raw.(agentTemplateExport)
	if out.Package != identity {
		t.Fatal("export changed the instance's pinned source")
	}
	archive := filepath.Join(t.TempDir(), out.Filename)
	if err = os.WriteFile(archive, out.Archive, 0600); err != nil {
		t.Fatal(err)
	}
	exported, err := modules.Load(context.Background(), archive)
	if err != nil {
		t.Fatal(err)
	}
	original, err := modules.Load(context.Background(), filepath.Join(mustProjectRoot(t), "SDK/examples/agent-reviewer"))
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(original.Files, exported.Files) || exported.Digest != original.Digest {
		t.Fatal("public source changed")
	}
	for name, data := range exported.Files {
		for _, secret := range []string{private, a.ID, dir, "workflow_binding"} {
			if bytes.Contains(data, []byte(secret)) {
				t.Fatalf("private instance material exported in %s", name)
			}
		}
	}
	if _, err = m.packageAgentCommand(context.Background(), a.ID, agentPackageCommand{Action: "export", Package: identity}); err == nil {
		t.Fatal("model actor exported a template")
	}
	// Import through the ordinary registry into an independent Core service.
	_, _, other, otherDir, _ := packageAgentFixture(t, func(http.ResponseWriter, *http.Request) { t.Error("fresh import executed a model") })
	packageMutation(t, other.toolPackages(), "install", archive, "", original.Manifest.Permissions)
	packageMutation(t, other.toolPackages(), "enable", "", original.Manifest.ID, original.Manifest.Permissions)
	fresh := newPackageAgent(t, other, identity, "fresh-import", otherDir)
	if fresh.State != "idle" || fresh.Generation != 0 || fresh.ID == a.ID || fresh.Result != "" || fresh.Instance.Prompt != nil || fresh.Instance.Workflow != nil || fresh.Instance.Supervisor != "" || strings.Contains(string(rawJSON(fresh)), private) {
		t.Fatal("import inherited private execution state")
	}
	if _, err = os.Stat(filepath.Join(PrivatePaths(other.config).Agents, fresh.ID, "memory", "private.txt")); !os.IsNotExist(err) {
		t.Fatal("fresh instance inherited memory", err)
	}
}

func TestAgentPackageExportExactDisabledOldSourceAndFailures(t *testing.T) {
	_, _, m, dir, identity := packageAgentFixture(t, func(http.ResponseWriter, *http.Request) { t.Error("unexpected model") })
	a := newPackageAgent(t, m, identity, "pinned-export", dir)
	baseline, err := m.exportAgentTemplate(context.Background(), m.owner, agentPackageCommand{ID: a.ID})
	if err != nil {
		t.Fatal(err)
	}
	packageMutation(t, m.toolPackages(), "disable", "", "example.reviewer", nil)
	packageMutation(t, m.toolPackages(), "install", agentPackageVersion(t, "1.1.0", "NEW_PUBLIC_TEMPLATE"), "", nil)
	again, err := m.exportAgentTemplate(context.Background(), m.owner, agentPackageCommand{ID: a.ID})
	if err != nil || !bytes.Equal(again.Archive, baseline.Archive) {
		t.Fatal("disabled old source was substituted", err)
	}
	for _, p := range []agentPackageCommand{{ID: a.ID, Package: "mod:example.other@" + strings.Repeat("0", 64)}, {Package: "mod:example.reviewer@../../private"}, {Package: "mod:example.other@" + strings.Split(identity, "@")[1]}} {
		if _, err := m.exportAgentTemplate(context.Background(), m.owner, p); err == nil {
			t.Fatal("forged identity accepted")
		}
	}
	object := filepath.Join(m.toolPackages().Root, "objects", strings.Split(identity, "@")[1])
	if err = os.WriteFile(filepath.Join(object, "prompts/identity.txt"), []byte("TAMPERED_PUBLIC_SOURCE"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = m.exportAgentTemplate(context.Background(), m.owner, agentPackageCommand{ID: a.ID}); err == nil {
		t.Fatal("corrupt source exported")
	}
	if err = os.RemoveAll(object); err != nil {
		t.Fatal(err)
	}
	if _, err = m.exportAgentTemplate(context.Background(), m.owner, agentPackageCommand{ID: a.ID}); err == nil {
		t.Fatal("missing source reconstructed from private instance")
	}
	compiled, err := compiledAgentPackages()
	if err != nil {
		t.Fatal(err)
	}
	for id, p := range compiled {
		out, err := m.exportAgentTemplate(context.Background(), m.owner, agentPackageCommand{Package: "mod:" + id + "@" + p.Digest})
		if err != nil || len(out.Archive) == 0 {
			t.Fatal("official public source unavailable", id, err)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err = m.packageAgentCommand(ctx, m.owner, agentPackageCommand{Action: "export", ID: a.ID}); err == nil {
		t.Fatal("cancelled export succeeded")
	}
}

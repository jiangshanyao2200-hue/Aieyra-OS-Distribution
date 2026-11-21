// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: contextPackageFixture; TestContextPackageActualTurnUnavailableReopenAndRecovery; writeContextFixturePackage; TestContextPackageDigestRollbackAndAgentDependency
// Impact: python -B scripts/code-atlas.py show Core/context_package_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/aieyra/aieyra-os/CORE/modules"
	"github.com/aieyra/aieyra-os/agent/context/packaged"
	"github.com/aieyra/aieyra-os/agent/context/structured"
	agent "github.com/aieyra/aieyra-os/agent/contract"
	port "github.com/aieyra/aieyra-os/contracts/context"
	tool "github.com/aieyra/aieyra-os/tool/contract"
)

func contextPackageFixture(t *testing.T, m *AgentManager) port.Reference {
	t.Helper()
	identity := installWorkflowSample(t, m, "context-project")
	id, digest, _ := tool.ParsePackageID(identity)
	return port.Reference{ID: id, Version: "1.0.0", StateSchema: 1, Digest: digest}
}

func TestContextPackageActualTurnUnavailableReopenAndRecovery(t *testing.T) {
	var calls atomic.Int32
	m, dir := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		fixtureAnswer(w, "context", "context reply", nil)
	})
	ref := contextPackageFixture(t, m)
	w := modeWorkspace(t, m.config, dir, HostOS)
	contextTestAction(t, w, "new", nil)
	contextTestTurn(t, w, "original correction retained across provider changes")
	w.mu.Lock()
	oldPath := w.contextArchivePath(w.contextSessionLocked().Archive)
	w.mu.Unlock()
	original, err := os.ReadFile(oldPath)
	if err != nil {
		t.Fatal(err)
	}
	contextTestAction(t, w, "provider", map[string]any{"provider": ref})
	contextTestTurn(t, w, "use the selected context package")
	w.mu.Lock()
	id := w.state.Roles[WorkspaceMatrix]
	w.mu.Unlock()
	r, err := w.manager.Status(w.state.ID, id)
	if err != nil || r.Context == nil || r.Context.Provider == nil || *r.Context.Provider != ref {
		t.Fatal("actual request did not consume package", r.Context, err)
	}
	packageMutation(t, m.toolPackages(), "disable", "", ref.ID, nil)
	before := calls.Load()
	w.mu.Lock()
	r, err = w.dispatchLocked(WorkspaceMatrix, workspaceID(), "must reject unavailable context")
	w.mu.Unlock()
	if err == nil {
		r, err = w.manager.Wait(context.Background(), w.state.ID, r.ID, 10000)
		if err == nil && r.State != "failed" {
			t.Fatal("unavailable context ran", r)
		}
	}
	if calls.Load() != before {
		t.Fatal("unavailable provider reached model")
	}
	w.Close()
	reopened := modeWorkspace(t, m.config, dir, HostOS)
	view := contextTestView(t, reopened)
	p := view["provider"].(map[string]any)
	if p["ready"] != false || p["error"] == nil || !strings.Contains(view["text"].(string), "original correction") {
		t.Fatal("unavailable package prevented archive recovery", p)
	}
	contextTestAction(t, reopened, "provider", map[string]any{"provider": structured.Reference})
	contextTestTurn(t, reopened, "recovered with built-in context")
	after, _ := os.ReadFile(oldPath)
	if !bytes.Equal(original, after) {
		t.Fatal("provider changes rewrote original archive")
	}
}

func writeContextFixturePackage(t *testing.T, p *modules.Package) string {
	t.Helper()
	dir := t.TempDir()
	for name, data := range p.Files {
		if name == "manifest.json" {
			continue
		}
		sum := sha256.Sum256(data)
		p.Manifest.Files[name] = modules.File{SHA256: hex.EncodeToString(sum[:]), Size: int64(len(data))}
		file := filepath.Join(dir, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(file), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(file, data, 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(dir, "manifest.json"), rawJSON(p.Manifest), 0600); err != nil {
		t.Fatal(err)
	}
	return dir
}

func TestContextPackageDigestRollbackAndAgentDependency(t *testing.T) {
	m, _ := matrixTestManager(t, func(http.ResponseWriter, *http.Request) { t.Error("admission must not call model") })
	ref := contextPackageFixture(t, m)
	source, err := modules.Load(context.Background(), filepath.Join(mustProjectRoot(t), "SDK/examples/agent-reviewer"))
	if err != nil {
		t.Fatal(err)
	}
	var d agent.Definition
	if err = json.Unmarshal(source.Files["agent.json"], &d); err != nil {
		t.Fatal(err)
	}
	authorRef := ref
	authorRef.Digest = ""
	d.ContextProvider = &authorRef
	source.Files["agent.json"] = rawJSON(d)
	source.Manifest.Dependencies = append(source.Manifest.Dependencies, modules.Dependency{ID: ref.ID, Version: "^1.0.0"})
	a := packageMutation(t, m.toolPackages(), "install", writeContextFixturePackage(t, source), "", source.Manifest.Permissions)
	packageMutation(t, m.toolPackages(), "enable", "", source.Manifest.ID, source.Manifest.Permissions)
	instance, err := m.resolveAgentPackage(context.Background(), "mod:"+source.Manifest.ID+"@"+a.Digest)
	if err != nil || instance.Definition.ContextProvider == nil || *instance.Definition.ContextProvider != ref || instance.Dependencies[ref.ID] != ref.Digest {
		t.Fatal(instance, err)
	}
	p, err := modules.Load(context.Background(), filepath.Join(mustProjectRoot(t), "SDK/examples/context-project"))
	if err != nil {
		t.Fatal(err)
	}
	policy, err := packaged.Decode(p.Files["context.json"])
	if err != nil {
		t.Fatal(err)
	}
	policy.Version = "1.1.0"
	p.Manifest.Version = policy.Version
	p.Files["context.json"] = rawJSON(policy)
	update := packageMutation(t, m.toolPackages(), "install", writeContextFixturePackage(t, p), "", nil)
	if _, err = resolveContextProvider(ref, m.config); err == nil {
		t.Fatal("old binding silently followed package upgrade")
	}
	next := ref
	next.Version = policy.Version
	next.Digest = update.Digest
	if _, err = resolveContextProvider(next, m.config); err != nil {
		t.Fatal(err)
	}
	packageMutation(t, m.toolPackages(), "rollback", "", ref.ID, nil)
	if _, err = resolveContextProvider(ref, m.config); err != nil {
		t.Fatal(err)
	}
	if _, err = resolveContextProvider(next, m.config); err == nil {
		t.Fatal("new binding silently followed rollback")
	}
	if _, err = resolveContextProvider(ref, filepath.Join(t.TempDir(), "config.json")); err == nil {
		t.Fatal("provider crossed configuration ownership")
	}
}

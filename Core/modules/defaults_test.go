// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/modules/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: defaultFixture; withDefaults; registryBytes; TestDefaultsRegisterDependencyGraphOnceAndRetainRemovedObjects; TestDefaultsMigrateLegacyRegistryWithoutReplacingUserState; TestNewDefaultDoesNotReviveDisabledOrRemovedDependency; TestNewCompiledDefaultDoesNotUpdateExistingBinding; TestDefaultsFailureAndCancellationDoNotCommitPartialRegistry; TestDefaultsDeferUnsupportedHostWithoutConsumingRegistration; TestDefaultsRejectCompleteGraphCyclesAtomically; TestDefaultsDeferUnsupportedDependenciesTransitively; TestDefaultsConcurrentFirstReadersShareOneRegistration; TestDefaultsCancelWhileAnotherWriterHoldsRegistry
// Impact: python -B scripts/code-atlas.py show Core/modules/defaults_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package modules

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"sync"
	"testing"
	"time"
)

func defaultFixture(t *testing.T, id, version string, dependencies ...Dependency) *Package {
	t.Helper()
	pkg, err := Load(context.Background(), fixture(t, id, version, func(m *Manifest) {
		m.Publisher = "aieyra"
		m.Dependencies = dependencies
	}))
	if err != nil {
		t.Fatal(err)
	}
	return pkg
}

func withDefaults(root string, packages ...*Package) *Manager {
	m := New(root, testHost())
	m.OfficialDigests = map[string][]string{}
	for _, pkg := range packages {
		m.OfficialDigests[pkg.Manifest.ID] = append(m.OfficialDigests[pkg.Manifest.ID], pkg.Digest)
	}
	m.DefaultPackages = func() ([]*Package, error) { return packages, nil }
	return m
}

func registryBytes(t *testing.T, root string) []byte {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(root, "installed.json"))
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func TestDefaultsRegisterDependencyGraphOnceAndRetainRemovedObjects(t *testing.T) {
	dep := defaultFixture(t, "aieyra.default-dep", "1.0.0")
	app := defaultFixture(t, "aieyra.default-app", "1.0.0", Dependency{ID: dep.Manifest.ID, Version: "^1.0.0"})
	m := withDefaults(t.TempDir(), app, dep) // Deliberately not topologically ordered.
	resolved := checked(t, m, Request{Action: "resolve", ID: app.Manifest.ID})
	if resolved.Revision != 1 || resolved.Item.Origin != "official" || len(resolved.Dependencies) != 1 || resolved.Dependencies[0].Digest != dep.Digest || resolved.Item.Resolved[dep.Manifest.ID] != dep.Digest {
		t.Fatal("defaults did not use the common immutable dependency graph", resolved)
	}
	before := registryBytes(t, m.Root)
	m = withDefaults(m.Root, dep, app)
	checked(t, m, Request{Action: "list"})
	if string(registryBytes(t, m.Root)) != string(before) {
		t.Fatal("reopening rewrote default registration")
	}
	disabled := mutate(t, m, "disable", *resolved.Item)
	m = withDefaults(m.Root, app, dep)
	if _, err := m.Call(context.Background(), Request{Action: "resolve", ID: app.Manifest.ID}); err == nil {
		t.Fatal("restart reenabled a disabled default")
	}
	mutate(t, m, "remove", *disabled.Item)
	retained := filepath.Join(m.Root, "user-retained.txt")
	if err := os.WriteFile(retained, []byte("private state"), 0600); err != nil {
		t.Fatal(err)
	}
	m = withDefaults(m.Root, app, dep)
	list := checked(t, m, Request{Action: "list"})
	if len(list.Items) != 1 || list.Items[0].Manifest.ID != dep.Manifest.ID {
		t.Fatal("restart resurrected a removed default", list)
	}
	if pkg, err := Load(context.Background(), resolved.Directory); err != nil || pkg.Digest != app.Digest {
		t.Fatal("removal lost the immutable source", err)
	}
	if b, err := os.ReadFile(retained); err != nil || string(b) != "private state" {
		t.Fatal("removal lost private state", err)
	}
}

func TestDefaultsMigrateLegacyRegistryWithoutReplacingUserState(t *testing.T) {
	old := defaultFixture(t, "aieyra.default-app", "1.0.0")
	next := defaultFixture(t, old.Manifest.ID, "1.1.0")
	m := withDefaults(t.TempDir(), old, next)
	m.DefaultPackages = nil
	source := fixture(t, old.Manifest.ID, old.Manifest.Version, func(m *Manifest) { m.Publisher = "aieyra" })
	inspection := checked(t, m, Request{Action: "inspect", Source: source})
	req := Request{Action: "install", Source: source, Origin: "local", ExpectedDigest: inspection.Digest, ExpectedRevision: &inspection.Revision, RequestID: "legacy-default-install"}
	installed := checked(t, m, req)
	legacy, err := m.read()
	if err != nil || legacy.Schema != 1 || legacy.Defaults != nil {
		t.Fatal("fixture is not a legacy registry", err)
	}
	m.DefaultPackages = func() ([]*Package, error) { return []*Package{next}, nil }
	list := checked(t, m, Request{Action: "list"})
	if len(list.Items) != 1 || !reflect.DeepEqual(list.Items[0], *installed.Item) {
		t.Fatal("migration replaced the user's disabled version or grants", list)
	}
	replayed := checked(t, m, req)
	if !replayed.Replayed || replayed.Revision != installed.Revision || replayed.Item.Digest != old.Digest {
		t.Fatal("migration lost the original receipt", replayed)
	}
	current, err := m.read()
	if err != nil || current.Schema != 2 || !current.Defaults[old.Manifest.ID] || len(current.Receipts) != 1 {
		t.Fatal("migration did not preserve default registration", err)
	}
	// A later ordinary writer must preserve the marker even without defaults.
	m.DefaultPackages = nil
	mutate(t, m, "remove", list.Items[0])
	install(t, m, fixture(t, "test.unrelated", "1.0.0", nil))
	m.DefaultPackages = func() ([]*Package, error) { return []*Package{next}, nil }
	list = checked(t, m, Request{Action: "list"})
	if len(list.Items) != 1 || list.Items[0].Manifest.ID != "test.unrelated" {
		t.Fatal("ordinary writer lost the removal marker", list)
	}
}

func TestNewDefaultDoesNotReviveDisabledOrRemovedDependency(t *testing.T) {
	for _, removed := range []bool{false, true} {
		t.Run(map[bool]string{false: "disabled", true: "removed"}[removed], func(t *testing.T) {
			dep := defaultFixture(t, "aieyra.default-dep", "1.0.0")
			app := defaultFixture(t, "aieyra.default-app", "1.0.0", Dependency{ID: dep.Manifest.ID, Version: "^1.0.0"})
			m := withDefaults(t.TempDir(), dep)
			resolved := checked(t, m, Request{Action: "resolve", ID: dep.Manifest.ID})
			disabled := mutate(t, m, "disable", *resolved.Item)
			if removed {
				mutate(t, m, "remove", *disabled.Item)
			}
			m = withDefaults(m.Root, app, dep)
			checked(t, m, Request{Action: "list"})
			for _, id := range []string{app.Manifest.ID, dep.Manifest.ID} {
				if _, err := m.Call(context.Background(), Request{Action: "resolve", ID: id}); err == nil {
					t.Fatal("new default revived a disabled graph", id)
				}
			}
			s, err := m.read()
			_, depExists := s.Items[dep.Manifest.ID]
			if err != nil || depExists == removed || !s.Defaults[app.Manifest.ID] {
				t.Fatal("user dependency choice was not retained", err)
			}
		})
	}
}

func TestNewCompiledDefaultDoesNotUpdateExistingBinding(t *testing.T) {
	old := defaultFixture(t, "aieyra.default-app", "1.0.0")
	next := defaultFixture(t, old.Manifest.ID, "1.1.0")
	m := withDefaults(t.TempDir(), old)
	checked(t, m, Request{Action: "resolve", ID: old.Manifest.ID})
	before := registryBytes(t, m.Root)
	m = withDefaults(m.Root, next)
	m.OfficialDigests[old.Manifest.ID] = append(m.OfficialDigests[old.Manifest.ID], old.Digest)
	resolved := checked(t, m, Request{Action: "resolve", ID: old.Manifest.ID})
	if resolved.Item.Digest != old.Digest || string(registryBytes(t, m.Root)) != string(before) {
		t.Fatal("compiled update silently changed an existing binding")
	}
}

func TestDefaultsFailureAndCancellationDoNotCommitPartialRegistry(t *testing.T) {
	for _, failure := range []string{"bytes", "cancel", "validator"} {
		t.Run(failure, func(t *testing.T) {
			one := defaultFixture(t, "aieyra.default-one", "1.0.0")
			two := defaultFixture(t, "aieyra.default-two", "1.0.0")
			m := withDefaults(t.TempDir(), one, two)
			m.DefaultPackages = nil
			install(t, m, fixture(t, "test.retained", "1.0.0", nil))
			before := registryBytes(t, m.Root)
			m.DefaultPackages = func() ([]*Package, error) { return []*Package{one, two}, nil }
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			if failure == "bytes" {
				two.Files["index.html"] = []byte("corrupt")
			}
			m.ValidatePackage = func(p *Package) error {
				if p.Manifest.ID == two.Manifest.ID {
					if failure == "cancel" {
						cancel()
					}
					if failure == "validator" {
						return errors.New("invalid runtime contract")
					}
				}
				return nil
			}
			if _, err := m.Call(ctx, Request{Action: "list"}); err == nil {
				t.Fatal("invalid default graph committed")
			}
			if string(registryBytes(t, m.Root)) != string(before) {
				t.Fatal("failed default registration changed the registry")
			}
			var s registry
			if err := json.Unmarshal(before, &s); err != nil || len(s.Items) != 1 {
				t.Fatal("fixture lost retained state", err)
			}
		})
	}
}

func TestDefaultsDeferUnsupportedHostWithoutConsumingRegistration(t *testing.T) {
	for _, limitation := range []string{"client", "runtime", "contract", "capability"} {
		t.Run(limitation, func(t *testing.T) {
			pkg := defaultFixture(t, "aieyra.default-app", "1.0.0")
			if limitation == "capability" {
				source := fixture(t, pkg.Manifest.ID, "1.0.0", func(m *Manifest) {
					m.Publisher = "aieyra"
					m.Permissions = []Permission{{Capability: "network.https", Scope: "https://example.com", Reason: "fixture"}}
				})
				var err error
				pkg, err = Load(context.Background(), source)
				if err != nil {
					t.Fatal(err)
				}
			}
			m := withDefaults(t.TempDir(), pkg)
			switch limitation {
			case "client":
				m.Host.Client = "cli"
			case "runtime":
				m.Host.Kinds = nil
			case "contract":
				m.Host.Contracts = nil
			}
			list := checked(t, m, Request{Action: "list"})
			if list.Revision != 0 || len(list.Items) != 0 {
				t.Fatal("unsupported host provisioned a default", list)
			}
			m = withDefaults(m.Root, pkg)
			m.Host.Capabilities = []string{"network.https"}
			checked(t, m, Request{Action: "resolve", ID: pkg.Manifest.ID})
		})
	}
}

func TestDefaultsRejectCompleteGraphCyclesAtomically(t *testing.T) {
	for _, optional := range []bool{false, true} {
		a := defaultFixture(t, "aieyra.default-a", "1.0.0", Dependency{ID: "aieyra.default-b", Version: "^1.0.0", Optional: optional})
		b := defaultFixture(t, "aieyra.default-b", "1.0.0", Dependency{ID: a.Manifest.ID, Version: "^1.0.0"})
		m := withDefaults(t.TempDir(), a, b)
		if _, err := m.Call(context.Background(), Request{Action: "list"}); err == nil {
			t.Fatal("default cycle committed", optional)
		}
		if _, err := os.Stat(filepath.Join(m.Root, "installed.json")); !os.IsNotExist(err) {
			t.Fatal("invalid graph left a registry", err)
		}
	}
}

func TestDefaultsDeferUnsupportedDependenciesTransitively(t *testing.T) {
	source := fixture(t, "aieyra.default-c", "1.0.0", func(m *Manifest) {
		m.Publisher = "aieyra"
		m.Permissions = []Permission{{Capability: "network.https", Scope: "https://example.com", Reason: "fixture"}}
	})
	c, err := Load(context.Background(), source)
	if err != nil {
		t.Fatal(err)
	}
	b := defaultFixture(t, "aieyra.default-b", "1.0.0", Dependency{ID: c.Manifest.ID, Version: "^1.0.0"})
	a := defaultFixture(t, "aieyra.default-a", "1.0.0", Dependency{ID: b.Manifest.ID, Version: "^1.0.0"})
	m := withDefaults(t.TempDir(), a, b, c)
	// First inspect an ordinary legacy registry where C exists but has no
	// default marker. A separate writer then removes it before provisioning.
	m.DefaultPackages = nil
	m.Host.Capabilities = []string{"network.https"}
	installed := install(t, m, source)
	checked(t, m, Request{Action: "list"})
	writer := withDefaults(m.Root, c)
	writer.DefaultPackages = nil
	mutate(t, writer, "remove", *installed.Item)
	m.Host.Capabilities = nil
	m.DefaultPackages = func() ([]*Package, error) { return []*Package{a, b, c}, nil }
	before := registryBytes(t, m.Root)
	list := checked(t, m, Request{Action: "list"})
	if len(list.Items) != 0 || string(registryBytes(t, m.Root)) != string(before) {
		t.Fatal("unsupported dependency consumed a transitive default marker", list)
	}
	m = withDefaults(m.Root, a, b, c)
	m.Host.Capabilities = []string{"network.https"}
	resolved := checked(t, m, Request{Action: "resolve", ID: a.Manifest.ID})
	if len(resolved.Dependencies) != 2 {
		t.Fatal("capable host failed to provision the deferred graph", resolved)
	}
}

func TestDefaultsConcurrentFirstReadersShareOneRegistration(t *testing.T) {
	pkg := defaultFixture(t, "aieyra.default-app", "1.0.0")
	root := t.TempDir()
	start := make(chan struct{})
	var readers sync.WaitGroup
	results := make(chan error, 8)
	for range 8 {
		readers.Add(1)
		go func() {
			defer readers.Done()
			<-start
			_, err := withDefaults(root, pkg).Call(context.Background(), Request{Action: "resolve", ID: pkg.Manifest.ID})
			results <- err
		}()
	}
	close(start)
	readers.Wait()
	close(results)
	for err := range results {
		if err != nil {
			t.Error("concurrent first reader failed", err)
		}
	}
	list := checked(t, withDefaults(root, pkg), Request{Action: "list"})
	if list.Revision != 1 || len(list.Items) != 1 {
		t.Fatal("concurrent readers duplicated provisioning", list)
	}
}

func TestDefaultsCancelWhileAnotherWriterHoldsRegistry(t *testing.T) {
	pkg := defaultFixture(t, "aieyra.default-app", "1.0.0")
	m := withDefaults(t.TempDir(), pkg)
	lock, err := m.lockRegistry()
	if err != nil {
		t.Fatal(err)
	}
	defer lock.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()
	if _, err := m.Call(ctx, Request{Action: "list"}); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatal("default initialization did not respect the waiting caller's deadline", err)
	}
	if _, err := os.Stat(filepath.Join(m.Root, "installed.json")); !os.IsNotExist(err) {
		t.Fatal("cancelled initialization committed state", err)
	}
}

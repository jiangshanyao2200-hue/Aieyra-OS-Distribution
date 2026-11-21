// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestAgentPackageOfficialDisableBlocksCreationAndExistingInstance; TestAgentPackageOfficialDisableRejectsNewSteeringButKeepsAdmittedTurn
// Impact: python -B scripts/code-atlas.py show Core/agent_package_official_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"net/http"
	"os"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/aieyra/aieyra-os/CORE/modules"
)

func TestAgentPackageOfficialDisableBlocksCreationAndExistingInstance(t *testing.T) {
	var calls atomic.Int32
	_, _, m, dir, _ := packageAgentFixture(t, func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		fixtureAnswer(w, "official-enabled", "continued after explicit enable", nil)
	})
	ctx := context.Background()
	registered, err := m.toolPackages().Call(ctx, modules.Request{Action: "resolve", ID: "aieyra.eyra"})
	if err != nil || registered.Item == nil || registered.Item.Origin != "official" || len(registered.Dependencies) != 2 {
		t.Fatal("official Agent did not resolve through the common registry", registered, err)
	}
	identity := "mod:aieyra.eyra@" + registered.Item.Digest
	r := newPackageAgent(t, m, identity, "official-retain-instance", dir)
	privatePrompt := "PRIVATE_OVERRIDE_RETAINED"
	r = changePackageAgent(t, m, r, agentPackageCommand{Action: "configure", Prompt: &privatePrompt})
	config, err := os.ReadFile(m.config)
	if err != nil {
		t.Fatal(err)
	}
	before := copyRecord(r)
	disabled, err := m.toolPackages().Call(ctx, modules.Request{Action: "disable", ID: registered.Item.Manifest.ID, ExpectedRevision: &registered.Revision, ExpectedDigest: registered.Item.Digest, RequestID: "official-disable-source"})
	if err != nil || !disabled.OK || disabled.Item.Enabled {
		t.Fatal("failed to disable official package", disabled, err)
	}
	sources, err := m.agentPackageSources(ctx)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, row := range sources.(map[string]any)["sources"].([]map[string]any) {
		if row["identity"] == identity {
			found = true
			if row["enabled"] != false || row["origin"] != "official" {
				t.Fatal("source list bypassed registry state", row)
			}
		}
	}
	if !found {
		t.Fatal("disabled source disappeared instead of retaining its state")
	}
	if _, err := m.createPackageAgent(ctx, identity, "official-disabled-create", "local-model", dir, ""); err == nil || !strings.Contains(err.Error(), "not enabled") {
		t.Fatal("disabled official package admitted a new instance", err)
	}
	if _, err := m.SendGeneration(m.owner, r.ID, "official-disabled-send", "must not call model", 0); err == nil || !strings.Contains(err.Error(), "not enabled") {
		t.Fatal("disabled official package admitted an existing instance", err)
	}
	after, err := m.Status(m.owner, r.ID)
	if err != nil || !reflect.DeepEqual(before, after) || calls.Load() != 0 {
		t.Fatal("rejected admission changed the instance or called a model", err, calls.Load())
	}
	if data, err := os.ReadFile(m.config); err != nil || string(data) != string(config) {
		t.Fatal("disabled admission changed private configuration", err)
	}
	enabled, err := m.toolPackages().Call(ctx, modules.Request{Action: "enable", ID: disabled.Item.Manifest.ID, ExpectedRevision: &disabled.Revision, ExpectedDigest: disabled.Item.Digest, Grants: disabled.Item.Manifest.Permissions, RequestID: "official-explicit-enable"})
	if err != nil || !enabled.OK || !enabled.Item.Enabled {
		t.Fatal("explicit enable failed", enabled, err)
	}
	if _, err = m.SendGeneration(m.owner, r.ID, "official-enabled-send", "continue", 0); err != nil {
		t.Fatal(err)
	}
	after, err = m.Wait(ctx, m.owner, r.ID, 10000)
	if err != nil || after.State != "completed" || calls.Load() != 1 || after.Spec.Prompt != privatePrompt || after.ID != r.ID {
		t.Fatal("explicit enable did not resume the retained instance", after.State, err, calls.Load())
	}
}

func TestAgentPackageOfficialDisableRejectsNewSteeringButKeepsAdmittedTurn(t *testing.T) {
	entered, release := make(chan struct{}), make(chan struct{})
	var calls atomic.Int32
	_, _, m, dir, _ := packageAgentFixture(t, func(w http.ResponseWriter, r *http.Request) {
		if calls.Add(1) == 1 {
			close(entered)
		}
		<-release
		fixtureAnswer(w, "already-admitted", "completed admitted turn", nil)
	})
	defer func() {
		select {
		case <-release:
		default:
			close(release)
		}
	}()
	ctx := context.Background()
	source, err := m.toolPackages().Call(ctx, modules.Request{Action: "resolve", ID: "aieyra.eyra"})
	if err != nil {
		t.Fatal(err)
	}
	r := newPackageAgent(t, m, "mod:aieyra.eyra@"+source.Item.Digest, "official-steering-create", dir)
	r, err = m.SendGeneration(m.owner, r.ID, "official-start-turn", "start", 0)
	if err != nil {
		t.Fatal(err)
	}
	select {
	case <-entered:
	case <-time.After(5 * time.Second):
		t.Fatal("model did not enter admitted turn")
	}
	changeOfficialPackage(t, m, "disable", "aieyra.eyra", "official-disable-during-turn")
	if _, err := m.SendGeneration(m.owner, r.ID, "official-blocked-steering", "new input", r.Generation); err == nil || !strings.Contains(err.Error(), "not enabled") {
		t.Fatal("disabled package accepted steering", err)
	}
	after, err := m.Status(m.owner, r.ID)
	if err != nil || len(after.PendingMessages) != 0 || after.Turns["official-blocked-steering"] != "" {
		t.Fatal("rejected steering was persisted", err)
	}
	close(release)
	after, err = m.Wait(ctx, m.owner, r.ID, 10000)
	if err != nil || after.State != "completed" || calls.Load() != 1 {
		t.Fatal("disable lost the already admitted result", after.State, err, calls.Load())
	}
}

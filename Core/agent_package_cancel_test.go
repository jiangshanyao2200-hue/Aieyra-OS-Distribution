// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestAgentPackageCancellationReachesOwnedMemberAndRejectsUnrelated
// Impact: python -B scripts/code-atlas.py show Core/agent_package_cancel_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"io"
	"net/http"
	"testing"
	"time"
)

func TestAgentPackageCancellationReachesOwnedMemberAndRejectsUnrelated(t *testing.T) {
	entered := make(chan struct{})
	_, _, m, dir, identity := packageAgentFixture(t, func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		close(entered)
		<-r.Context().Done()
	})
	a := newPackageAgent(t, m, identity, "parent", dir)
	b := newPackageAgent(t, m, identity, "child", dir)
	other := newPackageAgent(t, m, identity, "other", dir)
	b = changePackageAgent(t, m, b, agentPackageCommand{Action: "team", Supervisor: a.ID, TeamRole: "runner"})
	if _, err := m.SendGeneration(a.ID, b.ID, "active", "run until cancelled", 0); err != nil {
		t.Fatal(err)
	}
	select {
	case <-entered:
	case <-time.After(5 * time.Second):
		t.Fatal("request did not start")
	}
	if err := m.CancelGeneration(other.ID, b.ID, 1); err == nil {
		t.Fatal("unrelated instance cancelled a team member")
	}
	if err := m.CancelGeneration(a.ID, b.ID, 0); err == nil {
		t.Fatal("stale zero generation cancelled an active member")
	}
	if err := m.CancelGeneration(a.ID, b.ID, 1); err != nil {
		t.Fatal(err)
	}
	r, err := m.Wait(context.Background(), a.ID, b.ID, 10000)
	if err != nil || r.State != "cancelled" {
		t.Fatal(r, err)
	}
	if r.Spec.AgentPackage != identity || r.Instance == nil {
		t.Fatal("cancellation discarded the instance")
	}
}

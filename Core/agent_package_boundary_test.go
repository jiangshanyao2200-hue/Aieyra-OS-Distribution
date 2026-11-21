// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestAgentPackageFinalBoundaryRacesMessageAdmission; TestAgentPackageRecoveryDrainPreservesNewTurnMessages; TestAgentPackageCreationReceiptSurvivesPackageChanges; TestAgentPackageRecoveredMessagesPrecedeNewUserTurn
// Impact: python -B scripts/code-atlas.py show Core/agent_package_boundary_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestAgentPackageFinalBoundaryRacesMessageAdmission(t *testing.T) {
	_, _, m, dir, identity := packageAgentFixture(t, func(w http.ResponseWriter, r *http.Request) {
		fixtureAnswer(w, "next-turn", "accepted explicit next turn", nil)
	})
	a := newPackageAgent(t, m, identity, "create-final-boundary", dir)
	archive := &SessionArchive{Path: filepath.Join(t.TempDir(), "messages.jsonl")}
	defer archive.Close()
	var history []Message
	for n := 0; n < 32; n++ {
		m.mu.Lock()
		j := m.jobs[a.ID]
		j.record.State, j.record.Generation, j.finishing = "running", 1, false
		m.mu.Unlock()
		start, sealed, sent := make(chan struct{}), make(chan bool, 1), make(chan error, 1)
		request := fmt.Sprintf("racing-message-%d", n)
		go func() { <-start; sealed <- m.sealPackageTurn(a.ID) }()
		go func() { <-start; _, err := m.SendGeneration(m.owner, a.ID, request, request, 1); sent <- err }()
		close(start)
		closed, err := <-sealed, <-sent
		r, statusErr := m.Status(m.owner, a.ID)
		if statusErr != nil {
			t.Fatal(statusErr)
		}
		if err == nil {
			if closed || len(r.PendingMessages) != 1 {
				t.Fatal("accepted message crossed final boundary")
			}
			added, err := m.drainPackageMessages(a.ID, archive, history)
			if err != nil || len(added) != 1 {
				t.Fatal("accepted message was not delivered", err)
			}
			history = append(history, added...)
		} else if !errors.Is(err, errAgentFinishing) || !closed || len(r.PendingMessages) != 0 {
			t.Fatal("late message was not explicitly rejected", closed, err)
		}
	}
	if !m.sealPackageTurn(a.ID) {
		t.Fatal("empty turn did not close")
	}
	if _, err := m.SendGeneration(m.owner, a.ID, "retry-next-turn", "late explicit instruction", 1); !errors.Is(err, errAgentFinishing) {
		t.Fatal("closed turn accepted another message", err)
	}
	r, _ := m.Status(m.owner, a.ID)
	if _, exists := r.Turns["retry-next-turn"]; exists {
		t.Fatal("rejected request was consumed")
	}
	m.finish(m.jobs[a.ID], "completed", "previous result", nil)
	if _, err := m.SendGeneration(m.owner, a.ID, "retry-next-turn", "late explicit instruction", 1); err != nil {
		t.Fatal(err)
	}
	r, err := m.Wait(context.Background(), m.owner, a.ID, 10000)
	if err != nil || r.State != "completed" || r.Generation != 2 || len(r.PendingMessages) != 0 {
		t.Fatal(r.State, err)
	}
}

func TestAgentPackageRecoveryDrainPreservesNewTurnMessages(t *testing.T) {
	_, _, m, dir, identity := packageAgentFixture(t, func(http.ResponseWriter, *http.Request) { t.Error("unexpected model") })
	a := newPackageAgent(t, m, identity, "create-drain-boundary", dir)
	m.mu.Lock()
	m.jobs[a.ID].record.PendingMessages = []workspaceMessage{
		{ID: "old", Text: "previous turn", Generation: 1},
		{ID: "new", Text: "current turn", Generation: 2},
	}
	m.mu.Unlock()
	archive := &SessionArchive{Path: filepath.Join(t.TempDir(), "ordered.jsonl")}
	defer archive.Close()
	added, err := m.drainPackageMessagesBefore(a.ID, archive, nil, 2)
	if err != nil || len(added) != 1 || added[0].Content != "previous turn" {
		t.Fatal(added, err)
	}
	r, _ := m.Status(m.owner, a.ID)
	if len(r.PendingMessages) != 1 || r.PendingMessages[0].ID != "new" {
		t.Fatal("new instruction moved ahead of explicit turn")
	}
	remaining, err := m.drainPackageMessages(a.ID, archive, added)
	if err != nil || len(remaining) != 1 || remaining[0].Content != "current turn" {
		t.Fatal(remaining, err)
	}
}

func TestAgentPackageCreationReceiptSurvivesPackageChanges(t *testing.T) {
	root, w, m, dir, identity := packageAgentFixture(t, func(http.ResponseWriter, *http.Request) { t.Error("creation called model") })
	a := newPackageAgent(t, m, identity, "create-once", dir)
	prompt := "my independent override"
	a = changePackageAgent(t, m, a, agentPackageCommand{Action: "configure", Prompt: &prompt})
	newVersion := agentPackageVersion(t, "1.1.0", "new package definition")
	packageMutation(t, m.toolPackages(), "install", newVersion, "", nil)
	assertReceipt := func(service *AgentManager) {
		t.Helper()
		r, err := service.createPackageAgent(context.Background(), identity, "create-once", "local-model", dir, "")
		if err != nil || r.ID != a.ID || r.Spec.Prompt != prompt || len(service.List(service.owner)) != 1 {
			t.Errorf("original creation lost its durable receipt: id=%s error=%v", r.ID, err)
		}
		if _, err := service.createPackageAgent(context.Background(), identity, "create-once", "local-model", dir, "changed input"); err == nil {
			t.Error("conflicting creation reused a receipt")
		}
		if _, err := service.createPackageAgent(context.Background(), identity, "new-creation", "local-model", dir, ""); err == nil {
			t.Error("new creation bypassed package admission")
		}
	}
	assertReceipt(m)
	root.Close()
	reopened, err := NewAgentManager(root.config, testMatrixOwner, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	w.manager, reopened.workspace = reopened, w
	service, err := reopened.ensurePackageAgentHost(false)
	if err != nil {
		t.Fatal(err)
	}
	assertReceipt(service)
}

func TestAgentPackageRecoveredMessagesPrecedeNewUserTurn(t *testing.T) {
	entered := make(chan struct{})
	var calls atomic.Int32
	root, w, m, dir, identity := packageAgentFixture(t, func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
			return
		}
		if calls.Add(1) == 1 {
			close(entered)
			<-r.Context().Done()
			return
		}
		text := string(rawJSON(body))
		old, latest := strings.Index(text, "OLD_PENDING_INSTRUCTION"), strings.Index(text, "LATEST_EXPLICIT_INSTRUCTION")
		if old < 0 || latest <= old || strings.Count(text, "OLD_PENDING_INSTRUCTION") != 1 {
			t.Errorf("recovered message was lost, duplicated or placed after new instruction: old=%d latest=%d", old, latest)
		}
		fixtureAnswer(w, "recovered", "latest instruction applied", nil)
	})
	a := newPackageAgent(t, m, identity, "create-order", dir)
	if _, err := m.SendGeneration(m.owner, a.ID, "first", "start", 0); err != nil {
		t.Fatal(err)
	}
	select {
	case <-entered:
	case <-time.After(5 * time.Second):
		t.Fatal("model did not start")
	}
	if _, err := m.SendGeneration(m.owner, a.ID, "pending", "OLD_PENDING_INSTRUCTION", 1); err != nil {
		t.Fatal(err)
	}
	if err := m.CancelGeneration(m.owner, a.ID, 1); err != nil {
		t.Fatal(err)
	}
	a, err := m.Wait(context.Background(), m.owner, a.ID, 10000)
	if err != nil || a.State != "cancelled" || len(a.PendingMessages) != 1 {
		t.Fatal(a.State, err)
	}
	root.Close()
	reopened, err := NewAgentManager(root.config, testMatrixOwner, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	w.manager, reopened.workspace = reopened, w
	service, err := reopened.ensurePackageAgentHost(false)
	if err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 1 {
		t.Fatal("restart replayed model")
	}
	if _, err = service.SendGeneration(service.owner, a.ID, "explicit-next", "LATEST_EXPLICIT_INSTRUCTION", 1); err != nil {
		t.Fatal(err)
	}
	a, err = service.Wait(context.Background(), service.owner, a.ID, 10000)
	if err != nil || a.State != "completed" || len(a.PendingMessages) != 0 || calls.Load() != 2 {
		t.Fatal(a.State, err, calls.Load())
	}
}

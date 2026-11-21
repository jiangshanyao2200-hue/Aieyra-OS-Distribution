// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestWorkspaceExistingRoleFollowsDefaultAtRequestBoundary
// Impact: python -B scripts/code-atlas.py show Core/workspace_model_inheritance_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"
)

func TestWorkspaceExistingRoleFollowsDefaultAtRequestBoundary(t *testing.T) {
	models := make(chan string, 8)
	w, _ := testWorkspace(t, func(res http.ResponseWriter, req *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		models <- body["model"].(string)
		fixtureAnswer(res, "model-check", "verified", nil)
	})
	turn := func(id string, generation int) AgentRecord {
		t.Helper()
		if _, err := w.Send(id, "Verify this new request only."); err != nil {
			t.Fatal(err)
		}
		deadline := time.Now().Add(10 * time.Second)
		for time.Now().Before(deadline) {
			w.mu.Lock()
			role := w.state.Roles[WorkspaceMatrix]
			w.mu.Unlock()
			if role != "" {
				r, err := w.manager.Status(w.state.ID, role)
				if err != nil {
					t.Fatal(err)
				}
				if r.Generation >= generation && r.State == "failed" {
					t.Fatal(r.Error)
				}
				if r.Generation >= generation && r.State == "completed" {
					return r
				}
			}
			time.Sleep(20 * time.Millisecond)
		}
		t.Fatal("request did not settle")
		return AgentRecord{}
	}
	first := turn("first", 1)
	if model := <-models; model != "fixture" {
		t.Fatal(model)
	}
	s, err := Load(w.config)
	if err != nil {
		t.Fatal(err)
	}
	next := s.APIProfiles[0]
	next.ID = "next-model"
	next.Model = "muse-fixture"
	s.APIProfiles = append(s.APIProfiles, next)
	s.MatrixProfile = next.ID
	s.ActiveProfile = next.ID
	if err = s.Save(); err != nil {
		t.Fatal(err)
	}
	second := turn("second", 2)
	if first.ID != second.ID || second.Spec.ModelID != next.ID {
		t.Fatal("existing role retained stale model", second.Spec.ModelID)
	}
	if model := <-models; model != "muse-fixture" {
		t.Fatal("wrong actual request model", model)
	}
	w.mu.Lock()
	w.state.Models[WorkspaceMatrix] = "local-model"
	w.mu.Unlock()
	third := turn("third", 3)
	if third.Spec.ModelID != "local-model" {
		t.Fatal("explicit role choice was ignored")
	}
	if model := <-models; model != "fixture" {
		t.Fatal(model)
	}
}

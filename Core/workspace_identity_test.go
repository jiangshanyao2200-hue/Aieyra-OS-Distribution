// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestWorkspaceModelIdentityFollowsRequestThenSelection
// Impact: python -B scripts/code-atlas.py show Core/workspace_identity_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"net/http"
	"testing"
	"time"
)

func TestWorkspaceModelIdentityFollowsRequestThenSelection(t *testing.T) {
	started, release := make(chan struct{}), make(chan struct{})
	w, _ := testWorkspace(t, func(rw http.ResponseWriter, r *http.Request) {
		close(started)
		select {
		case <-release:
		case <-r.Context().Done():
			return
		}
		fixtureAnswer(rw, "identity", "done", nil)
	})
	snapshot := func() map[string]any {
		t.Helper()
		s, err := w.Snapshot(0)
		if err != nil {
			t.Fatal(err)
		}
		return s.(map[string]any)
	}
	if snapshot()["model_name"] != "fixture" {
		t.Fatal("must display wire model, not profile alias")
	}
	if _, err := w.Send("identity", "check identity"); err != nil {
		t.Fatal(err)
	}
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("request did not start")
	}
	s, err := Load(w.config)
	if err != nil {
		t.Fatal(err)
	}
	s.APIProfiles[0].Model = "replacement-model-with-a-long-name"
	s.applyPoolProfile()
	if err = s.Save(); err != nil {
		t.Fatal(err)
	}
	if snapshot()["model_name"] != "fixture" {
		t.Fatal("in-flight request identity changed before completion")
	}
	close(release)
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if snapshot()["model_name"] == "replacement-model-with-a-long-name" {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("idle identity did not adopt selected model")
}

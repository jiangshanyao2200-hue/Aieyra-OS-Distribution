// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestProgramVideoUsesActualIdleSessionWithoutChatModelAndKeepsOwnership
// Impact: python -B scripts/code-atlas.py show Core/program_videos_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"fmt"
	"net/http"
	"slices"
	"testing"
)

func TestProgramVideoUsesActualIdleSessionWithoutChatModelAndKeepsOwnership(t *testing.T) {
	config, _ := videoTestFixture(t, func(*http.Request) (*http.Response, error) {
		t.Error("preparing and reading a video task must not invoke a provider")
		return nil, fmt.Errorf("unexpected network")
	})
	open := func() *WorkspaceHost {
		h := NewWorkspaceHost(config, "", "")
		if err := h.SetMode(HostOS); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(h.Close)
		return h
	}
	h := open()
	created, err := h.programVideos(context.Background(), rawJSON(map[string]any{"action": "create", "request_id": "canvas-video", "profile_id": "image-model", "prompt": "quiet river", "duration": 2}))
	if err != nil || created.(videoResult).State != "prepared" {
		t.Fatal(created, err)
	}
	m, r, err := h.programVideoSession(context.Background())
	if err != nil || r.State != "idle" || r.Generation != 0 || r.Requests != 0 || r.Spec.ProfileID != programContactID("workspace") {
		t.Fatal("native media created a task outside the actual idle program session", r, err)
	}
	agent := WithToolPermissions(WithAgentManager(context.Background(), m, r.ID, nil), []string{"video_gen"})
	agent = context.WithValue(agent, conversationLinkCallerKey{}, conversationLinkCaller{ID: r.ID, Generation: r.Generation})
	status, err := runVideoGen(agent, config, rawJSON(map[string]any{"action": "status", "request_id": "canvas-video"}))
	if err != nil || status.State != "prepared" {
		t.Fatal("Agent could not read the canvas's original task", status, err)
	}
	forged := context.WithValue(agent, conversationLinkCallerKey{}, conversationLinkCaller{ID: r.ID, Generation: r.Generation + 1})
	if _, err = runVideoGen(forged, config, rawJSON(map[string]any{"action": "status", "request_id": "canvas-video"})); err == nil {
		t.Fatal("stale runtime generation acquired a video task")
	}
	h.Close()
	h = open()
	reopened, err := h.programVideos(context.Background(), rawJSON(map[string]any{"action": "status", "request_id": "canvas-video"}))
	if err != nil || reopened.(videoResult).State != "prepared" {
		t.Fatal("reopen lost the original video task", reopened, err)
	}
	m, restored, err := h.programVideoSession(context.Background())
	if err != nil || restored.ID != r.ID || restored.Requests != 0 {
		t.Fatal("reopen replaced or executed the session", restored, err)
	}
	c, err := m.readContact(programContactID("workspace"))
	if err != nil {
		t.Fatal(err)
	}
	c.Defaults.Tools = slices.DeleteFunc(c.Defaults.Tools, func(name string) bool { return name == "video_gen" })
	if err = m.writeContact(c); err != nil {
		t.Fatal(err)
	}
	if _, err = h.programVideos(context.Background(), rawJSON(map[string]any{"action": "create", "request_id": "disabled", "profile_id": "image-model", "prompt": "test", "duration": 2})); err == nil {
		t.Fatal("canvas bypassed a user's video permission removal")
	}
}

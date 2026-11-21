// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestWorkspaceAppsCapabilitiesAndBridge; TestCommunityToolDeclaresEveryTaughtCenterAction
// Impact: python -B scripts/code-atlas.py show Core/workspace_apps_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"regexp"
	"slices"
	"testing"
)

func TestWorkspaceAppsCapabilitiesAndBridge(t *testing.T) {
	w, _ := testWorkspace(t, func(http.ResponseWriter, *http.Request) { t.Error("apps must not invoke a model") })
	if !isWorkspaceTool("apps") || !slices.Contains(w.permissions(WorkspaceMatrix), "apps") {
		t.Fatal("desktop app capability missing")
	}
	for _, role := range []string{WorkspaceProject, WorkspaceExecution} {
		if slices.Contains(w.permissions(role), "apps") {
			t.Fatal("app install exposed to child role")
		}
	}
	expected := map[string]string{"action": "status"}
	bridge := httptest.NewServer(http.HandlerFunc(func(res http.ResponseWriter, req *http.Request) {
		var body struct {
			Action    string            `json:"action"`
			Arguments map[string]string `json:"arguments"`
		}
		if json.NewDecoder(req.Body).Decode(&body) != nil || body.Action != "_apps" || len(body.Arguments) != len(expected) {
			t.Error("app request changed across bridge")
		}
		for key, value := range expected {
			if body.Arguments[key] != value {
				t.Errorf("app bridge changed %s", key)
			}
		}
		res.Header().Set("Content-Type", "application/json")
		_, _ = res.Write([]byte(`{"ok":true,"installed":true,"reused":true}`))
	}))
	defer bridge.Close()
	s := &SettingsService{communityURL: bridge.URL}
	raw, err := s.CallTool(context.Background(), "apps", "fixture", json.RawMessage(`{"action":"status"}`))
	if err != nil {
		t.Fatal(err)
	}
	var answer map[string]any
	if json.Unmarshal(raw, &answer) != nil || answer["reused"] != true {
		t.Fatal("actual bridge receipt missing")
	}
	expected = map[string]string{"action": "acquire", "app_id": "aieyra.link", "target_platform": "linux", "target_arch": "x64"}
	payload, _ := json.Marshal(expected)
	if _, err = s.CallTool(context.Background(), "apps", "fixture", payload); err != nil {
		t.Fatal(err)
	}
	w.host = &WorkspaceHost{terminal: true}
	if slices.Contains(w.permissions(WorkspaceMatrix), "apps") {
		t.Fatal("terminal claims unavailable native login capability")
	}
}

func TestCommunityToolDeclaresEveryTaughtCenterAction(t *testing.T) {
	var parameters map[string]any
	for _, d := range WorkspaceToolDefinitions() {
		if d.Name == "community" {
			parameters = d.Parameters.(map[string]any)
		}
	}
	properties := parameters["properties"].(map[string]any)
	declared := map[string]bool{}
	for _, name := range properties["action"].(map[string]any)["enum"].([]string) {
		declared[name] = true
	}
	taught := regexp.MustCompile(`center_[a-z_]+`).FindAllString(communityToolDescription(), -1)
	if len(taught) == 0 {
		t.Fatal("community manual no longer teaches the center")
	}
	for _, name := range taught {
		if !declared[name] {
			t.Errorf("manual teaches %s but the tool does not declare it", name)
		}
	}
	for _, name := range []string{"kind", "q", "origin", "expected_sha256", "expected_version", "expected_digest", "file", "manifest"} {
		if properties[name] == nil {
			t.Errorf("center parameter %s is not declared", name)
		}
	}
}

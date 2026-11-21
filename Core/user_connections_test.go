// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestSettingsPreserveHumanConnectionsAndLogin
// Impact: python -B scripts/code-atlas.py show Core/user_connections_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestSettingsPreserveHumanConnectionsAndLogin(t *testing.T) {
	file := filepath.Join(t.TempDir(), "config.json")
	extra := map[string]any{
		"user_connections":       map[string]any{"custom": "user-custom"},
		"user_connection_drafts": map[string]any{"custom": map[string]any{"base_url": "https://fixture.invalid", "api_key": "synthetic-key"}},
		"official_account":       map[string]any{"user": map[string]any{"id": "19"}, "session_cookies": []any{map[string]any{"name": "session", "value": "synthetic-cookie"}}},
	}
	data, err := json.Marshal(extra)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(file, data, 0600); err != nil {
		t.Fatal(err)
	}
	s, err := Load(file)
	if err != nil {
		t.Fatal(err)
	}
	s.ShowReasoning = false
	if err = s.Save(); err != nil {
		t.Fatal(err)
	}
	data, err = os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	var got map[string]any
	if err = json.Unmarshal(data, &got); err != nil {
		t.Fatal(err)
	}
	for k, want := range extra {
		if !reflect.DeepEqual(got[k], want) {
			t.Fatalf("global field not preserved: %s", k)
		}
	}
}

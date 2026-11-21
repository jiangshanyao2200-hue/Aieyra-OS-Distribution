// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestShellDoesNotInheritRuntimeCredential; TestRuntimeCredentialBoundProfileOriginAndNeverSaved
// Impact: python -B scripts/code-atlas.py show Core/runtime_credential_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestShellDoesNotInheritRuntimeCredential(t *testing.T) {
	t.Setenv("AIEYRA_RUNTIME_API_KEY", "temporary-runtime-secret")
	t.Setenv("AIEYRA_RUNTIME_PROFILE", "isolated-profile")
	t.Setenv("AIEYRA_RUNTIME_PROVIDER_IDENTITY", "isolated-identity")
	t.Setenv("AIEYRA_SHELL_VISIBLE", "expected")
	found := false
	for _, pair := range shellEnvironment(nil) {
		if strings.HasPrefix(strings.ToUpper(pair), "AIEYRA_RUNTIME_") {
			t.Fatal("transport credential inherited by tool process")
		}
		found = found || pair == "AIEYRA_SHELL_VISIBLE=expected"
	}
	if !found {
		t.Fatal("unrelated shell environment removed")
	}
}

func TestRuntimeCredentialBoundProfileOriginAndNeverSaved(t *testing.T) {
	s := goImageSettings("mimo-v2.6-flash")
	s.ModelPoolVersion = 1
	s.ActiveProfile = "verified-go"
	s.APIProfiles = []APIProfile{{ID: s.ActiveProfile, ConnectionID: "go", Model: s.Model, BaseURL: s.BaseURL, Protocol: s.Protocol(), Adapter: s.Adapter, ToolCalls: true, ContextWindow: 128000}}
	s.ProviderConnections = []ProviderConnection{{ID: "go", BaseURL: s.BaseURL, APIKey: "stored-key"}}
	t.Setenv("AIEYRA_RUNTIME_PROFILE", s.ActiveProfile)
	t.Setenv("AIEYRA_RUNTIME_PROVIDER_IDENTITY", s.ProviderIdentity())
	t.Setenv("AIEYRA_RUNTIME_API_KEY", "temporary-runtime-secret")
	s.applyPoolProfile()
	if s.APIKey != "temporary-runtime-secret" || !s.EnvAPIKey() || s.ProviderConnections[0].APIKey != "stored-key" {
		t.Fatal("scoped credential not applied exclusively to request")
	}
	for _, edit := range []func(*Settings){func(x *Settings) { x.APIProfiles[0].BaseURL = "https://other.example/v1" }, func(x *Settings) { x.APIProfiles[0].Model = "different" }, func(x *Settings) { x.APIProfiles[0].Protocol = ProtocolResponses }, func(x *Settings) { x.ActiveProfile = "missing" }} {
		copy := s.Clone()
		edit(copy)
		copy.applyPoolProfile()
		if copy.APIKey == "temporary-runtime-secret" {
			t.Fatal("credential crossed profile identity")
		}
	}
	s.SetPath(filepath.Join(t.TempDir(), "new-config.json"))
	if err := s.Save(); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(s.Path())
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(raw, []byte("temporary-runtime-secret")) {
		t.Fatal("temporary credential persisted to new config")
	}
	var saved Settings
	if json.Unmarshal(raw, &saved) != nil || saved.APIKey != "" || saved.ProviderConnections[0].APIKey != "stored-key" {
		t.Fatal("saved credential source changed")
	}
	loaded, err := Load(s.Path())
	if err != nil {
		t.Fatal(err)
	}
	if loaded.APIKey != "temporary-runtime-secret" {
		t.Fatal("loaded profile lost temporary credential")
	}
	if err = loaded.Save(); err != nil {
		t.Fatal(err)
	}
	raw, _ = os.ReadFile(s.Path())
	if bytes.Contains(raw, []byte("temporary-runtime-secret")) {
		t.Fatal("temporary credential persisted to existing config")
	}
}

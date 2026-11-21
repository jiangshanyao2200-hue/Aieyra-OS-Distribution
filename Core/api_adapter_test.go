// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: adapterFixture; TestAPIAdapterActualRequestDisableAndDamagedPackage; TestAPIAdapterWorkerSnapshotAndCancellation; RunWorkerMissingAdapterForTest; TestAPIAdapterControlAdmissionAndSettingsHandoff
// Impact: python -B scripts/code-atlas.py show Core/api_adapter_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/aieyra/aieyra-os/CORE/extensionhost"
	"github.com/aieyra/aieyra-os/CORE/modules"
	"github.com/aieyra/aieyra-os/CORE/platform"
	"github.com/aieyra/aieyra-os/api/adapter"
)

func adapterFixture(t *testing.T) (*Settings, *modules.Manager, modules.Result) {
	t.Helper()
	s := Defaults()
	s.SetPath(filepath.Join(t.TempDir(), "config.json"))
	s.Model = "local-model"
	s.APIProtocol = "responses"
	s.Adapter = "openai"
	s.APIKey = "fixture-local-key"
	s.ModelPoolVersion = 0
	s.ActiveProfile = "fixture"
	source, err := filepath.Abs(filepath.Join("..", "SDK", "examples", "api-local-gateway"))
	if err != nil {
		t.Fatal(err)
	}
	m := extensionhost.New(platform.ResolveLayout("", s.Path(), "").Packages, extensionhost.Desktop())
	ctx := context.Background()
	p, err := m.Inspect(ctx, source)
	if err != nil || !p.Compatibility.Compatible {
		t.Fatal(p, err)
	}
	p, err = m.Call(ctx, modules.Request{Action: "install", Source: source, Origin: "local", ExpectedDigest: p.Digest, ExpectedRevision: &p.Revision, RequestID: "adapter-install"})
	if err != nil {
		t.Fatal(err)
	}
	p, err = m.Call(ctx, modules.Request{Action: "enable", ID: p.Item.Manifest.ID, ExpectedDigest: p.Digest, ExpectedRevision: &p.Revision, RequestID: "adapter-enable"})
	if err != nil {
		t.Fatal(err)
	}
	s.APIProfiles = []APIProfile{{ID: s.ActiveProfile, Model: s.Model, Protocol: s.APIProtocol, Adapter: s.Adapter, AdapterPackage: &adapter.Selection{ID: p.Item.Manifest.ID, Digest: p.Digest}}}
	return s, m, p
}

func TestAPIAdapterActualRequestDisableAndDamagedPackage(t *testing.T) {
	s, m, p := adapterFixture(t)
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		if r.URL.Path != "/gateway/responses" || r.Header.Get("x-adapter-fixture") != "local-gateway" || r.Header.Get("Authorization") != "Bearer fixture-local-key" || body["model"] != "gateway-model" || body["adapter_depth"] != float64(2) {
			t.Errorf("adapter request mismatch: %s %v", r.URL, body)
		}
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"id":"reply","status":"completed","output":[{"type":"message","id":"m1","role":"assistant","status":"completed","content":[{"type":"output_text","text":"OK"}]}],"usage":{"input_tokens":20,"output_tokens":1}}`)
	}))
	defer server.Close()
	s.BaseURL = server.URL
	client := New(s)
	message, usage, err := client.Complete(context.Background(), s, []Message{{Role: "user", Content: "Hello"}})
	if err != nil || message.Content != "OK" || usage == nil || usage.TotalTokens != 21 || calls != 1 {
		t.Fatal(message, usage, calls, err)
	}
	before := s.ProviderIdentity()
	cloned := s.Clone()
	cloned.APIProfiles[0].AdapterPackage.Digest = strings.Repeat("a", 64)
	if before == cloned.ProviderIdentity() || s.APIProfiles[0].AdapterPackage.Digest != p.Digest {
		t.Fatal("shared selection or native identity")
	}
	if client.validateRequestSettings(cloned) == nil {
		t.Fatal("stale client accepted changed adapter")
	}
	p, err = m.Call(context.Background(), modules.Request{Action: "disable", ID: p.Item.Manifest.ID, ExpectedDigest: p.Digest, ExpectedRevision: &p.Revision, RequestID: "adapter-disable"})
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err = client.Complete(context.Background(), s, []Message{{Role: "user", Content: "disabled"}}); err == nil || calls != 1 {
		t.Fatal("disabled adapter sent request", calls, err)
	}
	p, err = m.Call(context.Background(), modules.Request{Action: "enable", ID: p.Item.Manifest.ID, ExpectedDigest: p.Digest, ExpectedRevision: &p.Revision, RequestID: "adapter-enable-again"})
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(p.Item.Directory, "adapter.json"), []byte(`{}`), 0600); err != nil {
		t.Fatal(err)
	}
	if _, _, err = client.Complete(context.Background(), s, []Message{{Role: "user", Content: "damaged"}}); err == nil || calls != 1 {
		t.Fatal("damaged adapter sent request", calls, err)
	}
}

func TestAPIAdapterWorkerSnapshotAndCancellation(t *testing.T) {
	s, _, _ := adapterFixture(t)
	definition, err := resolveAPIAdapter(context.Background(), s.Path(), s.apiAdapterSelection())
	if err != nil {
		t.Fatal(err)
	}
	snapshot := modelWorkerSettings(s)
	raw, _ := json.Marshal(snapshot)
	var worker Settings
	if err = json.Unmarshal(raw, &worker); err != nil {
		t.Fatal(err)
	}
	if worker.Path() != "" || worker.apiAdapterSelection() == nil {
		t.Fatal("worker scope")
	}
	worker.BaseURL = "https://example.test"
	client := New(&worker)
	client.adapterSnapshot = definition
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	req, err := client.modelRequest(ctx, "responses", s.Model, map[string]any{"model": s.Model, "stream": true}, true)
	if err != nil || req.Context().Err() != context.Canceled || req.URL.Path != "/gateway/responses" {
		t.Fatal(req, err)
	}
	if _, err = RunWorkerMissingAdapterForTest(snapshot); err == nil {
		t.Fatal("missing worker snapshot accepted")
	}
}

func RunWorkerMissingAdapterForTest(s *Settings) (string, error) {
	data, _ := json.Marshal(modelWorkerRequest{Settings: s, Session: testMatrixOwner})
	var output strings.Builder
	err := RunMatrixModelWorker(strings.NewReader(string(data)), &output)
	return output.String(), err
}

func TestAPIAdapterControlAdmissionAndSettingsHandoff(t *testing.T) {
	s, registry, installed := adapterFixture(t)
	if err := s.Save(); err != nil {
		t.Fatal(err)
	}
	var received []map[string]json.RawMessage
	bridge := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request struct {
			Method  string `json:"method"`
			Payload struct {
				Action    string                     `json:"action"`
				Arguments map[string]json.RawMessage `json:"arguments"`
			} `json:"payload"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Error(err)
		}
		if request.Method != "system:settings" || request.Payload.Action != "model_adapter_update" {
			t.Error("unexpected settings dispatch", request.Method, request.Payload.Action)
		}
		received = append(received, request.Payload.Arguments)
		io.WriteString(w, `{"ok":true}`)
	}))
	defer bridge.Close()
	service := &SettingsService{config: s.Path(), endpoint: bridge.URL + "/renderer/index.html"}
	control := &MatrixControl{manager: &AgentManager{service: service, owner: testMatrixOwner}}
	args := map[string]any{"action": "api_adapter_apply", "id": installed.Item.Manifest.ID, "profile_id": s.ActiveProfile, "expected_digest": installed.Digest, "expected_version": "original-cas"}
	if _, err := control.Call(context.Background(), "settings", rawJSON(args)); err != nil {
		t.Fatal("resource center cannot apply adapter", err)
	}
	if len(received) != 1 || string(received[0]["expected_version"]) != `"original-cas"` || !strings.Contains(string(received[0]["selection"]), installed.Digest) || string(received[0]["id"]) != `"fixture"` {
		t.Fatal("target, digest or CAS lost", received)
	}
	_, err := registry.Call(context.Background(), modules.Request{Action: "disable", ID: installed.Item.Manifest.ID, ExpectedDigest: installed.Digest, ExpectedRevision: &installed.Revision, RequestID: "control-disable"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := control.Call(context.Background(), "settings", rawJSON(args)); err == nil || len(received) != 1 {
		t.Fatal("disabled adapter reached settings write", err)
	}
	args["action"] = "api_adapter_reset"
	if _, err := control.Call(context.Background(), "settings", rawJSON(args)); err != nil {
		t.Fatal("disabled adapter cannot be reset", err)
	}
	if len(received) != 2 || string(received[1]["selection"]) != "null" {
		t.Fatal("reset did not clear selection", received)
	}
	if _, err := control.Call(context.Background(), "settings", rawJSON(map[string]any{"action": "model_adapter_update"})); err == nil {
		t.Fatal("raw settings write exposed without package admission")
	}
}

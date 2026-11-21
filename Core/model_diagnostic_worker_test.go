// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestModelDiagnosticBoundTransportAndAdmission; TestModelDiagnosticActualSettingsServiceUsesCore; cfg; service; settings; ping; picker; diagnostic; probe; TestModelDiagnosticWorkerEOFReleasesHTTPRequest
// Impact: python -B scripts/code-atlas.py show Core/model_diagnostic_worker_test.go
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
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/aieyra/aieyra-os/CORE/modules"
)

func TestModelDiagnosticBoundTransportAndAdmission(t *testing.T) {
	s, registry, installed := adapterFixture(t)
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		if r.URL.Path != "/gateway/responses" || r.Header.Get("x-adapter-fixture") != "local-gateway" || body["model"] != "gateway-model" || body["stream"] != false {
			t.Error("diagnostic bypassed shared adapter")
		}
		if body["input"] == "error" {
			w.WriteHeader(401)
			io.WriteString(w, `{"error":{"message":"fixture-local-key rejected"}}`)
			return
		}
		io.WriteString(w, `{"status":"completed","opaque_integer":9007199254740993,"output":[]}`)
	}))
	defer server.Close()
	s.BaseURL = server.URL
	s.APIProfiles[0].BaseURL = server.URL
	if err := s.Save(); err != nil {
		t.Fatal(err)
	}
	request := modelDiagnosticRequest{Config: s.Path(), Profile: s.ActiveProfile, Identity: s.ProviderIdentity(), Selection: s.apiAdapterSelection(), TimeoutMS: 1000, Body: rawJSON(map[string]any{"model": s.Model, "stream": false, "max_output_tokens": 1024, "input": "test"})}
	result := modelDiagnostic(context.Background(), request)
	if !result.OK || !strings.Contains(string(result.Reply), "9007199254740993") || calls.Load() != 1 {
		t.Fatal(result, calls.Load())
	}
	for _, edit := range []func(*modelDiagnosticRequest){
		func(r *modelDiagnosticRequest) { r.Identity += "other" },
		func(r *modelDiagnosticRequest) { r.Profile = "missing" },
		func(r *modelDiagnosticRequest) { r.TimeoutMS = 72001 },
		func(r *modelDiagnosticRequest) {
			r.Body = rawJSON(map[string]any{"model": s.Model, "stream": true, "max_output_tokens": 1})
		},
		func(r *modelDiagnosticRequest) {
			r.Body = rawJSON(map[string]any{"model": s.Model, "stream": false, "max_output_tokens": 4097})
		},
	} {
		bad := request
		edit(&bad)
		if result = modelDiagnostic(context.Background(), bad); result.OK || calls.Load() != 1 {
			t.Fatal("invalid diagnostic dispatched", result)
		}
	}
	request.Body = rawJSON(map[string]any{"model": s.Model, "stream": false, "max_output_tokens": 1, "input": "error"})
	result = modelDiagnostic(context.Background(), request)
	if result.OK || result.Status != 401 || strings.Contains(result.Error, "fixture-local-key") || calls.Load() != 2 {
		t.Fatal("error redaction or retry", result, calls.Load())
	}
	_, err := registry.Call(context.Background(), modules.Request{Action: "disable", ID: installed.Item.Manifest.ID, ExpectedDigest: installed.Digest, ExpectedRevision: &installed.Revision, RequestID: "diagnostic-disable"})
	if err != nil {
		t.Fatal(err)
	}
	if result = modelDiagnostic(context.Background(), request); result.OK || calls.Load() != 2 {
		t.Fatal("disabled adapter sent diagnostic", result)
	}
}

func TestModelDiagnosticActualSettingsServiceUsesCore(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("Node unavailable")
	}
	s, _, _ := adapterFixture(t)
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		var body map[string]json.RawMessage
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		if r.URL.Path != "/gateway/responses" || r.Header.Get("x-adapter-fixture") != "local-gateway" || string(body["model"]) != `"gateway-model"` {
			t.Error("settings bypassed adapter")
		}
		var input []struct {
			Role   string `json:"role"`
			Type   string `json:"type"`
			Output string `json:"output"`
		}
		_ = json.Unmarshal(body["input"], &input)
		answer := "OK"
		for _, item := range input {
			if item.Type == "function_call_output" {
				answer = item.Output
			}
		}
		output := []any{map[string]any{"type": "message", "role": "assistant", "content": []any{map[string]any{"type": "output_text", "text": answer}}}}
		if answer == "OK" && len(body["tools"]) > 0 {
			match := regexp.MustCompile(`nonce ([a-f0-9]+)`).FindStringSubmatch(string(body["input"]))
			if len(match) != 2 {
				t.Error("missing diagnostic nonce")
				w.WriteHeader(400)
				return
			}
			output = []any{map[string]any{"type": "function_call", "call_id": "diagnostic-call", "name": "verify_matrix", "arguments": string(rawJSON(map[string]any{"nonce": match[1]}))}}
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"id": "diagnostic", "status": "completed", "output": output, "usage": map[string]any{"input_tokens": 2000, "output_tokens": 20, "input_tokens_details": map[string]any{"cached_tokens": 0}}})
	}))
	defer server.Close()
	s.BaseURL = server.URL
	s.ModelPoolVersion = 1
	s.ProviderConnections = []ProviderConnection{{ID: "diagnostic", Provider: "custom", BaseURL: server.URL, APIKey: s.APIKey, RequestTimeout: 30}}
	p := &s.APIProfiles[0]
	p.ConnectionID = "diagnostic"
	p.BaseURL = server.URL
	p.Provider = "custom"
	p.ContextWindow = 128000
	p.ContextWindowSource = "user_config"
	p.ToolCalls = true
	p.Parameters = rawJSON(map[string]any{"stream": false, "max_tokens": 1024, "thinking_type": "disabled", "response_format": "text", "model_options": map[string]any{}})
	s.applyPoolProfile()
	if err = s.Save(); err != nil {
		t.Fatal(err)
	}
	root := mustProjectRoot(t)
	script := filepath.Join(t.TempDir(), "diagnostic.cjs")
	source := `const {createService}=require(process.argv[2]+'/Client/Desktop/src/service.cjs');
const cfg=require(process.argv[2]+'/Client/Desktop/src/config.cjs');
const service=createService(process.argv[3]);
(async()=>{try{
const settings=cfg.load(process.argv[3]).settings;
const ping=await service.call('pool:test',{settings,id:'fixture'});if(!ping.ok)throw Error(JSON.stringify(ping));
const picker=await service.call('system:settings',{action:'pool',arguments:{op:'test',connection_id:'diagnostic',profile_id:'fixture',model:'local-model'}});if(!picker.ok)throw Error(JSON.stringify(picker));
const diagnostic=await service.call('system:settings',{action:'model_diagnostics',arguments:{id:'fixture',mode:'all'}});
if(!diagnostic.ok||!diagnostic.report.tools.ok||diagnostic.report.requests!==5||diagnostic.report.cache.length!==3||diagnostic.report.cache.some(x=>x.cache_hit_tokens!==0))throw Error(JSON.stringify(diagnostic));
const probe=await service.call('pool:probe',{settings,id:'fixture',parameters:[]});if(!probe.ok||probe.result.requests!==1)throw Error(JSON.stringify(probe));
console.log('actual-settings-diagnostics-ok');
}finally{service.close();}})().catch(e=>{console.error(e.message);process.exitCode=1;});`
	if err = os.WriteFile(script, []byte(source), 0600); err != nil {
		t.Fatal(err)
	}
	exe, _ := os.Executable()
	command := exec.Command(node, script, root, s.Path())
	command.Env = append(os.Environ(), "AIEYRA_CORE_EXECUTABLE="+exe)
	data, err := command.CombinedOutput()
	if err != nil || !strings.Contains(string(data), "actual-settings-diagnostics-ok") || calls.Load() != 8 {
		t.Fatal("settings diagnostic integration", err, string(data), calls.Load())
	}
}

func TestModelDiagnosticWorkerEOFReleasesHTTPRequest(t *testing.T) {
	s, _, _ := adapterFixture(t)
	started, cancelled := make(chan struct{}), make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		close(started)
		select {
		case <-r.Context().Done():
			close(cancelled)
		case <-time.After(8 * time.Second):
			t.Error("HTTP request outlived worker cancellation")
		}
	}))
	defer server.Close()
	s.BaseURL = server.URL
	s.APIProfiles[0].BaseURL = server.URL
	if err := s.Save(); err != nil {
		t.Fatal(err)
	}
	exe, _ := os.Executable()
	command := exec.Command(exe, ModelDiagnosticWorkerFlag)
	command.Env = modelWorkerEnvironment(os.Environ())
	hideModelWorker(command)
	input, err := command.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	output, err := command.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err = command.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { input.Close(); command.Process.Kill() })
	request := modelDiagnosticRequest{Config: s.Path(), Profile: s.ActiveProfile, Identity: s.ProviderIdentity(), Selection: s.apiAdapterSelection(), TimeoutMS: 7000, Body: rawJSON(map[string]any{"model": s.Model, "stream": false, "max_output_tokens": 1, "input": "wait"})}
	if err = json.NewEncoder(input).Encode(request); err != nil {
		t.Fatal(err)
	}
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("diagnostic did not reach provider")
	}
	input.Close()
	var result modelDiagnosticReply
	if err = json.NewDecoder(output).Decode(&result); err != nil {
		t.Fatal(err)
	}
	if err = command.Wait(); err != nil || result.OK {
		t.Fatal(result, err)
	}
	select {
	case <-cancelled:
	case <-time.After(time.Second):
		t.Fatal("HTTP not cancelled")
	}
}

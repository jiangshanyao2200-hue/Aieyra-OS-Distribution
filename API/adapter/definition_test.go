// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: API/adapter/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: example; TestPreparePreservesProtocolContentAndExplicitUserValues; TestAdmissionRejectsRoutingCredentialsAndProtocolMutation; TestNativeRouteKeepsModelEscapedAndOutputValuesIndependent
// Impact: python -B scripts/code-atlas.py show API/adapter/definition_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package adapter

import (
	"encoding/json"
	"testing"

	"github.com/aieyra/aieyra-os/api/parameters"
)

func example() Definition {
	return Definition{Schema: "aieyra.api/1", Protocol: "responses", Path: "/gateway/responses", Headers: map[string]string{"x-client-mode": "fixture"}, ModelAliases: map[string]string{"logical": "wire"}, Defaults: []Field{{Spec: parameters.Spec{Key: "depth", Type: "integer", Min: 0, Max: 8, Source: "fixture description", WirePath: []string{"depth"}}, Value: float64(2)}}}
}

func TestPreparePreservesProtocolContentAndExplicitUserValues(t *testing.T) {
	d := example()
	body := map[string]any{"model": "logical", "input": []any{map[string]any{"type": "function_call_output", "call_id": "original", "output": "completed once"}}, "stream": true, "depth": float64(0)}
	body["native_sequence"] = json.RawMessage(`9007199254740993`)
	endpoint, raw, headers, err := d.Prepare("https://example.test/v1", "responses", "logical", true, body)
	if err != nil || endpoint != "https://example.test/v1/gateway/responses" || headers.Get("X-Client-Mode") != "fixture" {
		t.Fatal(endpoint, headers, err)
	}
	var value map[string]any
	if err = json.Unmarshal(raw, &value); err != nil {
		t.Fatal(err)
	}
	if value["model"] != "wire" || value["depth"] != float64(0) || value["stream"] != true || body["model"] != "logical" {
		t.Fatal(value, body)
	}
	if value["input"].([]any)[0].(map[string]any)["call_id"] != "original" {
		t.Fatal(value)
	}
	var exact map[string]json.RawMessage
	json.Unmarshal(raw, &exact)
	if string(exact["native_sequence"]) != "9007199254740993" {
		t.Fatal("opaque native integer changed")
	}
	delete(body, "depth")
	_, raw, _, err = d.Prepare("https://example.test", "responses", "logical", false, body)
	if err != nil {
		t.Fatal(err)
	}
	json.Unmarshal(raw, &value)
	if value["depth"] != float64(2) {
		t.Fatal(value)
	}
}

func TestAdmissionRejectsRoutingCredentialsAndProtocolMutation(t *testing.T) {
	for _, path := range []string{"https://example.test/steal", "//example.test/steal", "/../steal", "/%2e%2e/steal", "/path?key=secret", "/{other}"} {
		d := example()
		d.Path = path
		if d.Validate() == nil {
			t.Fatalf("accepted %s", path)
		}
	}
	for _, key := range []string{"authorization", "cookie", "host", "x-api-key", "x-goog-api-key", "x-opencode-session", "x-forwarded-host"} {
		d := example()
		d.Headers = map[string]string{key: "literal"}
		if d.Validate() == nil {
			t.Fatalf("accepted header %s", key)
		}
	}
	for _, field := range []string{"model", "messages", "input", "tools", "stream", "api_key", "previous_response_id"} {
		d := example()
		d.Defaults[0].Spec.Key = field
		d.Defaults[0].Spec.WirePath = []string{field}
		if d.Validate() == nil {
			t.Fatalf("accepted field %s", field)
		}
	}
	d := example()
	if _, _, _, err := d.Prepare("https://example.test", "chat_completions", "logical", false, map[string]any{}); err == nil {
		t.Fatal("mismatched protocol")
	}
	for _, suffix := range []string{`,"script":"execute"}`, `} {}`} {
		if _, err := Decode([]byte(`{"schema":"aieyra.api/1","protocol":"responses"` + suffix)); err == nil {
			t.Fatal("unrecognized content accepted")
		}
	}
}

func TestNativeRouteKeepsModelEscapedAndOutputValuesIndependent(t *testing.T) {
	d := Definition{Schema: "aieyra.api/1", Protocol: "google_generate", ModelAliases: map[string]string{"logical": "vendor/model"}}
	url, raw, headers, err := d.Prepare("https://example.test/v1", "google_generate", "logical", true, map[string]any{"contents": []any{}})
	if err != nil || url != "https://example.test/v1/models/vendor%2Fmodel:streamGenerateContent?alt=sse" {
		t.Fatal(url, err)
	}
	var body map[string]any
	json.Unmarshal(raw, &body)
	if _, ok := body["model"]; ok {
		t.Fatal(body)
	}
	headers.Set("x-isolated", "yes")
	_, _, next, err := d.Prepare("https://example.test/v1", "google_generate", "logical", false, map[string]any{})
	if err != nil || next.Get("x-isolated") != "" {
		t.Fatal(next, err)
	}
}

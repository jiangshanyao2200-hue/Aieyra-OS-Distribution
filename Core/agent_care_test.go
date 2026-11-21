// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestModelsReadinessMatchesImageExecution; TestMemoryLookupShowsLateMatchAndReadReference
// Impact: python -B scripts/code-atlas.py show Core/agent_care_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestModelsReadinessMatchesImageExecution(t *testing.T) {
	for _, mode := range []string{"ready", "connection_off", "model_off", "missing_key", "endpoint_mismatch", "unselected", "generation_off"} {
		t.Run(mode, func(t *testing.T) {
			config := imageGenTestConfig(t, "https://provider.invalid/v1", true)
			data, _ := os.ReadFile(config)
			var raw map[string]any
			_ = json.Unmarshal(data, &raw)
			profile := raw["api_profiles"].([]any)[0].(map[string]any)
			connection := raw["provider_connections"].([]any)[0].(map[string]any)
			profile["kind"] = "image"
			switch mode {
			case "connection_off":
				connection["enabled"] = false
			case "model_off":
				profile["enabled"] = false
			case "missing_key":
				connection["api_key"] = ""
			case "endpoint_mismatch":
				profile["base_url"] = "https://other.invalid/v1"
			case "unselected":
				raw["image_profiles"] = []string{}
			case "generation_off":
				raw["image_generation_enabled"] = false
			}
			_ = os.WriteFile(config, rawJSON(raw), 0600)
			value, err := discoverModels(config, rawJSON(map[string]any{"category": "image"}))
			if err != nil {
				t.Fatal(err)
			}
			rows := value.(map[string]any)["models"].([]map[string]any)
			if len(rows) != 1 {
				t.Fatal(rows)
			}
			choice := resolveImageGenChoice(config, "image-model")
			if rows[0]["available"] != choice.Ready || choice.Ready != (mode == "ready" || mode == "generation_off") {
				t.Fatalf("readiness disagreement: %v; %v", rows, choice.Ready)
			}
			if !choice.Ready && memString(rows[0]["unavailable_reason"]) == "" {
				t.Fatal("missing actionable reason", rows)
			}
			if strings.Contains(string(rawJSON(value)), "fake-key-only") {
				t.Fatal("credential leaked")
			}
		})
	}
}

func TestMemoryLookupShowsLateMatchAndReadReference(t *testing.T) {
	s := pacTestStore(t)
	body := strings.Repeat("前言🌱。", 500) + "late_needle_83 用户明确要求保留原件" + strings.Repeat("。后记", 400)
	memoryCall(t, s, memoryRow{"action": "record", "kind": "fact", "title": "长记录", "content": body, "scope": "project"}, "project:a", "test")
	pacTestTranscript(t, s, "project:a", "late-session", []Message{{Role: RoleUser, Content: body}})
	pacTestSeal(t, s, "project:a", "late-session", "阶段", body, 0, 0)
	page := memoryCall(t, s, memoryRow{"action": "lookup", "query": "late_needle_83"}, "project:a", "test")
	for _, name := range []string{"records", "packets", "transcripts"} {
		rows := page[name].([]memoryRow)
		if len(rows) != 1 {
			t.Fatalf("%s: %v", name, rows)
		}
		field := "content"
		if name == "transcripts" {
			field = "excerpt"
		}
		excerpt := memString(rows[0][field])
		if !strings.Contains(excerpt, "late_needle_83") || len([]rune(excerpt)) > 600 || rows[0]["truncated"] != true {
			t.Fatalf("%s lost late match: %v", name, rows[0])
		}
		ref, ok := rows[0]["read"].(memoryRow)
		if !ok {
			t.Fatalf("%s lacks read reference", name)
		}
		if ref["action"] == "packet" {
			ref["action"] = "pac_read"
		}
		if ref["action"] == "original" {
			ref["action"] = "pac_message"
		}
		if _, err := s.Call(context.Background(), ref, "project:a", "test"); err != nil {
			t.Fatal(name, err)
		}
	}
}

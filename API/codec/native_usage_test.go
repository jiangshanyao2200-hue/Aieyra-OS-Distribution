// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: API/codec/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestNativeUsagePresenceSurvivesDecodeAndWorkerJSON; TestAnthropicThinkingUsageAliasUsesValidValue
// Impact: python -B scripts/code-atlas.py show API/codec/native_usage_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package codec

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

func TestNativeUsagePresenceSurvivesDecodeAndWorkerJSON(t *testing.T) {
	for _, provider := range []string{"messages", "google"} {
		for _, tc := range []struct {
			name, value string
			known       bool
			count       int
		}{
			{"absent", "", false, 0},
			{"null", "null", false, 0},
			{"zero", "0", true, 0},
			{"positive", "7", true, 7},
			{"string", `"7"`, false, 0},
			{"boolean", "false", false, 0},
			{"object", "{}", false, 0},
			{"array", "[]", false, 0},
			{"negative", "-1", false, 0},
			{"fraction", "0.5", false, 0},
			{"overflow", "1e100", false, 0},
		} {
			t.Run(provider+"/"+tc.name, func(t *testing.T) {
				cache, thought := "cache_read_input_tokens", "thinking_tokens"
				usage := `{"input_tokens":20,"output_tokens":3`
				if provider == "google" {
					cache, thought = "cachedContentTokenCount", "thoughtsTokenCount"
					usage = `{"promptTokenCount":20,"candidatesTokenCount":3`
				}
				if tc.value != "" {
					usage += fmt.Sprintf(",%q:%s", cache, tc.value)
					if provider == "messages" {
						usage += fmt.Sprintf(`,"output_tokens_details":{%q:%s}`, thought, tc.value)
					} else {
						usage += fmt.Sprintf(",%q:%s", thought, tc.value)
					}
				}
				usage += "}"
				for _, stream := range []bool{false, true} {
					var u *Usage
					var err error
					if provider == "messages" {
						if stream {
							wire := "data: " + `{"type":"message_start","message":{"id":"usage-fixture","usage":{"input_tokens":20}}}` + "\n\n" +
								"data: " + `{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":` + usage + "}\n\n" +
								"data: " + `{"type":"message_stop"}` + "\n\n"
							_, u, err = ReadAnthropic(strings.NewReader(wire), func(Event) error { return nil })
						} else {
							_, u, err = ParseAnthropic([]byte(`{"id":"usage-fixture","content":[],"stop_reason":"end_turn","usage":`+usage+"}"), nil)
						}
					} else {
						wire := `{"responseId":"usage-fixture","candidates":[{"content":{"parts":[{"text":"done"}]},"finishReason":"STOP"}],"usageMetadata":` + usage + "}"
						if stream {
							_, u, err = ReadGoogle(strings.NewReader("data: "+wire+"\n\n"), nil)
						} else {
							_, u, err = ParseGoogle([]byte(wire), nil)
						}
					}
					if err != nil || u == nil {
						t.Fatal("native fixture failed", stream, err)
					}
					wire, err := json.Marshal(u)
					if err != nil {
						t.Fatal(err)
					}
					var restored Usage
					if err := json.Unmarshal(wire, &restored); err != nil {
						t.Fatal(err)
					}
					for _, actual := range []*Usage{u, &restored} {
						if count, known := actual.CachedTokens(); count != tc.count || known != tc.known {
							t.Fatalf("stream=%v cached=(%d,%v), want (%d,%v); wire=%s", stream, count, known, tc.count, tc.known, wire)
						}
						if (actual.CompletionTokensDetails != nil) != tc.known {
							t.Fatal("thinking presence changed", stream, string(wire))
						}
						if tc.known && actual.CompletionTokensDetails.ReasoningTokens != tc.count {
							t.Fatal("thinking count changed", stream, string(wire))
						}
					}
				}
			})
		}
	}
}

func TestAnthropicThinkingUsageAliasUsesValidValue(t *testing.T) {
	for _, tc := range []struct {
		details string
		want    int
	}{
		{`{"thinking_tokens":null,"reasoning_tokens":7}`, 7},
		{`{"thinking_tokens":"bad","reasoning_tokens":7}`, 7},
		{`{"thinking_tokens":0,"reasoning_tokens":7}`, 0},
	} {
		var usage map[string]any
		if err := json.Unmarshal([]byte(`{"output_tokens_details":`+tc.details+"}"), &usage); err != nil {
			t.Fatal(err)
		}
		u := AnthropicUsage(usage)
		if u.CompletionTokensDetails == nil || u.CompletionTokensDetails.ReasoningTokens != tc.want {
			t.Fatal("valid alias lost or explicit zero overwritten", tc.details, u)
		}
	}
}

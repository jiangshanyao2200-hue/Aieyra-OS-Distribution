// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: API/parameters/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: parameterIdentifier; ValidPath
// Impact: python -B scripts/code-atlas.py show API/parameters/paths.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package parameters

import (
	"math"
	"regexp"
	"strings"
	"unicode/utf8"
)

var parameterIdentifier = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_]{0,63}$`)

func ValidPath(f Spec) bool {
	if len(f.WirePath) < 1 || len(f.WirePath) > 3 || utf8.RuneCountInString(f.Source) < 3 || utf8.RuneCountInString(f.Source) > 500 {
		return false
	}
	reserved := "|system|contents|systemInstruction|include|provider|metadata|model|messages|input|instructions|tools|tool_choice|stream|stream_options|store|previous_response_id|api_key|authorization|headers|url|base_url|__proto__|prototype|constructor|max_tokens|max_output_tokens|temperature|top_p|response_format|"
	for _, k := range append([]string{f.Key}, f.WirePath...) {
		if !parameterIdentifier.MatchString(k) || strings.Contains(reserved, "|"+k+"|") {
			return false
		}
	}
	if f.Type != "boolean" && f.Type != "enum" && f.Type != "strings" && f.Type != "number" && f.Type != "integer" {
		return false
	}
	if f.Type == "number" || f.Type == "integer" {
		if math.IsNaN(f.Min) || math.IsNaN(f.Max) || math.IsInf(f.Min, 0) || math.IsInf(f.Max, 0) || f.Min > f.Max || math.Abs(f.Min) > 1e9 || math.Abs(f.Max) > 1e9 {
			return false
		}
	}
	if f.Type == "enum" {
		if len(f.Values) == 0 || len(f.Values) > 32 {
			return false
		}
		for _, v := range f.Values {
			if utf8.RuneCountInString(v) > 100 {
				return false
			}
		}
	}
	path := strings.Join(f.WirePath, ".")
	for _, k := range strings.Split("reasoning.effort|reasoning.enabled|reasoning.max_tokens|reasoning.summary|thinking.type|thinking.reasoning_effort|thinking.budget_tokens|generationConfig.maxOutputTokens|generationConfig.temperature|generationConfig.topP|generationConfig.topK|generationConfig.seed|generationConfig.stopSequences|generationConfig.responseMimeType|generationConfig.thinkingConfig|output_config.effort", "|") {
		if path == k || strings.HasPrefix(path, k+".") {
			return false
		}
	}
	nested := strings.Contains("|reasoning|thinking|generationConfig|output_config|text|", "|"+f.WirePath[0]+"|")
	return !(len(f.WirePath) == 1 && nested || len(f.WirePath) > 1 && !nested || f.WirePath[0] == "text" && len(f.WirePath) > 1 && f.WirePath[1] == "format")
}

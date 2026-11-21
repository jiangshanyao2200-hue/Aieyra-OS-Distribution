// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: parseWebSearch; parseOpenAISearch; parseGeminiSearch; parseQwenSearch; safeSearchURL
// Impact: python -B scripts/code-atlas.py show Core/web_search_compat_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import searchapi "github.com/aieyra/aieyra-os/api/search"

// Existing protocol regression fixtures exercise the independently owned parsers.
var parseWebSearch = searchapi.ParseAnthropic
var parseOpenAISearch = searchapi.ParseOpenAI
var parseGeminiSearch = searchapi.ParseGemini
var parseQwenSearch = searchapi.ParseQwen
var safeSearchURL = searchapi.SafeURL

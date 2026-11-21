// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: API/catalog/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: Entries; rule; ReviewedSpec; nativeModel; grokBuildVariant; capacity; lookup
// Impact: python -B scripts/code-atlas.py show API/catalog/query.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package catalog

import (
	"encoding/json"
	"github.com/aieyra/aieyra-os/api/parameters"
	"reflect"
	"regexp"
	"slices"
	"strings"
)

func (c Catalog) Entries(provider, baseURL string) []Entry {
	// An empty address is a public reference listing, never a runtime profile.
	if baseURL != "" {
		provider = Provider(Profile{Provider: provider, BaseURL: baseURL})
	}
	rows := []Entry{}
	for _, row := range c.models {
		if row.Provider == provider {
			rows = append(rows, row)
		}
	}
	slices.SortStableFunc(rows, func(a, b Entry) int {
		if a.Rank != b.Rank {
			return a.Rank - b.Rank
		}
		return strings.Compare(a.ID, b.ID)
	})
	var detached []Entry
	_ = json.Unmarshal(rawJSON(rows), &detached)
	return detached
}

func (c Catalog) rule(p Profile) (parameters.Rule, bool) {
	entry, ok := c.lookup(p)
	if !ok && p.Provider != "bailian" {
		entry, ok = c.nativeModel(p.Model)
	}
	if ok {
		for _, rule := range entry.Rules {
			if rule.Protocol == p.Protocol {
				return rule, true
			}
		}
	}
	return parameters.Rule{}, false
}

func (c Catalog) ReviewedSpec(f parameters.Spec) bool {
	for _, entry := range append(append([]Entry{}, c.models...), c.native...) {
		for _, rule := range entry.Rules {
			for _, spec := range rule.ParameterSpecs {
				if reflect.DeepEqual(f, spec) {
					return true
				}
			}
		}
	}
	return false
}

func (c Catalog) nativeModel(id string) (Entry, bool) {
	id = strings.TrimSuffix(id, ":free")
	rows := c.nativeIndex
	if entry, ok := rows[id]; ok {
		return entry, true
	}
	prefix, name, qualified := strings.Cut(id, "/")
	publisher := map[string]string{"openai": "openai", "google": "google", "x-ai": "xai", "xai": "xai", "anthropic": "anthropic", "deepseek": "deepseek"}[prefix]
	if qualified && publisher != "" {
		if entry, ok := rows[name]; ok && entry.Provider == publisher {
			return entry, true
		}
	}
	// Build 变体与本体同容量、同思考档位（网关实测 grok-4.7-build-fast 接受 low/medium/high/xhigh）。
	if match := grokBuildVariant.FindStringSubmatch(id); match != nil {
		if entry, ok := rows[match[1]]; ok && entry.Provider == "xai" {
			return entry, true
		}
	}
	return Entry{}, false
}

var grokBuildVariant = regexp.MustCompile(`^(grok-\d[\d.]*)-build(?:-fast)?$`)

func (c Catalog) capacity(p Profile) (Entry, bool) {
	entry, channel := c.channelIndex[Provider(p)+"\x00"+p.Model]
	if p.Provider != "bailian" {
		native, found := c.nativeModel(p.Model)
		if !channel {
			return native, found
		}
		if found {
			if entry.ContextWindow <= 0 {
				entry.ContextWindow = native.ContextWindow
			}
			if entry.MaxInput <= 0 {
				entry.MaxInput = native.MaxInput
			}
			if entry.MaxOutput <= 0 {
				entry.MaxOutput = native.MaxOutput
			}
		}
	}
	return entry, channel
}

func (c Catalog) lookup(p Profile) (Entry, bool) {
	entry, ok := c.channelIndex[Provider(p)+"\x00"+p.Model]
	return entry, ok && slices.Contains(entry.Protocols, p.Protocol)
}

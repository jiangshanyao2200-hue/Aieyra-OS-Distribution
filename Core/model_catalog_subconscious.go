// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: subconsciousPoolProfile; clearInvalidSubconsciousProfile; SubconsciousSettings
// Impact: python -B scripts/code-atlas.py show Core/model_catalog_subconscious.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

func (s *Settings) subconsciousPoolProfile() *APIProfile {
	if s == nil || s.ModelPoolVersion != 1 || s.SubconsciousProfile == "" {
		return nil
	}
	for i := range s.APIProfiles {
		p := &s.APIProfiles[i]
		if p.ID == s.SubconsciousProfile && (p.Enabled == nil || *p.Enabled) {
			return p
		}
	}
	return nil
}

func (s *Settings) clearInvalidSubconsciousProfile() {
	if s.subconsciousPoolProfile() == nil {
		s.SubconsciousProfile = ""
	}
}

// SubconsciousSettings resolves the independently selected profile and its
// connection into a detached request snapshot. The main selection is untouched.
func (s *Settings) SubconsciousSettings() (*Settings, bool) {
	p := s.subconsciousPoolProfile()
	if p == nil {
		return nil, false
	}
	found := false
	for _, c := range s.ProviderConnections {
		if c.ID == p.ConnectionID && NormalizeBaseURL(c.BaseURL) == NormalizeBaseURL(p.BaseURL) {
			found = true
			break
		}
	}
	if !found {
		return nil, false
	}
	snapshot := s.Clone()
	snapshot.ActiveProfile = p.ID
	snapshot.applyPoolProfile()
	return snapshot, true
}

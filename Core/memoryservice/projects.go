// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/memoryservice/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: ExistingProjects
// Impact: python -B scripts/code-atlas.py show Core/memoryservice/projects.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package memory

import (
	"context"
	"encoding/hex"
	"fmt"
	"strings"
)

// ExistingProjects resolves only host-supplied path identities against retained
// metadata. It neither reads memory contents nor renames/merges stored scopes.
// The host must derive these candidates from verified migration origins.
func (s *Store) ExistingProjects(ctx context.Context, projects []string) ([]string, error) {
	if len(projects) == 0 || len(projects) > 4096 {
		return nil, fmt.Errorf("invalid project identity count")
	}
	args := make([]any, len(projects))
	for i, project := range projects {
		if !strings.HasPrefix(project, "project:") || len(project) != 72 {
			return nil, fmt.Errorf("invalid project identity")
		}
		if _, err := hex.DecodeString(project[8:]); err != nil {
			return nil, fmt.Errorf("invalid project identity")
		}
		args[i] = project
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	query := `SELECT DISTINCT scope FROM (
SELECT scope FROM memories UNION SELECT scope FROM keywords UNION SELECT scope FROM dreams
UNION SELECT project AS scope FROM os_continuity UNION SELECT scope FROM pac_packets
UNION SELECT scope FROM transcript_scopes) WHERE scope IN (` + strings.TrimSuffix(strings.Repeat("?,", len(args)), ",") + `) ORDER BY scope`
	rows, err := memoryRows(ctx, s.db, query, args...)
	if err != nil {
		return nil, err
	}
	var result []string
	for _, row := range rows {
		result = append(result, memString(row["scope"]))
	}
	return result, nil
}

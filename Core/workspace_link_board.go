// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: internalLinkSeat; internalLinkBrief; internalLinkBoard
// Impact: python -B scripts/code-atlas.py show Core/workspace_link_board.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"fmt"
	"sort"
)

type internalLinkSeat struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Generation int    `json:"generation"`
	State      string `json:"state"`
	Current    bool   `json:"current"`
}

type internalLinkBrief struct {
	From string `json:"from"`
	To   string `json:"to"`
	Text string `json:"brief"`
}

// The board observes running instances across the OS. Only the selected
// room supplies public messages and idle seats.
func (w *Workspace) internalLinkBoard() (any, error) {
	if w.host == nil || w.Mode() != HostOS || !w.coreLinkRegistered.Load() || w.split != nil {
		return nil, fmt.Errorf("内部工位仅在 Eyra 主工作区可用")
	}
	w.mu.Lock()
	scope, motherID := w.coreLinkScopeLocked(), w.state.Roles[WorkspaceMatrix]
	w.mu.Unlock()

	primary, conversations, packages, workflows := w.liveAgentManagers()
	secrets, _ := primary.redactionSecrets()
	publicName := func(name string) string {
		return utf8Prefix(redactSecretEncodings(name, secrets), 120)
	}
	mother := internalLinkSeat{ID: motherID, Name: "Eyra", State: "idle", Current: true}
	rows := map[string]internalLinkSeat{}
	seenManagers := map[*AgentManager]bool{}
	for _, manager := range []*AgentManager{primary, conversations, packages, workflows} {
		if manager == nil || seenManagers[manager] {
			continue
		}
		seenManagers[manager] = true
		manager.mu.Lock()
		for id, job := range manager.jobs {
			r := job.record
			if r.DeletionPending || r.Spec.Kind == "workspace_link" {
				continue
			}
			if manager == primary && r.Spec.WorkspaceRole == WorkspaceMatrix {
				if id == motherID {
					mother.Generation, mother.State = r.Generation, r.State
				}
				continue
			}
			if !activeAgent(r.State) {
				continue
			}
			current := r.Link != nil && r.Link.Scope == scope
			for request, origin := range r.TurnOrigins {
				if r.TurnGenerations[request] == r.Generation && origin.Scope == scope {
					current = true
					break
				}
			}
			rows[id] = internalLinkSeat{ID: id, Name: r.Spec.Title, Generation: r.Generation, State: r.State, Current: current}
		}
		manager.mu.Unlock()
	}

	briefs := []internalLinkBrief{}
	briefsAvailable := true
	if conversations != nil {
		room, err := conversations.conversationLinkDisplay(AgentRecord{ID: scope, Spec: AgentSpec{Kind: "workspace_link"}}, false)
		briefsAvailable = err == nil
		names := map[string]string{scope: mother.Name}
		members, _ := room["members"].([]map[string]any)
		authors, _ := room["authors"].([]map[string]any)
		for _, row := range members {
			id, _ := row["id"].(string)
			name, _ := row["name"].(string)
			names[id] = publicName(name)
			if id == "" || id == scope {
				continue
			}
			seat, active := rows[id]
			if active {
				seat.Name = names[id]
			} else {
				generation, _ := row["generation"].(int)
				state, _ := row["state"].(string)
				seat = internalLinkSeat{ID: id, Name: names[id], Generation: generation, State: state, Current: true}
			}
			rows[id] = seat
		}
		for _, row := range authors {
			id, _ := row["id"].(string)
			name, _ := row["name"].(string)
			names[id] = publicName(name)
		}
		messages, _ := room["messages"].([]groupMessage)
		for i := len(messages) - 1; i >= 0 && len(briefs) < 24; i-- {
			msg := messages[i]
			if brief := redactSecretEncodings(msg.Brief, secrets); brief != "" {
				briefs = append(briefs, internalLinkBrief{names[msg.From], names[msg.To], brief})
			}
		}
	}

	seats := make([]internalLinkSeat, 0, len(rows))
	active := 0
	for _, seat := range rows {
		seat.Name = publicName(seat.Name)
		seats = append(seats, seat)
		if activeAgent(seat.State) {
			active++
		}
	}
	sort.Slice(seats, func(i, j int) bool {
		a, b := seats[i], seats[j]
		if activeAgent(a.State) != activeAgent(b.State) {
			return activeAgent(a.State)
		}
		if a.Current != b.Current {
			return a.Current
		}
		if a.Name != b.Name {
			return a.Name < b.Name
		}
		return a.ID < b.ID
	})
	return map[string]any{"mother": mother, "seats": seats[:min(128, len(seats))], "total": len(seats), "active": active, "briefs": briefs, "briefs_available": briefsAvailable}, nil
}

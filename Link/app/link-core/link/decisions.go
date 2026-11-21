// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Link/app/link-core/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: canDecide; decisions
// Impact: python -B scripts/code-atlas.py show Link/app/link-core/link/decisions.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package link

import (
	"fmt"
	"sort"
	"strings"
	"time"
)

func (h *Hub) canDecide(d Device, m Message) bool {
	return d.Admin || m.SenderID == d.ID || h.state.Sessions[m.SessionID].DeviceID == d.ID
}

func (h *Hub) decisions(d Device, path string, body []byte) (any, error) {
	switch path {
	case "/v1/cancel":
		var p struct {
			ID string `json:"id"`
		}
		if err := decode(body, &p); err != nil {
			return nil, err
		}
		m, ok := h.state.Messages[p.ID]
		if !ok || !h.canDecide(d, m) {
			return nil, fmt.Errorf("message owner required")
		}
		if !m.CancelRequested && !finalState(m.State) {
			m.CancelRequested, m.UpdatedAt = true, now()
			h.state.Messages[m.ID] = m
			h.emit("cancel", m.ID, "requested")
		}
		return m, nil
	case "/v1/answer":
		var p struct {
			ID        string   `json:"id"`
			RequestID string   `json:"request_id"`
			HumanID   string   `json:"human_id"`
			Version   int      `json:"expected_request_version"`
			Token     string   `json:"request_token_sha256"`
			Decision  Decision `json:"decision"`
		}
		if err := decode(body, &p); err != nil {
			return nil, err
		}
		m, ok := h.state.Messages[p.ID]
		if !ok || !h.canDecide(d, m) {
			return nil, fmt.Errorf("message owner required")
		}
		if !validID(p.RequestID) || len(p.Decision.Text) > 16000 {
			return nil, fmt.Errorf("invalid answer")
		}
		id := hash([]byte(d.ID + "\n" + p.RequestID))
		if prior, ok := h.state.Answers[id]; ok {
			if prior.MessageID != p.ID || prior.Human.ID != p.HumanID || prior.Human.Version != p.Version || prior.Human.Token != p.Token || prior.Decision != p.Decision {
				return nil, fmt.Errorf("answer request ID conflicts with prior content")
			}
			return prior, nil
		}
		if m.State != "waiting_user" || m.CancelRequested || m.Human == nil || m.Human.ID != p.HumanID || m.Human.Version != p.Version || m.Human.Token != p.Token {
			return nil, fmt.Errorf("human question changed; read the message again")
		}
		if m.Human.ExpiresAt != "" {
			expires, err := time.Parse(time.RFC3339Nano, m.Human.ExpiresAt)
			if err != nil || !time.Now().Before(expires) {
				return nil, fmt.Errorf("human question expired; read the message again")
			}
		}
		if (p.Decision.OptionID == "") == (strings.TrimSpace(p.Decision.Text) == "") {
			return nil, fmt.Errorf("provide one option ID or answer text")
		}
		if p.Decision.OptionID != "" {
			found := false
			for _, o := range m.Human.Options {
				found = found || o.ID == p.Decision.OptionID
			}
			if !found {
				return nil, fmt.Errorf("unknown decision option")
			}
		}
		for _, a := range h.state.Answers {
			if a.MessageID == m.ID && a.Human.ID == p.HumanID && a.State != "rejected" {
				return nil, fmt.Errorf("this question already has a recorded answer")
			}
		}
		if len(h.state.Answers) >= 20000 {
			return nil, fmt.Errorf("answer storage capacity reached")
		}
		if h.state.Answers == nil {
			h.state.Answers = map[string]Answer{}
		}
		a := Answer{ID: id, MessageID: m.ID, SenderID: d.ID, RequestID: p.RequestID, Human: *m.Human, Decision: p.Decision, State: "pending"}
		h.state.Answers[id] = a
		h.emit("answer", id, a.State)
		return a, nil
	case "/v1/answers":
		var p struct {
			SessionID string `json:"session_id"`
			ID        string `json:"id"`
		}
		if err := decode(body, &p); err != nil {
			return nil, err
		}
		if p.ID != "" {
			a, ok := h.state.Answers[p.ID]
			if !ok || !h.canDecide(d, h.state.Messages[a.MessageID]) {
				return nil, fmt.Errorf("answer unavailable")
			}
			return a, nil
		}
		if h.state.Sessions[p.SessionID].DeviceID != d.ID {
			return nil, fmt.Errorf("execution owner required")
		}
		rows := []Answer{}
		for _, a := range h.state.Answers {
			if a.State == "pending" && h.state.Messages[a.MessageID].SessionID == p.SessionID {
				rows = append(rows, a)
			}
		}
		sort.Slice(rows, func(i, j int) bool { return rows[i].ID < rows[j].ID })
		return rows, nil
	case "/v1/answer-receipt":
		var p struct {
			ID    string `json:"id"`
			State string `json:"state"`
			Error string `json:"error"`
		}
		if err := decode(body, &p); err != nil {
			return nil, err
		}
		a, ok := h.state.Answers[p.ID]
		if !ok || h.state.Sessions[h.state.Messages[a.MessageID].SessionID].DeviceID != d.ID {
			return nil, fmt.Errorf("execution owner required")
		}
		if (p.State != "applied" && p.State != "rejected") || len(p.Error) > 8000 {
			return nil, fmt.Errorf("invalid answer receipt")
		}
		if a.State != "pending" {
			if a.State != p.State || a.Error != p.Error {
				return nil, fmt.Errorf("answer receipt is immutable")
			}
			return a, nil
		}
		a.State, a.Error = p.State, p.Error
		h.state.Answers[a.ID] = a
		h.emit("answer", a.ID, a.State)
		return a, nil
	}
	return nil, fmt.Errorf("unknown decision endpoint")
}

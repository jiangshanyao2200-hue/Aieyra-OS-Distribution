// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: HumanManual; errHumanWaiting; humanIDPattern; HumanOption; HumanInput; HumanQuestion; HumanDecision; HumanReply; HumanRequest; humanBoundaryKey; humanHash; decodeHuman; cloneHuman; humanOpen; humanState; requestHuman; hasPreparedHuman; pauseHumanLocked; advanceHumanLocked; finishHumansLocked; expireHumanLocked; cancelJobLocked; Humans; HumanStatus; ReplyHuman; callHuman
// Impact: python -B scripts/code-atlas.py show Core/matrix_human.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"regexp"
	"sort"
	"strings"
	"time"
)

func HumanManual() string { return runtimePrompt("Matrix/工具说明/人工决策.txt") }

var errHumanWaiting = errors.New("human decision pending")
var humanIDPattern = regexp.MustCompile(`^[A-Za-z0-9_.:-]{1,128}$`)

type HumanOption struct {
	ID     string `json:"id"`
	Label  string `json:"label"`
	Impact string `json:"impact"`
}
type HumanInput struct {
	Required bool `json:"required"`
}
type HumanQuestion struct {
	Action           string        `json:"action"`
	RequestID        string        `json:"request_id"`
	Category         string        `json:"category"`
	Question         string        `json:"question"`
	Recommendation   string        `json:"recommendation"`
	Facts            string        `json:"facts,omitempty"`
	Impact           string        `json:"impact"`
	ResumeSummary    string        `json:"resume_summary"`
	Options          []HumanOption `json:"options"`
	InputSchema      HumanInput    `json:"input_schema"`
	ExpiresInSeconds int           `json:"expires_in_seconds,omitempty"`
}
type HumanDecision struct {
	OptionID string `json:"option_id,omitempty"`
	Text     string `json:"text,omitempty"`
}
type HumanReply struct {
	RequestID              string        `json:"request_id"`
	SessionID              string        `json:"session_id"`
	AgentID                string        `json:"agent_id"`
	Generation             int           `json:"generation"`
	HumanID                string        `json:"human_id"`
	ExpectedRequestVersion int           `json:"expected_request_version"`
	RequestTokenSHA256     string        `json:"request_token_sha256"`
	Decision               HumanDecision `json:"decision"`
}

// The request version and binding are immutable. State changes do not create a
// new decision target. Cloud projection versions are owned by the center.
type HumanRequest struct {
	HumanQuestion
	ID                 string         `json:"id"`
	Version            int            `json:"version"`
	SessionID          string         `json:"session_id"`
	AgentID            string         `json:"agent_id"`
	Generation         int            `json:"generation"`
	OriginRequest      string         `json:"origin_request,omitempty"`
	RequestTokenSHA256 string         `json:"request_token_sha256"`
	State              string         `json:"state"`
	CreatedAt          string         `json:"created_at"`
	UpdatedAt          string         `json:"updated_at"`
	ExpiresAt          string         `json:"expires_at"`
	DecisionID         string         `json:"decision_id,omitempty"`
	Decision           *HumanDecision `json:"decision,omitempty"`
	ReplySHA256        string         `json:"reply_sha256,omitempty"`
	Error              string         `json:"error,omitempty"`
}
type humanBoundaryKey struct{}

func humanHash(v any) string {
	b, _ := json.Marshal(v)
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}
func decodeHuman(data json.RawMessage, value any) error {
	d := json.NewDecoder(bytes.NewReader(data))
	d.DisallowUnknownFields()
	if d.Decode(value) != nil || d.Decode(new(any)) != io.EOF {
		return fmt.Errorf("invalid_human_arguments")
	}
	return nil
}
func cloneHuman(h HumanRequest) HumanRequest {
	b, _ := json.Marshal(h)
	var result HumanRequest
	_ = json.Unmarshal(b, &result)
	return result
}
func humanOpen(state string) bool {
	switch state {
	case "preparing", "waiting_user", "decision_recorded", "delivered_to_agent", "resuming":
		return true
	}
	return false
}
func humanState(h *HumanRequest, state, reason string) {
	h.State, h.Error, h.UpdatedAt = state, reason, time.Now().UTC().Format(time.RFC3339Nano)
}

func (m *AgentManager) requestHuman(ctx context.Context, owner string, data json.RawMessage) (HumanRequest, error) {
	var p HumanQuestion
	if err := decodeHuman(data, &p); err != nil {
		return HumanRequest{}, err
	}
	if p.Action != "request" || !humanIDPattern.MatchString(p.RequestID) {
		return HumanRequest{}, fmt.Errorf("invalid_human_request")
	}
	if p.Category != "information" && p.Category != "direction" && p.Category != "authorization" && p.Category != "environment" {
		return HumanRequest{}, fmt.Errorf("invalid_human_category")
	}
	for _, value := range []string{p.Question, p.Recommendation, p.Impact, p.ResumeSummary} {
		if strings.TrimSpace(value) == "" || len(value) > 8000 {
			return HumanRequest{}, fmt.Errorf("human_question_context_required_or_too_long")
		}
	}
	if len(p.Facts) > 8000 || len(p.Options) > 8 {
		return HumanRequest{}, fmt.Errorf("human_input_limit")
	}
	seen := map[string]bool{}
	for _, o := range p.Options {
		if !humanIDPattern.MatchString(o.ID) || seen[o.ID] || strings.TrimSpace(o.Label) == "" || len(o.Label) > 300 || strings.TrimSpace(o.Impact) == "" || len(o.Impact) > 2000 {
			return HumanRequest{}, fmt.Errorf("invalid_human_option")
		}
		seen[o.ID] = true
	}
	if len(p.Options) == 0 {
		p.InputSchema.Required = true
	}
	if p.ExpiresInSeconds == 0 {
		p.ExpiresInSeconds = 86400
	}
	if p.ExpiresInSeconds < 60 || p.ExpiresInSeconds > 604800 {
		return HumanRequest{}, fmt.Errorf("invalid_human_expiry")
	}
	if b, _ := json.Marshal(p); m.redact(string(b)) != string(b) {
		return HumanRequest{}, fmt.Errorf("credential_in_human_request")
	}
	if valid, _ := ctx.Value(humanBoundaryKey{}).(bool); !valid {
		return HumanRequest{}, fmt.Errorf("human_request_requires_single_top_level_tool_call")
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	j := m.jobs[owner]
	if j == nil || !m.ownsLocked(m.owner, owner) {
		return HumanRequest{}, fmt.Errorf("human_request_requires_assigned_specialist")
	}
	for _, h := range j.record.HumanRequests {
		if h.Generation == j.record.Generation && h.RequestID == p.RequestID {
			if humanHash(h.HumanQuestion) != humanHash(p) {
				return HumanRequest{}, fmt.Errorf("human_request_id_conflict")
			}
			return cloneHuman(h), nil
		}
	}
	if j.record.State != "running" || ctx.Err() != nil || m.ctx.Err() != nil {
		return HumanRequest{}, fmt.Errorf("human_agent_not_running")
	}
	for _, h := range j.record.HumanRequests {
		if h.State == "preparing" || h.State == "waiting_user" || h.State == "decision_recorded" {
			return HumanRequest{}, fmt.Errorf("human_request_already_pending")
		}
	}
	if j.shell != nil {
		for _, s := range j.shell.Snapshots() {
			if s.Pending() && !s.Background {
				return HumanRequest{}, fmt.Errorf("human_wait_requires_finished_shell")
			}
		}
		for _, c := range j.shell.ExecutionSnapshots() {
			if c.State == "running" {
				return HumanRequest{}, fmt.Errorf("human_wait_requires_finished_cells")
			}
		}
	}
	for id, child := range m.jobs {
		if m.ownsLocked(owner, id) && activeAgent(child.record.State) {
			return HumanRequest{}, fmt.Errorf("human_wait_requires_finished_children")
		}
	}
	var random [32]byte
	if _, err := rand.Read(random[:]); err != nil {
		return HumanRequest{}, err
	}
	now := time.Now().UTC()
	h := HumanRequest{HumanQuestion: p, ID: "human-" + humanHash([]any{m.owner, owner, j.record.Generation, p.RequestID})[:32], Version: 1, SessionID: m.owner, AgentID: owner, Generation: j.record.Generation, OriginRequest: j.record.OriginRequest, RequestTokenSHA256: humanHash(random), State: "preparing", CreatedAt: now.Format(time.RFC3339Nano), UpdatedAt: now.Format(time.RFC3339Nano), ExpiresAt: now.Add(time.Duration(p.ExpiresInSeconds) * time.Second).Format(time.RFC3339Nano)}
	j.record.HumanRequests = append(j.record.HumanRequests, h)
	if err := m.saveLocked(j); err != nil {
		j.record.HumanRequests = j.record.HumanRequests[:len(j.record.HumanRequests)-1]
		return HumanRequest{}, err
	}
	return cloneHuman(h), nil
}

// Called only after the complete tool_turn archive entry has been committed.
func (m *AgentManager) hasPreparedHuman(j *agentJob) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, h := range j.record.HumanRequests {
		if h.Generation == j.record.Generation && h.State == "preparing" {
			return true
		}
	}
	return false
}
func (m *AgentManager) pauseHumanLocked(j *agentJob) error {
	for i := range j.record.HumanRequests {
		h := &j.record.HumanRequests[i]
		if h.Generation == j.record.Generation && h.State == "preparing" {
			humanState(h, "waiting_user", "")
		}
	}
	j.record.State = "waiting_user"
	return m.saveLocked(j)
}
func (m *AgentManager) advanceHumanLocked(j *agentJob, from, to string) {
	for i := range j.record.HumanRequests {
		h := &j.record.HumanRequests[i]
		if h.Generation == j.record.Generation && h.State == from {
			humanState(h, to, "")
		}
	}
}
func (m *AgentManager) finishHumansLocked(j *agentJob, state string) {
	for i := range j.record.HumanRequests {
		h := &j.record.HumanRequests[i]
		if h.Generation != j.record.Generation || !humanOpen(h.State) {
			continue
		}
		terminal := "failed"
		if state == "completed" && (h.State == "resuming" || h.State == "delivered_to_agent") {
			terminal = "resolved"
		}
		if state == "cancelled" {
			terminal = "cancelled"
		}
		if state == "interrupted" {
			terminal = "unknown"
		}
		humanState(h, terminal, "")
	}
}
func (m *AgentManager) expireHumanLocked(j *agentJob) error {
	changed := false
	for i := range j.record.HumanRequests {
		h := &j.record.HumanRequests[i]
		expiry, err := time.Parse(time.RFC3339Nano, h.ExpiresAt)
		if h.State == "waiting_user" && (err != nil || !time.Now().Before(expiry)) {
			humanState(h, "expired", "no decision before expiry; no consent")
			if j.record.Generation == h.Generation && j.record.State == "waiting_user" {
				if j.shell != nil {
					j.shell.CancelAll()
				}
				j.record.State, j.record.Error = "timed_out", "Human request expired; no decision was executed."
				j.record.CompletedAt = time.Now().UTC().Format(time.RFC3339Nano)
			}
			changed = true
		}
	}
	if changed {
		return m.saveLocked(j)
	}
	return nil
}

func (m *AgentManager) cancelJobLocked(j *agentJob) error {
	m.cancelWorkflowRunsLocked(j.record.ID)
	if j.shell != nil {
		j.shell.CancelAll()
	}
	if j.record.State == "waiting_user" {
		j.record.State = "cancelled"
		j.record.CompletedAt = time.Now().UTC().Format(time.RFC3339Nano)
		m.finishHumansLocked(j, "cancelled")
	} else {
		j.record.State = "cancelling"
		if j.cancel != nil {
			j.cancel()
		}
	}
	return m.saveLocked(j)
}

func (m *AgentManager) Humans(owner string) ([]HumanRequest, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := []HumanRequest{}
	for id, j := range m.jobs {
		if !m.ownsLocked(owner, id) {
			continue
		}
		if err := m.expireHumanLocked(j); err != nil {
			return nil, err
		}
		for _, h := range j.record.HumanRequests {
			out = append(out, cloneHuman(h))
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt < out[j].CreatedAt })
	return out, nil
}
func (m *AgentManager) HumanStatus(owner, id string) (HumanRequest, error) {
	all, err := m.Humans(owner)
	if err != nil {
		return HumanRequest{}, err
	}
	for _, h := range all {
		if h.ID == id {
			return h, nil
		}
	}
	return HumanRequest{}, fmt.Errorf("human_request_not_found")
}
func (m *AgentManager) ReplyHuman(owner string, p HumanReply) (HumanRequest, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if owner != m.owner || p.SessionID != m.owner || !m.ownsLocked(owner, p.AgentID) {
		return HumanRequest{}, fmt.Errorf("human_origin_mismatch")
	}
	if !humanIDPattern.MatchString(p.RequestID) {
		return HumanRequest{}, fmt.Errorf("invalid_human_decision_id")
	}
	j := m.jobs[p.AgentID]
	if err := m.expireHumanLocked(j); err != nil {
		return HumanRequest{}, err
	}
	var h *HumanRequest
	for i := range j.record.HumanRequests {
		if j.record.HumanRequests[i].ID == p.HumanID {
			h = &j.record.HumanRequests[i]
			break
		}
	}
	if h == nil || h.Generation != p.Generation || h.Version != p.ExpectedRequestVersion || h.RequestTokenSHA256 != p.RequestTokenSHA256 {
		return HumanRequest{}, fmt.Errorf("human_binding_mismatch")
	}
	if h.DecisionID != "" {
		if h.DecisionID == p.RequestID && h.ReplySHA256 == humanHash(p) {
			return cloneHuman(*h), nil
		}
		return HumanRequest{}, fmt.Errorf("human_decision_conflict")
	}
	// Decision IDs are unique across all requests in this session.
	for _, other := range m.jobs {
		for _, old := range other.record.HumanRequests {
			if old.DecisionID == p.RequestID {
				return HumanRequest{}, fmt.Errorf("human_decision_id_conflict")
			}
		}
	}
	if h.State != "waiting_user" || j.record.State != "waiting_user" || j.record.Generation != p.Generation || m.ctx.Err() != nil {
		return HumanRequest{}, fmt.Errorf("human_request_not_waiting")
	}
	select {
	case <-j.done:
	default:
		return HumanRequest{}, fmt.Errorf("human_pause_not_committed")
	}
	// A free answer is an explicit decision for this same immutable question.
	// An unlisted nonempty option still fails; origin/version/token validation
	// above remains identical for choices and free text.
	validOption := p.Decision.OptionID == "" && (len(h.Options) == 0 || strings.TrimSpace(p.Decision.Text) != "")
	for _, o := range h.Options {
		if o.ID == p.Decision.OptionID {
			validOption = true
		}
	}
	if !validOption || len(p.Decision.Text) > 8000 || (h.InputSchema.Required && strings.TrimSpace(p.Decision.Text) == "") {
		return HumanRequest{}, fmt.Errorf("invalid_human_decision")
	}
	if b, _ := json.Marshal(p.Decision); m.redact(string(b)) != string(b) {
		return HumanRequest{}, fmt.Errorf("credential_in_human_decision")
	}
	previous := copyRecord(j.record)
	h.DecisionID, h.ReplySHA256 = p.RequestID, humanHash(p)
	d := p.Decision
	h.Decision = &d
	humanState(h, "decision_recorded", "")
	j.record.State = "queued"
	if err := m.saveLocked(j); err != nil {
		j.record = previous
		return HumanRequest{}, err
	}
	result := cloneHuman(*h)
	message, _ := json.Marshal(map[string]any{"human_request_id": h.ID, "decision_id": p.RequestID, "question": h.Question, "decision": d, "scope": h.Impact, "resume_summary": h.ResumeSummary})
	j.done = make(chan struct{})
	m.launchLocked(j, "Human decision for this task (limited to the recorded question):\n"+string(message), true)
	return result, nil
}

// Exposed only by the authenticated host RPC; never by model toolbox.call.
func (m *AgentManager) callHuman(action string, data json.RawMessage) (any, error) {
	switch action {
	case "humans.list":
		var p struct{}
		if err := decodeHuman(data, &p); err != nil {
			return nil, err
		}
		return m.Humans(m.owner)
	case "humans.status":
		var p struct {
			ID string `json:"id"`
		}
		if err := decodeHuman(data, &p); err != nil {
			return nil, err
		}
		return m.HumanStatus(m.owner, p.ID)
	case "humans.reply":
		var p HumanReply
		if err := decodeHuman(data, &p); err != nil {
			return nil, err
		}
		return m.ReplyHuman(m.owner, p)
	}
	return nil, fmt.Errorf("unknown_human_action")
}

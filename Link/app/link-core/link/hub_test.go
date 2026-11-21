// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Link/app/link-core/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: hubFixture; fixtureHub; pairDevice; mustCall; TestPairProofTamperReplayRestartAndRevoke; TestMessageDurabilityDedupOwnerAndIncrementalEvents
// Impact: python -B scripts/code-atlas.py show Link/app/link-core/link/hub_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package link

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync"
	"testing"
)

type hubFixture struct {
	directory           string
	hub                 *Hub
	server              *httptest.Server
	owner               *Client
	mu                  sync.Mutex
	failReceipts        bool
	failAnswers         bool
	failControlReceipts bool
}

func fixtureHub(t *testing.T) *hubFixture {
	t.Helper()
	f := &hubFixture{directory: t.TempDir()}
	f.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if f.failReceipts && r.URL.Path == "/v1/receipt" || f.failAnswers && r.URL.Path == "/v1/answer-receipt" || f.failControlReceipts && r.URL.Path == "/v1/control/receipt" {
			http.Error(w, "temporary", 503)
			return
		}
		f.hub.ServeHTTP(w, r)
	}))
	i, e := InitHub(f.directory, f.server.URL, "owner")
	if e != nil {
		t.Fatal(e)
	}
	f.hub, e = OpenHub(f.directory)
	if e != nil {
		t.Fatal(e)
	}
	f.owner, e = NewClient(i)
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { f.server.Close(); f.hub.Close() })
	return f
}
func pairDevice(t *testing.T, f *hubFixture, name string) *Client {
	t.Helper()
	var result struct{ Invite string }
	if e := f.owner.Call(context.Background(), "/v1/invites", nil, &result); e != nil {
		t.Fatal(e)
	}
	identity, e := Pair(context.Background(), filepath.Join(t.TempDir(), "device.json"), f.server.URL, name, result.Invite)
	if e != nil {
		t.Fatal(e)
	}
	c, e := NewClient(identity)
	if e != nil {
		t.Fatal(e)
	}
	return c
}
func mustCall(t *testing.T, c *Client, path string, args, target any) {
	t.Helper()
	if e := c.Call(context.Background(), path, args, target); e != nil {
		t.Fatal(path, e)
	}
}

func TestPairProofTamperReplayRestartAndRevoke(t *testing.T) {
	f := fixtureHub(t)
	c := pairDevice(t, f, "desktop")
	if _, e := OpenHub(f.directory); e == nil {
		t.Fatal("second hub writer accepted")
	}
	mustCall(t, c, "/v1/catalog", nil, nil)
	if e := c.Call(context.Background(), "/v1/invites", nil, nil); e == nil {
		t.Fatal("non-owner created invitation")
	}
	r, e := c.request(context.Background(), "/v1/catalog", map[string]any{})
	if e != nil {
		t.Fatal(e)
	}
	response, e := c.HTTP.Do(r)
	if e != nil {
		t.Fatal(e)
	}
	io.Copy(io.Discard, response.Body)
	response.Body.Close()
	if response.StatusCode != 200 {
		t.Fatal(response.StatusCode)
	}
	// 完全重放签名，包括服务重启后，均须拒绝。
	f.mu.Lock()
	f.hub.Close()
	f.hub, e = OpenHub(f.directory)
	f.mu.Unlock()
	if e != nil {
		t.Fatal(e)
	}
	r.Body = io.NopCloser(bytes.NewReader([]byte("{}")))
	response, e = c.HTTP.Do(r)
	if e != nil {
		t.Fatal(e)
	}
	response.Body.Close()
	if response.StatusCode != 401 {
		t.Fatal("proof replay accepted", response.StatusCode)
	}
	r, e = c.request(context.Background(), "/v1/catalog", map[string]any{})
	if e != nil {
		t.Fatal(e)
	}
	r.Body = io.NopCloser(bytes.NewReader([]byte("{\"x\":1}")))
	r.ContentLength = 7
	response, e = c.HTTP.Do(r)
	if e != nil {
		t.Fatal(e)
	}
	response.Body.Close()
	if response.StatusCode != 401 {
		t.Fatal("tampered payload accepted")
	}
	mustCall(t, f.owner, "/v1/revoke", map[string]string{"device_id": c.Identity.ID}, nil)
	if e = c.Call(context.Background(), "/v1/catalog", nil, nil); e == nil {
		t.Fatal("revoked device read state")
	}
}

func TestMessageDurabilityDedupOwnerAndIncrementalEvents(t *testing.T) {
	f := fixtureHub(t)
	executor := pairDevice(t, f, "cloud")
	other := pairDevice(t, f, "desktop")
	var session Session
	mustCall(t, executor, "/v1/attach", map[string]string{"local_id": "synthetic-session", "title": "Synthetic workspace"}, &session)
	var first Message
	args := map[string]string{"session_id": session.ID, "request_id": "message-once", "text": "Run one task"}
	mustCall(t, other, "/v1/send", args, &first)
	var duplicate Message
	mustCall(t, other, "/v1/send", args, &duplicate)
	if first.ID != duplicate.ID || first.State != "received" || first.CoreRequestID == "" {
		t.Fatal(first, duplicate)
	}
	args["text"] = "different task"
	if e := other.Call(context.Background(), "/v1/send", args, nil); e == nil {
		t.Fatal("conflicting retry accepted")
	}
	if e := other.Call(context.Background(), "/v1/receipt", map[string]string{"id": first.ID, "state": "completed"}, nil); e == nil {
		t.Fatal("other device claimed execution")
	}
	var before struct{ Cursor uint64 }
	mustCall(t, other, "/v1/catalog", nil, &before)
	f.mu.Lock()
	f.hub.Close()
	var e error
	f.hub, e = OpenHub(f.directory)
	f.mu.Unlock()
	if e != nil {
		t.Fatal(e)
	}
	var pending []Message
	mustCall(t, executor, "/v1/messages", map[string]any{"session_id": session.ID, "pending": true}, &pending)
	if len(pending) != 1 || pending[0].ID != first.ID {
		t.Fatal("pending message lost", pending)
	}
	mustCall(t, executor, "/v1/receipt", map[string]string{"id": first.ID, "state": "accepted"}, nil)
	mustCall(t, executor, "/v1/receipt", map[string]string{"id": first.ID, "state": "completed", "reply": "saved"}, nil)
	var events struct {
		Events []Event
		Next   uint64 `json:"next_cursor"`
	}
	mustCall(t, other, "/v1/events", map[string]uint64{"after": before.Cursor}, &events)
	if len(events.Events) != 2 || events.Events[0].State != "accepted" || events.Events[1].State != "completed" {
		t.Fatal(events)
	}
	var empty struct{ Events []Event }
	mustCall(t, other, "/v1/events", map[string]uint64{"after": events.Next}, &empty)
	if len(empty.Events) != 0 {
		t.Fatal("cursor repeated events")
	}
	mustCall(t, executor, "/v1/receipt", map[string]string{"id": first.ID, "state": "completed", "reply": "saved"}, nil)
	if e = executor.Call(context.Background(), "/v1/receipt", map[string]string{"id": first.ID, "state": "running"}, nil); e == nil {
		t.Fatal("terminal receipt rewound")
	}
	encoded, _ := json.Marshal(events)
	if bytes.Contains(encoded, []byte("Run one task")) {
		t.Fatal("event metadata contains message content")
	}
}

// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Link/app/link-core/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: autoHostFixture; TestAutoLANProofReplayRevokeAndPersistenceRollback; TestAutoLANRejectsBrowserPublicSourceAndWorkerEscalation; TestAutoLANEnrollmentResponseLossAndTLSPin
// Impact: python -B scripts/code-atlas.py show Link/app/link-core/link/lan_auto_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package link

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func autoHostFixture(t *testing.T) (*LANHost, *Client, Device) {
	t.Helper()
	f := fixtureHub(t)
	s := &LANHost{Hub: f.hub, Owner: f.owner.Identity, Directory: f.directory, Project: "demo", seen: map[string]time.Time{}, HTTP: &http.Client{Timeout: time.Second}}
	server := httptest.NewServer(s)
	t.Cleanup(server.Close)
	i, d, e := newIdentity(server.URL, "Phone")
	if e != nil {
		t.Fatal(e)
	}
	c, e := NewClient(i)
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(c.HTTP.CloseIdleConnections)
	return s, c, d
}

func TestAutoLANProofReplayRevokeAndPersistenceRollback(t *testing.T) {
	s, c, d := autoHostFixture(t)
	mustCall(t, c, "/v1/lan/pair", map[string]Device{"device": d}, nil)
	r, _ := c.request(context.Background(), "/v1/lan/ping", nil)
	body, _ := io.ReadAll(r.Body)
	r.Body = io.NopCloser(bytes.NewReader(body))
	res, e := c.HTTP.Do(r)
	if e != nil {
		t.Fatal(e)
	}
	res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatal(res.StatusCode)
	}
	// An accepted nonce survives reopening the host, not just its current process.
	s.Hub.Close()
	s.Hub, e = OpenHub(s.Directory)
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { s.Hub.Close() })
	r.Body = io.NopCloser(bytes.NewReader(body))
	res, e = c.HTTP.Do(r)
	if e != nil {
		t.Fatal(e)
	}
	res.Body.Close()
	if res.StatusCode != 403 {
		t.Fatal("replayed proof accepted", res.StatusCode)
	}
	before, _ := json.Marshal(s.Hub.state)
	path := s.Hub.path
	s.Hub.path = t.TempDir() // Atomic replacement of a directory must fail.
	if c.Call(context.Background(), "/v1/lan/ping", nil, nil) == nil {
		t.Fatal("failed persistence accepted")
	}
	s.Hub.path = path
	after, _ := json.Marshal(s.Hub.state)
	if !bytes.Equal(before, after) {
		t.Fatal("failed write mutated nonce ledger")
	}
	d.Revoked = true
	s.Hub.state.Devices[d.ID] = d
	d.Revoked = false
	if c.Call(context.Background(), "/v1/lan/pair", map[string]Device{"device": d}, nil) == nil {
		t.Fatal("pairing revived revoked identity")
	}
}

func TestAutoLANRejectsBrowserPublicSourceAndWorkerEscalation(t *testing.T) {
	s, c, d := autoHostFixture(t)
	for _, test := range []struct{ remote, origin string }{{"203.0.113.8:2345", ""}, {"127.0.0.1:2345", "http://localhost"}} {
		r, _ := c.request(context.Background(), "/v1/lan/pair", map[string]Device{"device": d})
		r.RemoteAddr = test.remote
		if test.origin != "" {
			r.Header.Set("Origin", test.origin)
		}
		w := httptest.NewRecorder()
		s.ServeHTTP(w, r)
		if w.Code != 403 {
			t.Fatal("non-native/public request accepted", w.Code)
		}
	}
	mustCall(t, c, "/v1/lan/pair", map[string]Device{"device": d}, nil)
	token := base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{7}, 32))
	if e := writeJSON(filepath.Join(s.Directory, "lan-enrollments", d.ID+".json"), LANEnrollment{hash([]byte(token)), "demo", d.Name}); e != nil {
		t.Fatal(e)
	}
	for _, request := range []ControlRequest{
		{Method: "GET", Path: "/api/config", Token: token},
		{Method: "POST", Path: "/api/agent-access/enroll", Token: token, Body: json.RawMessage(`{}`)},
		{Method: "GET", Path: "/api/agent/v1/seats", Token: strings.Repeat("x", 43)},
	} {
		if c.Call(context.Background(), "/v1/lan/agent", request, nil) == nil {
			t.Fatal("worker route/credential escalation accepted")
		}
	}
	var calls atomic.Int32
	local := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"ok":true}`))
	}))
	defer local.Close()
	s.ControlURL = local.URL
	var response ControlResponse
	mustCall(t, c, "/v1/lan/agent", ControlRequest{Method: "GET", Path: "/api/agent/v1/seats", Token: token, Deadline: time.Now().Unix() - 1}, &response)
	if response.Status != 408 || calls.Load() != 0 {
		t.Fatal("expired write reached office")
	}
	mustCall(t, c, "/v1/lan/agent", ControlRequest{Method: "GET", Path: "/api/agent/v1/seats", Token: token, Deadline: time.Now().Add(10 * time.Second).Unix()}, &response)
	if response.Status != 200 || calls.Load() != 1 {
		t.Fatal("valid worker request not forwarded exactly once")
	}
}

func TestAutoLANEnrollmentResponseLossAndTLSPin(t *testing.T) {
	interfaces, _ := net.Interfaces()
	private := ""
	for _, iface := range interfaces {
		if iface.Flags&net.FlagUp == 0 {
			continue
		}
		addresses, _ := iface.Addrs()
		for _, a := range addresses {
			ip, _, e := net.ParseCIDR(a.String())
			if e == nil && ip.To4() != nil && ip.IsPrivate() {
				private = ip.String()
				break
			}
		}
		if private != "" {
			break
		}
	}
	if private == "" {
		t.Skip("requires a private LAN interface")
	}
	dir := t.TempDir()
	l, e := net.Listen("tcp4", net.JoinHostPort(private, "0"))
	if e != nil {
		t.Fatal(e)
	}
	endpoint := "https://" + l.Addr().String()
	i, e := InitHub(dir, endpoint, "Office")
	if e != nil {
		t.Fatal(e)
	}
	cert, key, pin, e := prepareTLS(dir, endpoint)
	if e != nil {
		t.Fatal(e)
	}
	i.TLSFingerprint = pin
	h, e := OpenHub(dir)
	if e != nil {
		t.Fatal(e)
	}
	defer h.Close()
	var enrollments atomic.Int32
	var firstID, firstToken string
	local := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/api/session" {
			w.Write([]byte(`{"csrf":"` + strings.Repeat("a", 64) + `"}`))
			return
		}
		var value map[string]string
		json.NewDecoder(r.Body).Decode(&value)
		if enrollments.Add(1) == 1 {
			firstID, firstToken = value["request_id"], value["token"]
			// Control commits, but its response is lost. Retry must preserve intent.
			conn, _, _ := w.(http.Hijacker).Hijack()
			conn.Close()
			return
		}
		if value["request_id"] != firstID || value["token"] != firstToken {
			t.Error("retry created another identity")
		}
		w.Write([]byte(`{"state":"ready","credential":{"actor_id":"fixture-worker"}}`))
	}))
	defer local.Close()
	s := &LANHost{Hub: h, Owner: i, Directory: dir, Project: "demo", ControlURL: local.URL, seen: map[string]time.Time{}, HTTP: &http.Client{Timeout: time.Second}}
	server := &http.Server{Handler: s}
	go server.ServeTLS(l, cert, key)
	defer server.Close()
	candidate := LANCandidate{HostID: i.ID, URL: endpoint, Pin: pin, Name: "Office"}
	clientDir := t.TempDir()
	peer, e := connectLAN(context.Background(), clientDir, "Phone", candidate)
	if e == nil || peer.Enrolled {
		t.Fatal("lost enrollment receipt treated as ready")
	}
	again, e := connectLAN(context.Background(), clientDir, "Phone", candidate)
	if e != nil || !again.Enrolled || again.Identity.ID != peer.Identity.ID || again.Token != peer.Token {
		t.Fatal("retry failed to retain device", e)
	}
	if enrollments.Load() != 2 {
		t.Fatal("unexpected automatic enrollment retries")
	}
	raw, _ := os.ReadFile(filepath.Join(clientDir, "peers", i.ID, "peer.json"))
	candidate.Pin = strings.Repeat("0", 64)
	if _, e = connectLAN(context.Background(), clientDir, "Phone", candidate); e == nil {
		t.Fatal("changed TLS pin accepted")
	}
	retained, _ := os.ReadFile(filepath.Join(clientDir, "peers", i.ID, "peer.json"))
	if !bytes.Equal(raw, retained) {
		t.Fatal("TLS pin failure replaced identity")
	}
}

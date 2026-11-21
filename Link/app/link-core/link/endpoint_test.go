// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Link/app/link-core/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: recoveryHub; recoveryFixture; listen; TestEndpointRecoveryRetainsIdentityTasksAndJournals; TestEndpointRecoveryRejectsForgeryRevocationAndMissingTrust; TestSavedEndpointRejectsTamperAndAcceptsRetainedUppercasePin
// Impact: python -B scripts/code-atlas.py show Link/app/link-core/link/endpoint_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package link

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

type recoveryHub struct {
	hub      *Hub
	owner    *Client
	identity Identity
	path     string
	cert     tls.Certificate
	mu       sync.Mutex
	requests []string
}

func recoveryFixture(t *testing.T) (*recoveryHub, *httptest.Server) {
	t.Helper()
	f := &recoveryHub{}
	dir := t.TempDir()
	cert, key, pin, err := prepareTLS(dir, "https://127.0.0.1")
	if err != nil {
		t.Fatal(err)
	}
	f.cert, err = tls.LoadX509KeyPair(cert, key)
	if err != nil {
		t.Fatal(err)
	}
	server := f.listen(t)
	i, err := InitHub(dir, server.URL, "Owner")
	if err != nil {
		t.Fatal(err)
	}
	i.TLSFingerprint = pin
	f.hub, err = OpenHub(dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { f.hub.Close() })
	f.owner, err = NewClient(i)
	if err != nil {
		t.Fatal(err)
	}
	var invite struct {
		Invite  string
		Expires int64 `json:"expires_unix"`
	}
	mustCall(t, f.owner, "/v1/invites", nil, &invite)
	f.path = filepath.Join(t.TempDir(), "device.json")
	f.identity, err = PairCode(context.Background(), f.path, "Original device", encodeCode(i, invite.Invite, invite.Expires))
	if err != nil {
		t.Fatal(err)
	}
	return f, server
}

func (f *recoveryHub) listen(t *testing.T) *httptest.Server {
	t.Helper()
	server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		f.requests = append(f.requests, r.URL.Path)
		f.hub.ServeHTTP(w, r)
	}))
	server.TLS = &tls.Config{Certificates: []tls.Certificate{f.cert}, MinVersion: tls.VersionTLS12}
	server.StartTLS()
	t.Cleanup(server.Close)
	return server
}

func TestEndpointRecoveryRetainsIdentityTasksAndJournals(t *testing.T) {
	f, old := recoveryFixture(t)
	c, _ := NewClient(f.identity)
	var session Session
	mustCall(t, c, "/v1/attach", map[string]string{"local_id": "original", "title": "Original session"}, &session)
	var message Message
	mustCall(t, f.owner, "/v1/send", map[string]string{"session_id": session.ID, "request_id": "original-request", "text": "Already received"}, &message)
	mustCall(t, f.owner, "/v1/cancel", map[string]string{"id": message.ID}, nil)
	before, _ := os.ReadFile(f.path)
	journal := filepath.Join(filepath.Dir(f.path), "original-journal.json")
	raw := []byte(`{"state":"unknown","request_id":"original-request","replay_allowed":false}`)
	if err := os.WriteFile(journal, raw, 0600); err != nil {
		t.Fatal(err)
	}
	tasks, _ := json.Marshal(f.hub.state.Messages)
	next := f.listen(t)
	old.Close()
	f.mu.Lock()
	f.requests = nil
	f.mu.Unlock()
	result, err := RecoverEndpoint(context.Background(), f.path, next.URL)
	if err != nil || !result.Verified || !result.IdentityRetained || result.ReplayAllowed || result.URL != next.URL || result.DeviceID != f.identity.ID {
		t.Fatalf("%+v %v", result, err)
	}
	after, _ := os.ReadFile(f.path)
	journalAfter, _ := os.ReadFile(journal)
	tasksAfter, _ := json.Marshal(f.hub.state.Messages)
	if !bytes.Equal(before, after) || !bytes.Equal(raw, journalAfter) || !bytes.Equal(tasks, tasksAfter) {
		t.Fatal("identity, task or journal rewritten")
	}
	if len(f.requests) != 1 || f.requests[0] != "/v1/catalog" {
		t.Fatal("recovery replayed a task", f.requests)
	}
	effective, err := LoadConnectionIdentity(f.path)
	if err != nil || effective.URL != next.URL || effective.PrivateKey != f.identity.PrivateKey || effective.ID != f.identity.ID {
		t.Fatal("endpoint did not preserve original identity", err)
	}
	trust, err := pairedTrust(f.path)
	if err != nil || trust["pinned"] != true || trust["hub_url"] != next.URL || len(trust) != 4 {
		t.Fatal("invalid public trust", err)
	}
}

func TestEndpointRecoveryRejectsForgeryRevocationAndMissingTrust(t *testing.T) {
	f, original := recoveryFixture(t)
	cert, key, _, err := prepareTLS(t.TempDir(), "https://127.0.0.1")
	if err != nil {
		t.Fatal(err)
	}
	otherCert, err := tls.LoadX509KeyPair(cert, key)
	if err != nil {
		t.Fatal(err)
	}
	other := httptest.NewUnstartedServer(f.hub)
	other.TLS = &tls.Config{Certificates: []tls.Certificate{otherCert}, MinVersion: tls.VersionTLS12}
	other.StartTLS()
	defer other.Close()
	before, _ := os.ReadFile(f.path)
	if _, err = RecoverEndpoint(context.Background(), f.path, other.URL); err == nil {
		t.Fatal("forged certificate accepted")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err = RecoverEndpoint(ctx, f.path, original.URL); !errors.Is(err, context.Canceled) {
		t.Fatal("canceled recovery accepted", err)
	}
	mustCall(t, f.owner, "/v1/revoke", map[string]string{"device_id": f.identity.ID}, nil)
	if _, err = RecoverEndpoint(context.Background(), f.path, original.URL); err == nil {
		t.Fatal("revoked device recovered")
	}
	for _, pin := range []string{"", strings.Repeat("0", 64)} {
		path := filepath.Join(t.TempDir(), "device.json")
		i := f.identity
		i.TLSFingerprint = pin
		if err = writeJSON(path, i); err != nil {
			t.Fatal(err)
		}
		if _, err = RecoverEndpoint(context.Background(), path, original.URL); err == nil {
			t.Fatal("missing or wrong original trust accepted")
		}
		if _, err = os.Stat(endpointFile(path)); !os.IsNotExist(err) {
			t.Fatal("failed recovery saved an endpoint")
		}
	}
	after, _ := os.ReadFile(f.path)
	if !bytes.Equal(before, after) {
		t.Fatal("failure overwrote original identity")
	}
	if _, err = os.Stat(endpointFile(f.path)); !os.IsNotExist(err) {
		t.Fatal("rejected recovery saved endpoint")
	}
	missing := filepath.Join(t.TempDir(), "missing", "device.json")
	if _, err = RecoverEndpoint(context.Background(), missing, original.URL); err == nil {
		t.Fatal("new identity silently created")
	}
	if _, err = os.Stat(filepath.Dir(missing)); !os.IsNotExist(err) {
		t.Fatal("missing identity created a directory")
	}
}

func TestSavedEndpointRejectsTamperAndAcceptsRetainedUppercasePin(t *testing.T) {
	f, server := recoveryFixture(t)
	i := f.identity
	i.TLSFingerprint = strings.ToUpper(i.TLSFingerprint)
	if err := writeJSON(f.path, i); err != nil {
		t.Fatal(err)
	}
	if _, err := RecoverEndpoint(context.Background(), f.path, server.URL); err != nil {
		t.Fatal("legacy uppercase pin rejected", err)
	}
	for _, mutate := range []func(*savedEndpoint){
		func(v *savedEndpoint) { v.DeviceID = strings.Repeat("0", 32) },
		func(v *savedEndpoint) { v.Pin = strings.Repeat("0", 64) },
		func(v *savedEndpoint) { v.URL = "http://192.0.2.1:17920" },
		func(v *savedEndpoint) { v.VerifiedAt = "invalid" },
	} {
		value := savedEndpoint{Schema: 1, DeviceID: i.ID, Pin: i.TLSFingerprint, URL: server.URL, VerifiedAt: now()}
		mutate(&value)
		if err := writeJSON(endpointFile(f.path), value); err != nil {
			t.Fatal(err)
		}
		if _, err := LoadConnectionIdentity(f.path); err == nil {
			t.Fatal("tampered saved endpoint accepted")
		}
	}
}

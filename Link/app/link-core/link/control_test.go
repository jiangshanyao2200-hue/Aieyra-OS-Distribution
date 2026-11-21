// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Link/app/link-core/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: TestDeviceCodeTLSIdentityExpiryAndOneUse; TestControlRelayEncryptionLifecycleAndRevocation; TestControlProxyRealHTTPAndRestrictedRoutes; TestControlRouteScope
// Impact: python -B scripts/code-atlas.py show Link/app/link-core/link/control_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package link

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestDeviceCodeTLSIdentityExpiryAndOneUse(t *testing.T) {
	dir := t.TempDir()
	cert, key, pin, e := prepareTLS(dir, "https://127.0.0.1")
	if e != nil {
		t.Fatal(e)
	}
	server := httptest.NewUnstartedServer(nil)
	identity, e := InitHub(dir, "https://"+server.Listener.Addr().String(), "owner")
	if e != nil {
		t.Fatal(e)
	}
	identity.TLSFingerprint = pin
	h, e := OpenHub(dir)
	if e != nil {
		t.Fatal(e)
	}
	defer h.Close()
	server.Config.Handler = h
	go server.Config.ServeTLS(server.Listener, cert, key)
	defer server.Close()
	owner, e := NewClient(identity)
	if e != nil {
		t.Fatal(e)
	}
	var invite struct {
		Invite  string
		Expires int64 `json:"expires_unix"`
	}
	mustCall(t, owner, "/v1/invites", nil, &invite)
	code := encodeCode(identity, invite.Invite, invite.Expires)
	paired, e := PairCode(context.Background(), filepath.Join(t.TempDir(), "device.json"), "laptop", code)
	if e != nil {
		t.Fatal(e)
	}
	if paired.TLSFingerprint != pin {
		t.Fatal("server pin not retained")
	}
	if _, e = PairCode(context.Background(), filepath.Join(t.TempDir(), "device.json"), "thief", code); e == nil {
		t.Fatal("code used twice")
	}
	if _, e = parseCode(encodeCode(identity, invite.Invite, time.Now().Unix()-1)); e == nil {
		t.Fatal("expired code accepted")
	}
	paired.TLSFingerprint = strings.Repeat("0", 64)
	bad, _ := NewClient(paired)
	if e = bad.Call(context.Background(), "/v1/catalog", nil, nil); e == nil {
		t.Fatal("wrong TLS pin accepted")
	}
}
func TestControlRelayEncryptionLifecycleAndRevocation(t *testing.T) {
	f := fixtureHub(t)
	host := pairDevice(t, f, "office")
	agent := pairDevice(t, f, "laptop")
	other := pairDevice(t, f, "unrelated")
	key, _ := encryptionKey(host.Identity)
	clientKey, _ := encryptionKey(agent.Identity)
	var service RelayService
	signing, signature := encryptionProof(host.Identity, publicEncryptionKey(key))
	mustCall(t, host, "/v1/control/register", map[string]string{"name": "office", "public_key": publicEncryptionKey(key), "signing_key": signing, "signature": signature}, &service)
	job := RelayJob{ServiceID: service.ID, SenderID: agent.Identity.ID, RequestID: "one", PublicKey: publicEncryptionKey(clientKey)}
	job.SigningKey, job.Signature = encryptionProof(agent.Identity, job.PublicKey)
	original := []byte(`{"method":"POST","path":"/api/agent/v1/connect","token":"private-token","body":{"request_id":"real-request"}}`)
	job.Payload, _ = seal(clientKey, service.PublicKey, relayContext(job, "request"), original)
	job.SenderID = ""
	var accepted RelayJob
	mustCall(t, agent, "/v1/control/send", job, &accepted)
	mustCall(t, agent, "/v1/control/send", job, nil)
	if e := other.Call(context.Background(), "/v1/control/result", map[string]string{"id": accepted.ID}, nil); e == nil {
		t.Fatal("other device read request")
	}
	plain, e := unseal(key, accepted.PublicKey, relayContext(accepted, "request"), accepted.Payload)
	if e != nil || !bytes.Equal(plain, original) {
		t.Fatal(e)
	}
	if _, e = unseal(key, accepted.PublicKey, relayContext(accepted, "response"), accepted.Payload); e == nil {
		t.Fatal("direction replay accepted")
	}
	response, _ := seal(key, accepted.PublicKey, relayContext(accepted, "response"), []byte(`{"status":200,"body":{"ok":true}}`))
	if e = other.Call(context.Background(), "/v1/control/receipt", map[string]string{"id": accepted.ID, "response": response}, nil); e == nil {
		t.Fatal("non owner supplied receipt")
	}
	mustCall(t, host, "/v1/control/receipt", map[string]string{"id": accepted.ID, "response": response}, nil)
	if e = host.Call(context.Background(), "/v1/control/receipt", map[string]string{"id": accepted.ID, "response": "changed"}, nil); e == nil {
		t.Fatal("receipt mutation")
	}
	b, _ := json.Marshal(f.hub.state)
	if bytes.Contains(b, []byte("private-token")) {
		t.Fatal("hub stored plaintext credentials")
	}
	mustCall(t, f.owner, "/v1/revoke", map[string]string{"device_id": agent.Identity.ID}, nil)
	if e = agent.Call(context.Background(), "/v1/control/result", map[string]string{"id": accepted.ID}, nil); e == nil {
		t.Fatal("revoked device connected")
	}
}
func TestControlProxyRealHTTPAndRestrictedRoutes(t *testing.T) {
	f := fixtureHub(t)
	host := pairDevice(t, f, "office")
	agent := pairDevice(t, f, "laptop")
	var calls atomic.Int32
	local := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.Header.Get("Authorization") != "Bearer "+strings.Repeat("a", 43) {
			t.Error("original agent authentication missing")
		}
		fmt.Fprint(w, `{"session":{"state":"connected"}}`)
	}))
	defer local.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- RunControlBridge(ctx, host, local.URL, "office", t.TempDir(), false, io.Discard) }()
	deadline := time.Now().Add(3 * time.Second)
	var catalog struct {
		Services []RelayService `json:"services"`
	}
	for len(catalog.Services) == 0 && time.Now().Before(deadline) {
		mustCall(t, agent, "/v1/control/catalog", nil, &catalog)
		time.Sleep(10 * time.Millisecond)
	}
	if len(catalog.Services) != 1 {
		t.Fatal("service not registered")
	}
	key, _ := encryptionKey(agent.Identity)
	proxy := &ControlProxy{Client: agent, Key: key, Service: catalog.Services[0], Slots: make(chan struct{}, 4)}
	srv := httptest.NewServer(proxy)
	defer srv.Close()
	proxy.Origin = srv.URL
	req, _ := http.NewRequest("POST", srv.URL+"/api/agent/v1/connect", strings.NewReader(`{"request_id":"real-connect"}`))
	req.Header.Set("Authorization", "Bearer "+strings.Repeat("a", 43))
	req.Header.Set("Content-Type", "application/json")
	res, e := http.DefaultClient.Do(req)
	if e != nil {
		t.Fatal(e)
	}
	b, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatalf("%d %s", res.StatusCode, b)
	}
	for _, path := range []string{"/api/agent-access/enroll", "/api/cloud/login", "/api/agent/v1/../management"} {
		r, _ := http.NewRequest("POST", srv.URL+path, strings.NewReader(`{}`))
		rr, e := http.DefaultClient.Do(r)
		if e != nil {
			t.Fatal(e)
		}
		rr.Body.Close()
		if rr.StatusCode != 403 {
			t.Fatalf("unsafe path %s: %d", path, rr.StatusCode)
		}
	}
	r, _ := http.NewRequest("GET", srv.URL+"/api/snapshot", nil)
	rr, e := http.DefaultClient.Do(r)
	if e != nil {
		t.Fatal(e)
	}
	rr.Body.Close()
	if rr.StatusCode != 400 {
		t.Fatalf("private view exposed: %d", rr.StatusCode)
	}
	req, _ = http.NewRequest("GET", srv.URL+"/api/agent/v1/info", nil)
	req.Header.Set("Origin", srv.URL)
	rr, e = http.DefaultClient.Do(req)
	if e != nil {
		t.Fatal(e)
	}
	rr.Body.Close()
	if rr.StatusCode != 403 {
		t.Fatal("browser accepted")
	}
	if calls.Load() != 1 {
		t.Fatalf("unexpected local calls %d", calls.Load())
	}
	cancel()
	if e = <-done; e != nil {
		t.Fatal(e)
	}
}
func TestControlRouteScope(t *testing.T) {
	for _, p := range []ControlRequest{{"GET", "http://evil/api/agent/v1/info", strings.Repeat("a", 43), nil, 0}, {"GET", "/api/agent/v1/%2e%2e/secrets", strings.Repeat("a", 43), nil, 0}, {"POST", "/api/agent/v1/connect?x=1", strings.Repeat("a", 43), json.RawMessage(`{}`), 0}, {"GET", "/api/snapshot", "", nil, 0}} {
		if allowedControl(p, false) {
			t.Fatalf("accepted unsafe request %s", p.Path)
		}
	}
}

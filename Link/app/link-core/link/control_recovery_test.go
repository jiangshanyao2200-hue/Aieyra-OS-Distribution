// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Link/app/link-core/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: registerControl; queueControl; waitControl; runTestBridge; TestControlReceiptLossRestartDoesNotRepeatWrite; TestControlSubmittedAndExpiredRequestsNeverExecute; TestControlLargeReceiptStaleQueueAndIdentityProof; TestControlJournalRetentionAndTLSInitialization
// Impact: python -B scripts/code-atlas.py show Link/app/link-core/link/control_recovery_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package link

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func registerControl(t *testing.T, host *Client) RelayService {
	t.Helper()
	key, _ := encryptionKey(host.Identity)
	public := publicEncryptionKey(key)
	signing, signature := encryptionProof(host.Identity, public)
	var service RelayService
	mustCall(t, host, "/v1/control/register", map[string]string{"name": "test office", "public_key": public, "signing_key": signing, "signature": signature}, &service)
	return service
}

func queueControl(t *testing.T, client *Client, service RelayService, request ControlRequest, requestID string) RelayJob {
	t.Helper()
	key, _ := encryptionKey(client.Identity)
	j := RelayJob{ServiceID: service.ID, SenderID: client.Identity.ID, RequestID: requestID, PublicKey: publicEncryptionKey(key)}
	j.SigningKey, j.Signature = encryptionProof(client.Identity, j.PublicKey)
	raw, _ := json.Marshal(request)
	var e error
	j.Payload, e = seal(key, service.PublicKey, relayContext(j, "request"), raw)
	if e != nil {
		t.Fatal(e)
	}
	j.SenderID = ""
	var accepted RelayJob
	mustCall(t, client, "/v1/control/send", j, &accepted)
	return accepted
}

func waitControl(t *testing.T, c *Client, id string) RelayJob {
	t.Helper()
	deadline := time.Now().Add(6 * time.Second)
	for time.Now().Before(deadline) {
		var j RelayJob
		mustCall(t, c, "/v1/control/result", map[string]string{"id": id}, &j)
		if j.State == "responded" {
			return j
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("missing Control receipt")
	return RelayJob{}
}

func runTestBridge(t *testing.T, c *Client, url, dir string) func() {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- RunControlBridge(ctx, c, url, "test office", dir, false, io.Discard) }()
	return func() {
		cancel()
		if e := <-done; e != nil {
			t.Error(e)
		}
	}
}

func TestControlReceiptLossRestartDoesNotRepeatWrite(t *testing.T) {
	f := fixtureHub(t)
	host := pairDevice(t, f, "host")
	client := pairDevice(t, f, "client")
	service := registerControl(t, host)
	var calls atomic.Int32
	local := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1); fmt.Fprint(w, `{"ok":true}`) }))
	defer local.Close()
	dir := t.TempDir()
	f.mu.Lock()
	f.failControlReceipts = true
	f.mu.Unlock()
	j := queueControl(t, client, service, ControlRequest{Method: "POST", Path: "/api/agent/v1/connect", Token: strings.Repeat("a", 43), Body: json.RawMessage(`{"request_id":"same-write"}`), Deadline: time.Now().Add(30 * time.Second).Unix()}, "loss")
	stop := runTestBridge(t, host, local.URL, dir)
	deadline := time.Now().Add(4 * time.Second)
	for time.Now().Before(deadline) {
		b, _ := os.ReadFile(filepath.Join(dir, j.ID+".json"))
		if strings.Contains(string(b), `"responded"`) {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	stop()
	if calls.Load() != 1 {
		t.Fatalf("first write count %d", calls.Load())
	}
	f.mu.Lock()
	f.failControlReceipts = false
	f.mu.Unlock()
	stop = runTestBridge(t, host, local.URL, dir)
	result := waitControl(t, client, j.ID)
	stop()
	if calls.Load() != 1 || result.State != "responded" {
		t.Fatal("restart replayed write")
	}
}

func TestControlSubmittedAndExpiredRequestsNeverExecute(t *testing.T) {
	for _, submitted := range []bool{true, false} {
		t.Run(fmt.Sprint(submitted), func(t *testing.T) {
			f := fixtureHub(t)
			host := pairDevice(t, f, "host")
			client := pairDevice(t, f, "client")
			service := registerControl(t, host)
			dir := t.TempDir()
			var calls atomic.Int32
			local := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1); fmt.Fprint(w, `{}`) }))
			defer local.Close()
			expires := time.Now().Add(30 * time.Second).Unix()
			if !submitted {
				expires = time.Now().Add(-time.Minute).Unix()
			}
			j := queueControl(t, client, service, ControlRequest{Method: "POST", Path: "/api/agent/v1/connect", Token: strings.Repeat("a", 43), Body: json.RawMessage(`{"request_id":"uncertain-write"}`), Deadline: expires}, "uncertain")
			if submitted {
				if e := writeJSON(filepath.Join(dir, j.ID+".json"), map[string]string{"state": "submitted", "digest": hash([]byte(j.Payload))}); e != nil {
					t.Fatal(e)
				}
			}
			stop := runTestBridge(t, host, local.URL, dir)
			result := waitControl(t, client, j.ID)
			stop()
			key, _ := encryptionKey(client.Identity)
			b, e := unseal(key, service.PublicKey, relayContext(result, "response"), result.Response)
			var response ControlResponse
			json.Unmarshal(b, &response)
			expected := 408
			if submitted {
				expected = 409
			}
			if e != nil || response.Status != expected || calls.Load() != 0 {
				t.Fatalf("status=%d calls=%d error=%v", response.Status, calls.Load(), e)
			}
		})
	}
}

func TestControlLargeReceiptStaleQueueAndIdentityProof(t *testing.T) {
	f := fixtureHub(t)
	host := pairDevice(t, f, "host")
	client := pairDevice(t, f, "client")
	service := registerControl(t, host)
	if verifyEncryptionProof(client.Identity.ID, service.PublicKey, service.SigningKey, service.Signature) {
		t.Fatal("wrong signer accepted")
	}
	altered := service
	altered.PublicKey = strings.Repeat("A", 43) + "="
	if verifyEncryptionProof(host.Identity.ID, altered.PublicKey, service.SigningKey, service.Signature) {
		t.Fatal("key substitution accepted")
	}
	if e := host.Call(context.Background(), "/v1/control/register", map[string]string{"name": "test", "public_key": altered.PublicKey, "signing_key": service.SigningKey, "signature": service.Signature}, nil); e == nil {
		t.Fatal("Hub accepted forged identity")
	}
	j := queueControl(t, client, service, ControlRequest{Method: "GET", Path: "/api/agent/v1/info", Token: strings.Repeat("a", 43), Deadline: time.Now().Add(30 * time.Second).Unix()}, "large")
	key, _ := encryptionKey(host.Identity)
	plain := []byte(`{"status":200,"body":{"data":"` + strings.Repeat("x", 7<<20) + `"}}`)
	encrypted, e := seal(key, j.PublicKey, relayContext(j, "response"), plain)
	if e != nil {
		t.Fatal(e)
	}
	mustCall(t, host, "/v1/control/receipt", map[string]string{"id": j.ID, "response": encrypted}, nil)
	result := waitControl(t, client, j.ID)
	if result.Response != encrypted || len(result.Response) < 8<<20 {
		t.Fatal("large encrypted receipt truncated")
	}
	stale := queueControl(t, client, service, ControlRequest{Method: "GET", Path: "/api/health"}, "stale")
	f.hub.mu.Lock()
	stale.CreatedAt = time.Now().Add(-time.Minute).Unix()
	f.hub.state.RelayJobs[stale.ID] = stale
	f.hub.mu.Unlock()
	var poll struct {
		Requests []RelayJob `json:"requests"`
	}
	mustCall(t, host, "/v1/control/poll", nil, &poll)
	if len(poll.Requests) != 0 {
		t.Fatal("stale request delivered")
	}
	mustCall(t, client, "/v1/control/result", map[string]string{"id": stale.ID}, &result)
	if result.State != "unconfirmed" {
		t.Fatal("stale request shown as confirmed")
	}
}

func TestControlJournalRetentionAndTLSInitialization(t *testing.T) {
	dir := t.TempDir()
	old := filepath.Join(dir, strings.Repeat("a", 64)+".json")
	os.WriteFile(old, []byte(`{}`), 0600)
	past := time.Now().Add(-11 * time.Minute)
	os.Chtimes(old, past, past)
	keep := filepath.Join(dir, "device.json")
	os.WriteFile(keep, []byte(`{}`), 0600)
	os.Chtimes(keep, past, past)
	if e := cleanControlJournal(dir); e != nil {
		t.Fatal(e)
	}
	if _, e := os.Stat(old); !os.IsNotExist(e) {
		t.Fatal("expired journal retained")
	}
	if _, e := os.Stat(keep); e != nil {
		t.Fatal("identity removed")
	}
	cert, key, pin, e := prepareTLS(dir, "https://127.0.0.1:17920")
	if e != nil {
		t.Fatal(e)
	}
	_, _, again, e := prepareTLS(dir, "https://127.0.0.1:17920")
	if e != nil || pin != again {
		t.Fatal("TLS identity replaced")
	}
	before, _ := os.ReadFile(key)
	os.Remove(cert)
	if _, _, _, e = prepareTLS(dir, "https://127.0.0.1:17920"); e == nil {
		t.Fatal("partial TLS initialization overwritten")
	}
	after, _ := os.ReadFile(key)
	if string(before) != string(after) {
		t.Fatal("private key replaced")
	}
}

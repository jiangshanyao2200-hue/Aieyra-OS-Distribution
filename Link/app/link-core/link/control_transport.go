// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Link/app/link-core/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: encryptionKey; validEncryptionKey; publicEncryptionKey; encryptionProof; verifyEncryptionProof; relayCipher; seal; unseal; relayContext; ControlRequest; ControlResponse; allowedControl; localControlURL; forwardControl; forwardControlWithClient; RunControlBridge; cleanControlJournal; ControlProxy; ServeHTTP; ServeControlProxy
// Impact: python -B scripts/code-atlas.py show Link/app/link-core/link/control_transport.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package link

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func encryptionKey(i Identity) (*ecdh.PrivateKey, error) {
	k, e := i.key()
	if e != nil {
		return nil, e
	}
	seed := sha256.Sum256(append([]byte("aieyra-link/control-key/1\n"), k.Seed()...))
	return ecdh.X25519().NewPrivateKey(seed[:])
}
func validEncryptionKey(s string) bool {
	b, e := base64.StdEncoding.DecodeString(s)
	if e != nil {
		return false
	}
	_, e = ecdh.X25519().NewPublicKey(b)
	return e == nil
}
func publicEncryptionKey(k *ecdh.PrivateKey) string {
	return base64.StdEncoding.EncodeToString(k.PublicKey().Bytes())
}

func encryptionProof(i Identity, public string) (string, string) {
	k, _ := i.key()
	return base64.StdEncoding.EncodeToString(k.Public().(ed25519.PublicKey)), base64.StdEncoding.EncodeToString(ed25519.Sign(k, []byte("aieyra-link/control-identity/1\n"+public)))
}

func verifyEncryptionProof(id, public, signing, signature string) bool {
	key, e := base64.StdEncoding.DecodeString(signing)
	sig, se := base64.StdEncoding.DecodeString(signature)
	return e == nil && se == nil && len(key) == ed25519.PublicKeySize && hash(key)[:32] == id && validEncryptionKey(public) && ed25519.Verify(key, []byte("aieyra-link/control-identity/1\n"+public), sig)
}
func relayCipher(key *ecdh.PrivateKey, peer string) (cipher.AEAD, error) {
	b, e := base64.StdEncoding.DecodeString(peer)
	if e != nil {
		return nil, e
	}
	pub, e := ecdh.X25519().NewPublicKey(b)
	if e != nil {
		return nil, e
	}
	shared, e := key.ECDH(pub)
	if e != nil {
		return nil, e
	}
	digest := sha256.Sum256(append([]byte("aieyra-control-relay/1\n"), shared...))
	block, e := aes.NewCipher(digest[:])
	if e != nil {
		return nil, e
	}
	return cipher.NewGCM(block)
}
func seal(key *ecdh.PrivateKey, peer, context string, body []byte) (string, error) {
	a, e := relayCipher(key, peer)
	if e != nil {
		return "", e
	}
	nonce := make([]byte, a.NonceSize())
	if _, e = rand.Read(nonce); e != nil {
		return "", e
	}
	return base64.StdEncoding.EncodeToString(a.Seal(nonce, nonce, body, []byte(context))), nil
}
func unseal(key *ecdh.PrivateKey, peer, context, encoded string) ([]byte, error) {
	a, e := relayCipher(key, peer)
	if e != nil {
		return nil, e
	}
	b, e := base64.StdEncoding.DecodeString(encoded)
	if e != nil || len(b) < a.NonceSize() {
		return nil, fmt.Errorf("invalid encrypted relay envelope")
	}
	return a.Open(nil, b[:a.NonceSize()], b[a.NonceSize():], []byte(context))
}
func relayContext(j RelayJob, direction string) string {
	return strings.Join([]string{j.SenderID, j.ServiceID, j.RequestID, direction}, "\n")
}

type ControlRequest struct {
	Method   string          `json:"method"`
	Path     string          `json:"path"`
	Token    string          `json:"token,omitempty"`
	Body     json.RawMessage `json:"body,omitempty"`
	Deadline int64           `json:"deadline_unix,omitempty"`
}
type ControlResponse struct {
	Status int             `json:"status"`
	Body   json.RawMessage `json:"body"`
}

func allowedControl(p ControlRequest, view bool) bool {
	u, e := url.ParseRequestURI(p.Path)
	if e != nil || u.IsAbs() || u.Host != "" || u.Fragment != "" || len(p.Path) > 4096 || strings.ContainsAny(u.Path, "%\\") || strings.Contains(u.Path, "..") || strings.Contains(p.Token, "\r") || strings.Contains(p.Token, "\n") || len(p.Token) > 128 {
		return false
	}
	if p.Method != "GET" && p.Method != "POST" {
		return false
	}
	if p.Method == "POST" && (u.RawQuery != "" || len(p.Body) > 32768 || !json.Valid(p.Body)) {
		return false
	}
	if strings.HasPrefix(u.Path, "/api/agent/v1/") {
		return len(p.Token) >= 43
	}
	if p.Method == "GET" && view && p.Token == "" {
		switch u.Path {
		case "/api/snapshot", "/api/registry", "/api/chat-history", "/api/health":
			return true
		}
	}
	return false
}
func localControlURL(raw string) (string, error) {
	u, e := url.Parse(raw)
	if e != nil || u.Scheme != "http" || u.Hostname() != "127.0.0.1" || u.User != nil || u.Path != "" || u.RawQuery != "" || u.Fragment != "" {
		return "", fmt.Errorf("Control must use an explicit 127.0.0.1 HTTP origin")
	}
	return raw, nil
}
func forwardControl(ctx context.Context, endpoint string, p ControlRequest, view bool) ControlResponse {
	h := &http.Client{Timeout: 20 * time.Second, Transport: &http.Transport{Proxy: nil}, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	defer h.CloseIdleConnections()
	return forwardControlWithClient(ctx, h, endpoint, p, view)
}

func forwardControlWithClient(ctx context.Context, h *http.Client, endpoint string, p ControlRequest, view bool) ControlResponse {
	failure := func(code int, text string) ControlResponse {
		b, _ := json.Marshal(map[string]string{"code": text})
		return ControlResponse{code, b}
	}
	if !allowedControl(p, view) {
		return failure(403, "link_route_denied")
	}
	r, e := http.NewRequestWithContext(ctx, p.Method, endpoint+p.Path, bytes.NewReader(p.Body))
	if e != nil {
		return failure(400, "link_invalid_request")
	}
	if p.Token != "" {
		r.Header.Set("Authorization", "Bearer "+p.Token)
	}
	if p.Method == "POST" {
		r.Header.Set("Content-Type", "application/json")
	}
	res, e := h.Do(r)
	if e != nil {
		return failure(503, "connection_unconfirmed_query_original_request")
	}
	defer res.Body.Close()
	b, e := io.ReadAll(io.LimitReader(res.Body, (8<<20)+1))
	if e != nil || len(b) > 8<<20 || !json.Valid(b) {
		return failure(502, "invalid_response_query_original_request")
	}
	return ControlResponse{res.StatusCode, b}
}

// The local journal is encrypted; a lost receipt upload never repeats a submitted
// write blindly. Control's request_id ledger is the authority for retry safety.
func RunControlBridge(ctx context.Context, c *Client, endpoint, name, stateDir string, view bool, out io.Writer) error {
	if _, e := localControlURL(endpoint); e != nil {
		return e
	}
	if e := os.MkdirAll(stateDir, 0700); e != nil {
		return e
	}
	lock, e := os.OpenFile(filepath.Join(stateDir, "control.lock"), os.O_CREATE|os.O_RDWR, 0600)
	if e != nil {
		return e
	}
	defer lock.Close()
	if e = lockFile(lock); e != nil {
		return fmt.Errorf("Control bridge already running for this identity")
	}
	defer unlockFile(lock)
	key, e := encryptionKey(c.Identity)
	if e != nil {
		return e
	}
	var service RelayService
	signing, signature := encryptionProof(c.Identity, publicEncryptionKey(key))
	if e = c.Call(ctx, "/v1/control/register", map[string]string{"name": name, "public_key": publicEncryptionKey(key), "signing_key": signing, "signature": signature}, &service); e != nil {
		return e
	}
	if e = json.NewEncoder(out).Encode(map[string]any{"state": "attached", "service_id": service.ID, "read_only_view": view}); e != nil {
		return e
	}
	delay := time.Second
	lastClean := time.Time{}
	for {
		if time.Since(lastClean) > time.Minute {
			if e = cleanControlJournal(stateDir); e != nil {
				return e
			}
			lastClean = time.Now()
		}
		var poll struct {
			Requests []RelayJob `json:"requests"`
		}
		if e = c.Call(ctx, "/v1/control/poll", nil, &poll); e != nil {
			if ctx.Err() != nil {
				return nil
			}
			if delay < 15*time.Second {
				delay *= 2
			}
		} else {
			delay = time.Second
			for _, j := range poll.Requests {
				if j.ServiceID != service.ID || j.ID != hash([]byte(j.SenderID+":"+j.RequestID)) || !verifyEncryptionProof(j.SenderID, j.PublicKey, j.SigningKey, j.Signature) || j.CreatedAt < time.Now().Add(-30*time.Second).Unix() {
					continue
				}
				path := filepath.Join(stateDir, j.ID+".json")
				var journal struct {
					Digest   string `json:"digest"`
					State    string `json:"state"`
					Response string `json:"response,omitempty"`
				}
				digest := hash([]byte(j.Payload))
				b, readErr := os.ReadFile(path)
				if readErr == nil {
					if json.Unmarshal(b, &journal) != nil || journal.Digest != digest {
						return fmt.Errorf("relay journal conflicts; original retained")
					}
				} else if !os.IsNotExist(readErr) {
					return readErr
				}
				if journal.Response == "" {
					raw, de := unseal(key, j.PublicKey, relayContext(j, "request"), j.Payload)
					var request ControlRequest
					response := ControlResponse{400, json.RawMessage(`{"code":"link_invalid_envelope"}`)}
					if de == nil && decode(raw, &request) == nil && allowedControl(request, view) {
						// The authenticated deadline prevents a hub from reviving old writes
						// by changing its own CreatedAt after journal retention expires.
						safe := request.Method == "GET"
						if request.Deadline < time.Now().Unix() || request.Deadline > time.Now().Add(35*time.Second).Unix() {
							response = ControlResponse{408, json.RawMessage(`{"code":"link_request_expired_query_original_request"}`)}
						} else if journal.State == "submitted" && !safe {
							response = ControlResponse{409, json.RawMessage(`{"code":"connection_unconfirmed_query_original_request"}`)}
						} else {
							journal.Digest = digest
							journal.State = "submitted"
							if e = writeJSON(path, journal); e != nil {
								return e
							}
							response = forwardControl(ctx, endpoint, request, view)
						}
					}
					b, _ = json.Marshal(response)
					journal.Response, e = seal(key, j.PublicKey, relayContext(j, "response"), b)
					if e != nil {
						return e
					}
					journal.Digest = digest
					journal.State = "responded"
					if e = writeJSON(path, journal); e != nil {
						return e
					}
				}
				if e = c.Call(ctx, "/v1/control/receipt", map[string]string{"id": j.ID, "response": journal.Response}, nil); e != nil {
					break
				}
			}
		}
		select {
		case <-ctx.Done():
			return nil
		case <-time.After(delay):
		}
	}
}

// Only this bridge's expired encrypted relay journals are removed. Other state,
// device keys and lock files are retained. Original Control ledgers remain authoritative.
func cleanControlJournal(directory string) error {
	entries, err := os.ReadDir(directory)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || len(name) != 69 || !strings.HasSuffix(name, ".json") || !validID(name[:64]) {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if info.Mode().IsRegular() && time.Since(info.ModTime()) > relayRetention {
			if err = os.Remove(filepath.Join(directory, name)); err != nil {
				return err
			}
		}
	}
	return nil
}

type ControlProxy struct {
	Client  *Client
	Service RelayService
	Key     *ecdh.PrivateKey
	Origin  string
	Slots   chan struct{}
}

func (p *ControlProxy) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	fail := func(status int, code string) {
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(map[string]string{"code": code})
	}
	if r.Host != strings.TrimPrefix(p.Origin, "http://") || r.Header.Get("Origin") != "" || r.Header.Get("Sec-Fetch-Site") != "" || r.Header.Get("Transfer-Encoding") != "" || len(r.TransferEncoding) > 0 {
		fail(403, "link_native_requests_only")
		return
	}
	for _, h := range []string{"Authorization", "Host", "Content-Length", "Content-Type"} {
		if len(r.Header.Values(h)) > 1 {
			fail(400, "duplicate_header")
			return
		}
	}
	body, e := io.ReadAll(io.LimitReader(r.Body, 32769))
	if e != nil || len(body) > 32768 {
		fail(413, "body_limit")
		return
	}
	token := r.Header.Get("Authorization")
	if token != "" {
		if !strings.HasPrefix(token, "Bearer ") {
			fail(401, "agent_unauthorized")
			return
		}
		token = strings.TrimPrefix(token, "Bearer ")
	}
	req := ControlRequest{Method: r.Method, Path: r.URL.RequestURI(), Token: token, Body: body, Deadline: time.Now().Add(30 * time.Second).Unix()}
	if !allowedControl(req, true) {
		fail(403, "link_route_denied")
		return
	}
	select {
	case p.Slots <- struct{}{}:
		defer func() { <-p.Slots }()
	default:
		fail(429, "link_busy")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 28*time.Second)
	defer cancel()
	requestID := randomID()
	job := RelayJob{ServiceID: p.Service.ID, SenderID: p.Client.Identity.ID, RequestID: requestID, PublicKey: publicEncryptionKey(p.Key)}
	job.SigningKey, job.Signature = encryptionProof(p.Client.Identity, job.PublicKey)
	raw, _ := json.Marshal(req)
	job.Payload, e = seal(p.Key, p.Service.PublicKey, relayContext(job, "request"), raw)
	if e != nil {
		fail(500, "link_encryption_failed")
		return
	}
	job.SenderID = ""
	expectedID := hash([]byte(p.Client.Identity.ID + ":" + requestID))
	var result RelayJob
	if e = p.Client.Call(ctx, "/v1/control/send", job, &result); e != nil {
		fail(503, "connection_unconfirmed_query_original_request")
		return
	}
	for {
		if result.ID != expectedID || result.ServiceID != p.Service.ID || result.SenderID != p.Client.Identity.ID || result.RequestID != requestID {
			fail(502, "link_response_identity_mismatch")
			return
		}
		if result.State == "responded" {
			break
		}
		if result.State == "unconfirmed" {
			fail(504, "connection_unconfirmed_query_original_request")
			return
		}
		select {
		case <-ctx.Done():
			fail(504, "connection_unconfirmed_query_original_request")
			return
		case <-time.After(200 * time.Millisecond):
		}
		if e = p.Client.Call(ctx, "/v1/control/result", map[string]string{"id": result.ID}, &result); e != nil {
			fail(503, "connection_unconfirmed_query_original_request")
			return
		}
	}
	plain, e := unseal(p.Key, p.Service.PublicKey, relayContext(result, "response"), result.Response)
	var response ControlResponse
	if e != nil || decode(plain, &response) != nil || response.Status < 200 || response.Status > 599 || !json.Valid(response.Body) {
		fail(502, "link_invalid_response")
		return
	}
	w.WriteHeader(response.Status)
	_, _ = w.Write(response.Body)
}
func ServeControlProxy(ctx context.Context, c *Client, serviceID, listen string, out io.Writer) error {
	host, _, e := net.SplitHostPort(listen)
	if e != nil || host != "127.0.0.1" {
		return fmt.Errorf("Control proxy must bind 127.0.0.1")
	}
	var catalog struct {
		Services []RelayService `json:"services"`
	}
	if e = c.Call(ctx, "/v1/control/catalog", nil, &catalog); e != nil {
		return e
	}
	var service RelayService
	for _, s := range catalog.Services {
		if s.ID == serviceID {
			service = s
		}
	}
	if service.ID == "" {
		return fmt.Errorf("select an existing Control service ID from control-status")
	}
	if service.ID != service.DeviceID+":control" || !verifyEncryptionProof(service.DeviceID, service.PublicKey, service.SigningKey, service.Signature) {
		return fmt.Errorf("Control service identity proof invalid")
	}
	key, e := encryptionKey(c.Identity)
	if e != nil {
		return e
	}
	listener, e := net.Listen("tcp", listen)
	if e != nil {
		return e
	}
	origin := "http://" + listener.Addr().String()
	proxy := &ControlProxy{Client: c, Service: service, Key: key, Origin: origin, Slots: make(chan struct{}, 16)}
	server := &http.Server{Handler: proxy, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 35 * time.Second, WriteTimeout: 35 * time.Second, IdleTimeout: 30 * time.Second, MaxHeaderBytes: 8192}
	done := make(chan error, 1)
	go func() { done <- server.Serve(listener) }()
	if e = json.NewEncoder(out).Encode(map[string]any{"state": "ready", "url": origin, "service_id": service.ID, "agent_authentication": "original Control token required"}); e != nil {
		server.Close()
		return e
	}
	select {
	case <-ctx.Done():
		stop, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		return server.Shutdown(stop)
	case e = <-done:
		if e == http.ErrServerClosed {
			return nil
		}
		return e
	}
}

// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Link/app/link-core/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: LANProtocol; LANVersion; lanProbePort; autoLANService; advertiseAutoLAN; lanBroadcastAddresses; LANEnrollment; LANHost; sameLAN; ServeHTTP; local; enroll; snapshot; serveLANProbe; DiscoverAutoLAN; ServeLAN; LANPeer; connectLAN; LANProxy; ServeHTTP; RunLAN; runLAN; validAutoCandidate
// Impact: python -B scripts/code-atlas.py show Link/app/link-core/link/lan_auto.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package link

// LAN collaboration uses the same Ed25519 proof, nonce ledger and pinned TLS
// as Link. Discovery contains public metadata only. Enrollment is narrowly
// scoped to one ordinary worker per device in the host's configured project.
import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/subtle"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/libp2p/zeroconf/v2"
)

const LANProtocol = "aieyra-link-lan/1"
const LANVersion = "0.1.0"
const lanProbePort = 17922
const autoLANService = "_aieyra-lan._tcp"

func advertiseAutoLAN(identity Identity, listen net.Addr) (*zeroconf.Server, error) {
	interfaces, err := net.Interfaces()
	if err != nil {
		return nil, err
	}
	value, err := announcementFor(identity, listen, interfaces, func(iface net.Interface) ([]net.Addr, error) { return iface.Addrs() })
	if err != nil {
		return nil, err
	}
	return zeroconf.RegisterProxy("Aieyra-"+identity.ID, autoLANService, "local.", value.Port, "aieyra-"+identity.ID+".local.", value.IPs, value.Text, value.Interfaces, zeroconf.TTL(30))
}

func lanBroadcastAddresses() []net.IP {
	result := []net.IP{}
	interfaces, _ := net.Interfaces()
	for _, iface := range interfaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		addresses, _ := iface.Addrs()
		for _, address := range addresses {
			ip, subnet, err := net.ParseCIDR(address.String())
			if err != nil || ip.To4() == nil || !lanIP(ip) || len(subnet.Mask) != 4 {
				continue
			}
			broadcast := append(net.IP(nil), ip.To4()...)
			for j := range broadcast {
				broadcast[j] |= ^subnet.Mask[j]
			}
			result = append(result, broadcast)
		}
	}
	return result
}

type LANEnrollment struct {
	TokenHash string `json:"token_hash"`
	Project   string `json:"project"`
	Name      string `json:"name"`
}
type LANHost struct {
	Hub                            *Hub
	Owner                          Identity
	ControlURL, Project, Directory string
	enrollMu                       sync.Mutex
	mu                             sync.Mutex
	seen                           map[string]time.Time
	HTTP                           *http.Client
}

func sameLAN(remote string) bool {
	host, _, err := net.SplitHostPort(remote)
	ip := net.ParseIP(host)
	if err != nil || !lanIP(ip) {
		return false
	}
	interfaces, err := net.Interfaces()
	if err != nil {
		return false
	}
	for _, iface := range interfaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		addresses, _ := iface.Addrs()
		for _, a := range addresses {
			local, subnet, e := net.ParseCIDR(a.String())
			if e == nil && lanIP(local) && subnet.Contains(ip) {
				return true
			}
		}
	}
	return false
}

func (s *LANHost) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// The desktop owner also uses signed loopback queries. Network peers must
	// originate in a directly connected private subnet; proxies are not trusted.
	remote, _, _ := net.SplitHostPort(r.RemoteAddr)
	loopback := net.ParseIP(remote).IsLoopback()
	if !loopback && !sameLAN(r.RemoteAddr) {
		http.Error(w, "local network required", 403)
		return
	}
	if !strings.HasPrefix(r.URL.Path, "/v1/lan/") {
		s.Hub.ServeHTTP(w, r)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	respond := func(status int, data any, err error) {
		w.WriteHeader(status)
		message := ""
		if err != nil {
			message = err.Error()
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": err == nil, "data": data, "error": message})
	}
	if r.Method != "POST" || r.URL.RawQuery != "" || r.Header.Get("Origin") != "" || r.Header.Get("Sec-Fetch-Site") != "" || len(r.TransferEncoding) > 0 {
		respond(403, nil, fmt.Errorf("native signed request required"))
		return
	}
	for _, key := range []string{"Content-Type", "X-Link-Device", "X-Link-Time", "X-Link-Nonce", "X-Link-Signature"} {
		if len(r.Header.Values(key)) != 1 {
			respond(400, nil, fmt.Errorf("invalid native header"))
			return
		}
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 65537))
	if err != nil || len(body) > 65536 {
		respond(413, nil, fmt.Errorf("body limit"))
		return
	}
	if !json.Valid(body) {
		respond(400, nil, fmt.Errorf("invalid JSON request"))
		return
	}
	switch r.URL.Path {
	case "/v1/lan/pair", "/v1/lan/ping", "/v1/lan/enroll", "/v1/lan/agent":
	default:
		respond(404, nil, fmt.Errorf("LAN route unavailable"))
		return
	}
	h := s.Hub
	h.mu.Lock()
	if h.closed {
		h.mu.Unlock()
		respond(503, nil, fmt.Errorf("office stopping"))
		return
	}
	before, err := json.Marshal(h.state)
	if err != nil {
		h.mu.Unlock()
		respond(500, nil, fmt.Errorf("device state unavailable"))
		return
	}
	device, err := h.authenticate(r, body)
	if err == nil && r.URL.Path == "/v1/lan/pair" {
		var value struct {
			Device Device `json:"device"`
		}
		old, exists := h.state.Devices[device.ID]
		if decode(body, &value) != nil || device.Admin || !validLANName(device.Name) || len(device.Name) > 80 || exists && (old.Revoked || old.PublicKey != device.PublicKey || old.Name != device.Name) {
			err = fmt.Errorf("original device identity retained")
		} else if !exists && len(h.state.Devices) >= 32 {
			err = fmt.Errorf("LAN device capacity reached")
		} else if !exists {
			h.state.Devices[device.ID] = device
			h.emit("device", device.ID, "paired")
		}
	}
	if err == nil {
		err = writeJSON(h.path, h.state)
	}
	if err != nil {
		h.state = hubState{}
		_ = json.Unmarshal(before, &h.state)
	}
	h.mu.Unlock()
	if err != nil {
		respond(403, nil, fmt.Errorf("device authentication failed"))
		return
	}
	s.mu.Lock()
	s.seen[device.ID] = time.Now()
	s.mu.Unlock()
	switch r.URL.Path {
	case "/v1/lan/pair", "/v1/lan/ping":
		respond(200, map[string]string{"protocol": LANProtocol, "host_id": s.Owner.ID, "project": s.Project, "name": s.Owner.Name}, nil)
	case "/v1/lan/enroll":
		var value struct {
			Token string `json:"token"`
		}
		if decode(body, &value) != nil || len(value.Token) != 43 {
			respond(400, nil, fmt.Errorf("strong worker token required"))
			return
		}
		decoded, e := base64.RawURLEncoding.DecodeString(value.Token)
		if e != nil || len(decoded) != 32 {
			respond(400, nil, fmt.Errorf("strong worker token required"))
			return
		}
		s.enrollMu.Lock()
		defer s.enrollMu.Unlock()
		file := filepath.Join(s.Directory, "lan-enrollments", device.ID+".json")
		record := LANEnrollment{hash([]byte(value.Token)), s.Project, device.Name}
		var old LANEnrollment
		if b, e := os.ReadFile(file); e == nil {
			if json.Unmarshal(b, &old) != nil || old != record {
				respond(409, nil, fmt.Errorf("original worker credential retained"))
				return
			}
		} else if !os.IsNotExist(e) {
			respond(500, nil, fmt.Errorf("worker record unavailable"))
			return
		}
		if e := writeJSON(file, record); e != nil {
			respond(500, nil, fmt.Errorf("worker record unavailable"))
			return
		}
		// Persist intent before talking to Control. A lost response reuses exactly
		// the same request ID, token, worker name and project; no new actor is made.
		result, e := s.enroll(r.Context(), device, value.Token)
		if e != nil {
			respond(503, nil, e)
			return
		}
		respond(200, result, nil)
	case "/v1/lan/agent":
		var value ControlRequest
		var record LANEnrollment
		b, e := os.ReadFile(filepath.Join(s.Directory, "lan-enrollments", device.ID+".json"))
		if decode(body, &value) != nil || e != nil || json.Unmarshal(b, &record) != nil || !allowedControl(value, false) || subtle.ConstantTimeCompare([]byte(record.TokenHash), []byte(hash([]byte(value.Token)))) != 1 {
			respond(403, nil, fmt.Errorf("worker route denied"))
			return
		}
		// No retries here: Control's original request IDs/CAS remain authoritative.
		if value.Deadline < time.Now().Unix() || value.Deadline > time.Now().Add(35*time.Second).Unix() {
			respond(200, ControlResponse{408, json.RawMessage(`{"code":"link_request_expired_query_original_request"}`)}, nil)
			return
		}
		result := forwardControlWithClient(r.Context(), s.HTTP, s.ControlURL, value, false)
		respond(200, result, nil)
	default:
		respond(404, nil, fmt.Errorf("LAN route unavailable"))
	}
}

func (s *LANHost) local(ctx context.Context, path string, body any, csrf string) (map[string]json.RawMessage, error) {
	var reader io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		reader = bytes.NewReader(b)
	}
	method := "GET"
	if body != nil {
		method = "POST"
	}
	req, e := http.NewRequestWithContext(ctx, method, s.ControlURL+path, reader)
	if e != nil {
		return nil, e
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Origin", s.ControlURL)
		req.Header.Set("X-Control-CSRF", csrf)
	}
	res, e := s.HTTP.Do(req)
	if e != nil {
		return nil, fmt.Errorf("local office unavailable")
	}
	defer res.Body.Close()
	b, e := io.ReadAll(io.LimitReader(res.Body, 65537))
	var value map[string]json.RawMessage
	if e != nil || len(b) > 65536 || json.Unmarshal(b, &value) != nil {
		return nil, fmt.Errorf("local office response invalid")
	}
	if res.StatusCode != 200 {
		var code string
		_ = json.Unmarshal(value["code"], &code)
		if !validID(code) {
			code = "worker enrollment unavailable"
		}
		return nil, fmt.Errorf("%s", code)
	}
	return value, nil
}
func (s *LANHost) enroll(ctx context.Context, d Device, token string) (any, error) {
	session, e := s.local(ctx, "/api/session", nil, "")
	if e != nil {
		return nil, e
	}
	var csrf string
	_ = json.Unmarshal(session["csrf"], &csrf)
	if len(csrf) < 32 {
		return nil, fmt.Errorf("local office session unavailable")
	}
	result, e := s.local(ctx, "/api/agent-access/enroll", map[string]string{
		"request_id": "lan-" + s.Owner.ID + "-" + d.ID, "name": d.Name, "project": s.Project, "token": token,
	}, csrf)
	if e != nil {
		return nil, e
	}
	return map[string]any{"credential": result["credential"], "state": result["state"], "project": s.Project, "host_id": s.Owner.ID}, nil
}

func (s *LANHost) snapshot() map[string]any {
	s.Hub.mu.Lock()
	defer s.Hub.mu.Unlock()
	s.mu.Lock()
	defer s.mu.Unlock()
	rows := []map[string]any{}
	for id, d := range s.Hub.state.Devices {
		if d.Admin || d.Revoked {
			continue
		}
		seen := s.seen[id]
		last := ""
		if !seen.IsZero() {
			last = seen.UTC().Format(time.RFC3339)
		}
		rows = append(rows, map[string]any{"device_id": id, "name": d.Name, "online": !seen.IsZero() && time.Since(seen) < 30*time.Second, "last_seen": last})
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i]["device_id"].(string) < rows[j]["device_id"].(string) })
	return map[string]any{"state": "ready", "protocol": LANProtocol, "auto_connect": true, "devices": rows, "host_id": s.Owner.ID, "project": s.Project, "name": s.Owner.Name}
}

// UDP broadcast complements mDNS on phones that restrict interface enumeration.
// The reply is bounded, echoes a nonce and never carries a token or office data.
func serveLANProbe(ctx context.Context, i Identity, port int) (*net.UDPConn, error) {
	c, e := net.ListenUDP("udp4", &net.UDPAddr{Port: lanProbePort})
	if e != nil {
		return nil, e
	}
	go func() {
		defer c.Close()
		buf := make([]byte, 1025)
		last := map[string]time.Time{}
		for ctx.Err() == nil {
			_ = c.SetReadDeadline(time.Now().Add(time.Second))
			n, peer, e := c.ReadFromUDP(buf)
			if e != nil {
				if ctx.Err() != nil {
					return
				}
				if ne, ok := e.(net.Error); !ok || !ne.Timeout() {
					return
				}
				continue
			}
			if n > 1024 || !sameLAN(peer.String()) {
				continue
			}
			var query struct {
				Protocol string `json:"protocol"`
				Nonce    string `json:"nonce"`
			}
			if decode(buf[:n], &query) != nil || query.Protocol != LANProtocol || !validHex(query.Nonce, 32) {
				continue
			}
			if time.Since(last[peer.IP.String()]) < time.Second {
				continue
			}
			if len(last) > 256 {
				last = map[string]time.Time{}
			}
			last[peer.IP.String()] = time.Now()
			reply, _ := json.Marshal(map[string]any{"protocol": LANProtocol, "nonce": query.Nonce, "host_id": i.ID, "name": i.Name, "tls_fingerprint": i.TLSFingerprint, "port": port})
			_, _ = c.WriteToUDP(reply, peer)
		}
	}()
	return c, nil
}

func DiscoverAutoLAN(ctx context.Context, duration time.Duration) (LANScan, error) {
	if duration <= 0 || duration > 10*time.Second {
		return LANScan{}, fmt.Errorf("LAN discovery duration must be 0-10 seconds")
	}
	window, cancel := context.WithTimeout(ctx, duration)
	defer cancel()
	mdns := make(chan LANScan, 1)
	go func() {
		scan, _ := collectLAN(window, duration, func(ctx context.Context, entries chan<- *zeroconf.ServiceEntry) error {
			return zeroconf.Browse(ctx, autoLANService, "local.", entries)
		})
		mdns <- scan
	}()
	result := LANScan{Source: "lan", ObservedAt: now(), Candidates: []LANCandidate{}}
	c, e := net.ListenUDP("udp4", &net.UDPAddr{})
	if e == nil {
		defer c.Close()
		if e = enableLANBroadcast(c); e != nil {
			return result, e
		}
		nonce := randomID()
		q, _ := json.Marshal(map[string]string{"protocol": LANProtocol, "nonce": nonce})
		_, _ = c.WriteToUDP(q, &net.UDPAddr{IP: net.IPv4bcast, Port: lanProbePort})
		for _, ip := range lanBroadcastAddresses() {
			_, _ = c.WriteToUDP(q, &net.UDPAddr{IP: ip, Port: lanProbePort})
		}
		buf := make([]byte, 2049)
		for window.Err() == nil && len(result.Candidates) < 32 {
			_ = c.SetReadDeadline(time.Now().Add(300 * time.Millisecond))
			n, peer, e := c.ReadFromUDP(buf)
			if e != nil {
				continue
			}
			var v struct {
				Protocol string `json:"protocol"`
				Nonce    string `json:"nonce"`
				Host     string `json:"host_id"`
				Name     string `json:"name"`
				Pin      string `json:"tls_fingerprint"`
				Port     int    `json:"port"`
			}
			if n > 2048 || !json.Valid(buf[:n]) || decode(buf[:n], &v) != nil || v.Protocol != LANProtocol || v.Nonce != nonce || !lanIP(peer.IP) || !validHex(v.Host, 16) || !validHex(v.Pin, 32) || !validLANName(v.Name) || v.Port < 1 || v.Port > 65535 {
				continue
			}
			endpoint := fmt.Sprintf("https://%s", net.JoinHostPort(peer.IP.String(), fmt.Sprint(v.Port)))
			result.Candidates = append(result.Candidates, LANCandidate{ID: hash([]byte(v.Host + "\n" + v.Pin + "\n" + endpoint)), HostID: v.Host, Name: v.Name, URL: endpoint, Pin: v.Pin})
		}
	} else {
		<-window.Done()
	}
	scan := <-mdns
	seen := map[string]bool{}
	rows := []LANCandidate{}
	for _, v := range append(result.Candidates, scan.Candidates...) {
		if validAutoCandidate(v) && !seen[v.ID] && len(rows) < 32 {
			seen[v.ID] = true
			rows = append(rows, v)
		}
	}
	sort.Slice(rows, func(i, j int) bool {
		if rows[i].Name == rows[j].Name {
			return rows[i].URL < rows[j].URL
		}
		return rows[i].Name < rows[j].Name
	})
	result.Candidates = rows
	return result, ctx.Err()
}

func ServeLAN(ctx context.Context, directory, listen, controlURL, project, name string, out io.Writer) error {
	controlURL, e := localControlURL(controlURL)
	if e != nil {
		return e
	}
	if !validID(project) || !validLANName(name) || len(name) > 80 {
		return fmt.Errorf("invalid office project or name")
	}
	bind, _, e := net.SplitHostPort(listen)
	ip := net.ParseIP(bind)
	if e != nil || ip == nil || !(ip.IsUnspecified() || ip.IsLoopback() || lanIP(ip)) {
		return fmt.Errorf("LAN host must bind a private, wildcard or loopback IP")
	}
	listener, e := net.Listen("tcp", listen)
	if e != nil {
		return e
	}
	defer listener.Close()
	_, port, e := net.SplitHostPort(listener.Addr().String())
	if e != nil {
		return e
	}
	i, e := LoadIdentity(filepath.Join(directory, "owner.json"))
	if os.IsNotExist(e) {
		i, e = InitHub(directory, "https://127.0.0.1:"+port, name)
	}
	if e != nil {
		return e
	}
	u, _ := url.Parse(i.URL)
	if u.Port() != port {
		return fmt.Errorf("existing host port retained; use original listener port")
	}
	h, e := OpenHub(directory)
	if e != nil {
		return e
	}
	defer h.Close()
	cert, key, pin, e := prepareTLS(directory, i.URL)
	if e != nil {
		return e
	}
	if i.TLSFingerprint != "" && i.TLSFingerprint != pin {
		return fmt.Errorf("original TLS identity retained")
	}
	i.TLSFingerprint = pin
	if e = writeJSON(filepath.Join(directory, "owner.json"), i); e != nil {
		return e
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	s := &LANHost{Hub: h, Owner: i, ControlURL: controlURL, Project: project, Directory: directory, seen: map[string]time.Time{}, HTTP: &http.Client{Transport: transport, Timeout: 20 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
	defer s.HTTP.CloseIdleConnections()
	server := &http.Server{Handler: s, TLSConfig: &tls.Config{MinVersion: tls.VersionTLS12}, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 30 * time.Second, MaxHeaderBytes: 8192}
	server.BaseContext = func(net.Listener) context.Context { return ctx }
	defer server.Close()
	done := make(chan error, 1)
	go func() { done <- server.ServeTLS(listener, cert, key) }()
	announcement, advertiseErr := advertiseAutoLAN(i, listener.Addr())
	if announcement != nil {
		defer announcement.Shutdown()
	}
	numericPort := listener.Addr().(*net.TCPAddr).Port
	probe, probeErr := serveLANProbe(ctx, i, numericPort)
	if probe != nil {
		defer probe.Close()
	}
	encoder := json.NewEncoder(out)
	ready := s.snapshot()
	ready["listen"] = listener.Addr().String()
	ready["mdns"] = advertiseErr == nil
	ready["broadcast"] = probeErr == nil
	if e = encoder.Encode(ready); e != nil {
		server.Close()
		return e
	}
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			stop, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			return server.Shutdown(stop)
		case e := <-done:
			if e == http.ErrServerClosed {
				return nil
			}
			return e
		case <-ticker.C:
			if e = encoder.Encode(s.snapshot()); e != nil {
				server.Close()
				return e
			}
		}
	}
}

type LANPeer struct {
	HostID   string   `json:"host_id"`
	Identity Identity `json:"identity"`
	Token    string   `json:"token"`
	Project  string   `json:"project,omitempty"`
	Enrolled bool     `json:"enrolled"`
}

func connectLAN(ctx context.Context, directory, name string, candidate LANCandidate) (LANPeer, error) {
	var peer LANPeer
	if !validAutoCandidate(candidate) {
		return peer, fmt.Errorf("invalid local office candidate")
	}
	file := filepath.Join(directory, "peers", candidate.HostID, "peer.json")
	if b, e := os.ReadFile(file); e == nil {
		if json.Unmarshal(b, &peer) != nil || peer.HostID != candidate.HostID || peer.Identity.TLSFingerprint != candidate.Pin {
			return peer, fmt.Errorf("original peer identity retained")
		}
		if _, e := peer.Identity.key(); e != nil {
			return peer, e
		}
		if raw, e := base64.RawURLEncoding.DecodeString(peer.Token); e != nil || len(raw) != 32 {
			return peer, fmt.Errorf("retained worker credential invalid")
		}
		peer.Identity.URL = candidate.URL
	} else if !os.IsNotExist(e) {
		return peer, e
	} else {
		i, _, e := newIdentity(candidate.URL, name)
		if e != nil {
			return peer, e
		}
		i.TLSFingerprint = candidate.Pin
		var token [32]byte
		if _, e = rand.Read(token[:]); e != nil {
			return peer, e
		}
		peer = LANPeer{HostID: candidate.HostID, Identity: i, Token: base64.RawURLEncoding.EncodeToString(token[:])}
		if e = writeJSON(file, peer); e != nil {
			return peer, e
		}
	}
	c, e := NewClient(peer.Identity)
	if e != nil {
		return peer, e
	}
	defer c.HTTP.CloseIdleConnections()
	key, _ := peer.Identity.key()
	d := Device{ID: peer.Identity.ID, Name: peer.Identity.Name, PublicKey: base64.StdEncoding.EncodeToString(key.Public().(ed25519.PublicKey))}
	var paired struct {
		HostID   string `json:"host_id"`
		Protocol string `json:"protocol"`
		Project  string `json:"project"`
	}
	if e = c.Call(ctx, "/v1/lan/pair", map[string]Device{"device": d}, &paired); e != nil {
		return peer, e
	}
	if paired.HostID != candidate.HostID || paired.Protocol != LANProtocol {
		return peer, fmt.Errorf("LAN host identity mismatch")
	}
	if !validID(paired.Project) || peer.Project != "" && peer.Project != paired.Project {
		return peer, fmt.Errorf("original office project retained")
	}
	peer.Project = paired.Project
	if e = writeJSON(file, peer); e != nil {
		return peer, e
	}
	var enrolled struct {
		State   string `json:"state"`
		HostID  string `json:"host_id"`
		Project string `json:"project"`
	}
	if e = c.Call(ctx, "/v1/lan/enroll", map[string]string{"token": peer.Token}, &enrolled); e != nil {
		return peer, e
	}
	if enrolled.State != "ready" || enrolled.HostID != peer.HostID || enrolled.Project != peer.Project {
		return peer, fmt.Errorf("worker enrollment unconfirmed")
	}
	peer.Enrolled = true
	if e = writeJSON(file, peer); e != nil {
		return peer, e
	}
	return peer, nil
}

type LANProxy struct {
	mu            sync.RWMutex
	Client        *Client
	Token, Origin string
	Slots         chan struct{}
}

func (p *LANProxy) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	fail := func(status int, code string) {
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(map[string]string{"code": code})
	}
	if r.Host != strings.TrimPrefix(p.Origin, "http://") || r.Header.Get("Origin") != "" || r.Header.Get("Sec-Fetch-Site") != "" || len(r.TransferEncoding) > 0 {
		fail(403, "link_native_requests_only")
		return
	}
	for _, key := range []string{"Authorization", "Content-Type", "Content-Length"} {
		if len(r.Header.Values(key)) > 1 {
			fail(400, "duplicate_header")
			return
		}
	}
	body, e := io.ReadAll(io.LimitReader(r.Body, 32769))
	if e != nil || len(body) > 32768 {
		fail(413, "body_limit")
		return
	}
	p.mu.RLock()
	c, token := p.Client, p.Token
	p.mu.RUnlock()
	if c == nil {
		fail(503, "link_scanning")
		return
	}
	if r.Header.Get("Authorization") != "Bearer "+token {
		fail(401, "agent_unauthorized")
		return
	}
	req := ControlRequest{Method: r.Method, Path: r.URL.RequestURI(), Token: token, Body: body, Deadline: time.Now().Add(25 * time.Second).Unix()}
	if !allowedControl(req, false) {
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
	var response ControlResponse
	if e = c.Call(r.Context(), "/v1/lan/agent", req, &response); e != nil {
		fail(503, "connection_unconfirmed_query_original_request")
		return
	}
	if response.Status < 200 || response.Status > 599 || !json.Valid(response.Body) {
		fail(502, "link_invalid_response")
		return
	}
	w.WriteHeader(response.Status)
	_, _ = w.Write(response.Body)
}

func RunLAN(ctx context.Context, directory, listen, name string, out io.Writer) error {
	return runLAN(ctx, directory, listen, name, out, DiscoverAutoLAN)
}

func runLAN(ctx context.Context, directory, listen, name string, out io.Writer, discover func(context.Context, time.Duration) (LANScan, error)) error {
	if !validLANName(name) || len(name) > 80 {
		return fmt.Errorf("device name must be 1-80 UTF-8 bytes")
	}
	host, _, e := net.SplitHostPort(listen)
	if e != nil || host != "127.0.0.1" {
		return fmt.Errorf("agent gateway must bind 127.0.0.1")
	}
	if e = os.MkdirAll(directory, 0700); e != nil {
		return e
	}
	lock, e := os.OpenFile(filepath.Join(directory, "client.lock"), os.O_CREATE|os.O_RDWR, 0600)
	if e != nil {
		return e
	}
	defer lock.Close()
	if e = lockFile(lock); e != nil {
		return fmt.Errorf("LAN client already running")
	}
	defer unlockFile(lock)
	l, e := net.Listen("tcp", listen)
	if e != nil {
		return e
	}
	defer l.Close()
	origin := "http://" + l.Addr().String()
	proxy := &LANProxy{Origin: origin, Slots: make(chan struct{}, 16)}
	server := &http.Server{Handler: proxy, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 30 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 30 * time.Second, MaxHeaderBytes: 8192}
	server.BaseContext = func(net.Listener) context.Context { return ctx }
	defer func() {
		stop, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = server.Shutdown(stop)
		_ = server.Close()
	}()
	done := make(chan error, 1)
	go func() { done <- server.Serve(l) }()
	encoder := json.NewEncoder(out)
	emit := func(value map[string]any) error {
		value["observed_at"] = now()
		if e := writeJSON(filepath.Join(directory, "status.json"), value); e != nil {
			return e
		}
		return encoder.Encode(value)
	}
	defer func() { _ = emit(map[string]any{"state": "stopped", "protocol": LANProtocol, "url": origin}) }()
	var current LANPeer
	var active *Client
	defer func() {
		if active != nil {
			active.HTTP.CloseIdleConnections()
		}
	}()
	// Retain the selected office across restart; never silently move credentials
	// or a native session to a different office when discovery ordering changes.
	selectedFile := filepath.Join(directory, "selected.json")
	var selected struct {
		HostID string `json:"host_id"`
		Pin    string `json:"tls_fingerprint"`
	}
	if b, e := os.ReadFile(selectedFile); e == nil {
		if json.Unmarshal(b, &selected) != nil || !validHex(selected.HostID, 16) || !validHex(selected.Pin, 32) {
			return fmt.Errorf("selected office invalid; retained")
		}
	} else if !os.IsNotExist(e) {
		return e
	}
	if selected.HostID != "" {
		b, e := os.ReadFile(filepath.Join(directory, "peers", selected.HostID, "peer.json"))
		if e != nil || json.Unmarshal(b, &current) != nil || current.HostID != selected.HostID || current.Identity.TLSFingerprint != selected.Pin {
			return fmt.Errorf("selected peer unavailable; original identity retained")
		}
		candidate := LANCandidate{HostID: current.HostID, Name: current.Identity.Name, URL: current.Identity.URL, Pin: current.Identity.TLSFingerprint}
		if !validAutoCandidate(candidate) {
			return fmt.Errorf("retained office endpoint invalid")
		}
	}
	setConnected := func(peer LANPeer) error {
		c, e := NewClient(peer.Identity)
		if e != nil {
			return e
		}
		credential := map[string]any{"protocol": "aieyra-agent/1", "url": origin, "token": peer.Token, "project": peer.Project, "host_id": peer.HostID}
		if e = writeJSON(filepath.Join(directory, "agent.json"), credential); e != nil {
			c.HTTP.CloseIdleConnections()
			return e
		}
		if active != nil {
			active.HTTP.CloseIdleConnections()
		}
		active = c
		proxy.mu.Lock()
		proxy.Client = c
		proxy.Token = peer.Token
		proxy.mu.Unlock()
		return emit(map[string]any{"state": "connected", "protocol": LANProtocol, "url": origin, "project": peer.Project, "host_id": peer.HostID, "credential_file": filepath.Join(directory, "agent.json")})
	}
	connected := false
	for ctx.Err() == nil {
		if current.HostID != "" && current.Enrolled {
			c, e := NewClient(current.Identity)
			if e != nil {
				return e
			}
			ping, cancel := context.WithTimeout(ctx, 4*time.Second)
			var receipt struct {
				Protocol string `json:"protocol"`
				HostID   string `json:"host_id"`
				Project  string `json:"project"`
			}
			e = c.Call(ping, "/v1/lan/ping", nil, &receipt)
			cancel()
			c.HTTP.CloseIdleConnections()
			if e == nil && receipt.Protocol == LANProtocol && receipt.HostID == current.HostID && receipt.Project == current.Project && current.Project != "" {
				if !connected {
					if e = setConnected(current); e != nil {
						return e
					}
				}
				connected = true
			} else {
				connected = false
				proxy.mu.Lock()
				proxy.Client = nil
				proxy.mu.Unlock()
			}
		}
		if !connected {
			if e = emit(map[string]any{"state": "scanning", "protocol": LANProtocol, "url": origin}); e != nil {
				return e
			}
			scan, _ := discover(ctx, 3*time.Second)
			for _, candidate := range scan.Candidates {
				if ctx.Err() != nil {
					break
				}
				if selected.HostID != "" && (selected.HostID != candidate.HostID || selected.Pin != candidate.Pin) {
					continue
				}
				attempt, cancel := context.WithTimeout(ctx, 12*time.Second)
				peer, err := connectLAN(attempt, directory, name, candidate)
				cancel()
				// Only a verified TLS+protocol receipt selects an office. An old
				// unrelated announcement cannot trap the client permanently.
				if selected.HostID == "" && peer.Project != "" {
					selected.HostID = candidate.HostID
					selected.Pin = candidate.Pin
					if e = writeJSON(selectedFile, selected); e != nil {
						return e
					}
				}
				if err != nil {
					if e = emit(map[string]any{"state": "waiting", "error": err.Error(), "host_id": candidate.HostID}); e != nil {
						return e
					}
					continue
				}
				current = peer
				if e = setConnected(peer); e != nil {
					return e
				}
				connected = true
				break
			}
		}
		if connected {
			if e = emit(map[string]any{"state": "connected", "protocol": LANProtocol, "url": origin, "project": current.Project, "host_id": current.HostID}); e != nil {
				return e
			}
		}
		select {
		case <-ctx.Done():
			return nil
		case e := <-done:
			if e == http.ErrServerClosed {
				return nil
			}
			return e
		case <-time.After(8 * time.Second):
		}
	}
	return nil
}

// Keep discovery endpoint parsing stricter than the legacy generic URL parser.
func validAutoCandidate(c LANCandidate) bool {
	u, e := url.Parse(c.URL)
	if e != nil {
		return false
	}
	return u.Scheme == "https" && u.User == nil && u.Path == "" && u.RawQuery == "" && u.Fragment == "" && lanIP(net.ParseIP(u.Hostname())) && u.Port() != "" && validHex(c.HostID, 16) && validHex(c.Pin, 32) && validLANName(c.Name)
}

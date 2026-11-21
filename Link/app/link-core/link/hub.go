// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Link/app/link-core/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: invitation; hubState; Hub; InitHub; OpenHub; Close; proof; authenticate; ServeHTTP; decode; emit; dispatch
// Impact: python -B scripts/code-atlas.py show Link/app/link-core/link/hub.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package link

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

type invitation struct {
	Expires int64  `json:"expires"`
	UsedBy  string `json:"used_by,omitempty"`
}
type hubState struct {
	Schema    string                  `json:"schema"`
	Devices   map[string]Device       `json:"devices"`
	Invites   map[string]invitation   `json:"invites"`
	Sessions  map[string]Session      `json:"sessions"`
	Messages  map[string]Message      `json:"messages"`
	Nonces    map[string]int64        `json:"nonces"`
	Events    []Event                 `json:"events"`
	Sequence  uint64                  `json:"sequence"`
	Answers   map[string]Answer       `json:"answers,omitempty"`
	Services  map[string]RelayService `json:"control_services,omitempty"`
	RelayJobs map[string]RelayJob     `json:"control_requests,omitempty"`
}

type Hub struct {
	mu     sync.Mutex
	path   string
	lock   *os.File
	state  hubState
	closed bool
}

func InitHub(directory, endpoint, name string) (Identity, error) {
	identity, device, e := newIdentity(endpoint, name)
	if e != nil {
		return Identity{}, e
	}
	if e = os.MkdirAll(directory, 0700); e != nil {
		return Identity{}, e
	}
	file, e := os.OpenFile(filepath.Join(directory, "hub.lock"), os.O_CREATE|os.O_RDWR, 0600)
	if e != nil {
		return Identity{}, e
	}
	defer file.Close()
	if e = lockFile(file); e != nil {
		return Identity{}, fmt.Errorf("hub is in use")
	}
	defer unlockFile(file)
	for _, name := range []string{"hub.json", "owner.json"} {
		if _, e = os.Stat(filepath.Join(directory, name)); e == nil {
			return Identity{}, fmt.Errorf("existing hub or identity retained; use serve")
		}
		if !os.IsNotExist(e) {
			return Identity{}, e
		}
	}
	device.Admin = true
	state := hubState{Schema: protocol, Devices: map[string]Device{device.ID: device}, Invites: map[string]invitation{}, Sessions: map[string]Session{}, Messages: map[string]Message{}, Nonces: map[string]int64{}, Events: []Event{}}
	// 先保存私钥；任何后续失败都保留它，不能重建另一套拥有者身份。
	if e = writeJSON(filepath.Join(directory, "owner.json"), identity); e != nil {
		return Identity{}, e
	}
	if e = writeJSON(filepath.Join(directory, "hub.json"), state); e != nil {
		return Identity{}, e
	}
	return identity, nil
}

func OpenHub(directory string) (*Hub, error) {
	f, e := os.OpenFile(filepath.Join(directory, "hub.lock"), os.O_CREATE|os.O_RDWR, 0600)
	if e != nil {
		return nil, e
	}
	if e = lockFile(f); e != nil {
		f.Close()
		return nil, fmt.Errorf("this hub already has an owner process")
	}
	h := &Hub{path: filepath.Join(directory, "hub.json"), lock: f}
	b, e := os.ReadFile(h.path)
	if e == nil {
		e = json.Unmarshal(b, &h.state)
	}
	if e == nil && (h.state.Schema != protocol || h.state.Devices == nil || h.state.Invites == nil || h.state.Messages == nil || h.state.Sessions == nil || h.state.Nonces == nil) {
		e = fmt.Errorf("invalid hub state; original retained")
	}
	if e != nil {
		h.Close()
		return nil, e
	}
	return h, nil
}

func (h *Hub) Close() {
	h.mu.Lock()
	defer h.mu.Unlock()
	if !h.closed {
		h.closed = true
		unlockFile(h.lock)
		_ = h.lock.Close()
	}
}

func proof(method, path, stamp, nonce string, body []byte) []byte {
	return []byte(strings.Join([]string{protocol, method, path, stamp, nonce, hash(body)}, "\n"))
}

func (h *Hub) authenticate(r *http.Request, body []byte) (Device, error) {
	id := r.Header.Get("X-Link-Device")
	device, ok := h.state.Devices[id]
	if r.URL.Path == "/v1/pair" || r.URL.Path == "/v1/lan/pair" {
		var p struct {
			Device Device `json:"device"`
		}
		if json.Unmarshal(body, &p) != nil {
			return Device{}, fmt.Errorf("invalid pairing")
		}
		device = p.Device
		ok = device.ID == id && !device.Admin && !device.Revoked
	}
	pub, e := base64.StdEncoding.DecodeString(device.PublicKey)
	if !ok || device.Revoked || e != nil || len(pub) != ed25519.PublicKeySize || hash(pub)[:32] != device.ID {
		return Device{}, fmt.Errorf("unknown or revoked device")
	}
	stamp, nonce := r.Header.Get("X-Link-Time"), r.Header.Get("X-Link-Nonce")
	t, e := strconv.ParseInt(stamp, 10, 64)
	current := time.Now().Unix()
	if e != nil || t < current-120 || t > current+120 || len(nonce) != 64 || !validID(nonce) {
		return Device{}, fmt.Errorf("expired or invalid proof")
	}
	for n, expiry := range h.state.Nonces {
		if expiry < current {
			delete(h.state.Nonces, n)
		}
	}
	if _, exists := h.state.Nonces[id+":"+nonce]; exists {
		return Device{}, fmt.Errorf("proof already used")
	}
	sig, e := base64.StdEncoding.DecodeString(r.Header.Get("X-Link-Signature"))
	if e != nil || !ed25519.Verify(pub, proof(r.Method, r.URL.RequestURI(), stamp, nonce, body), sig) {
		return Device{}, fmt.Errorf("invalid proof")
	}
	if len(h.state.Nonces) >= 20000 {
		return Device{}, fmt.Errorf("proof capacity reached; retry later")
	}
	h.state.Nonces[id+":"+nonce] = current + 240
	return device, nil
}

func (h *Hub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	locked := false
	respond := func(code int, data any, err error) {
		var payload []byte
		if err != nil {
			payload, _ = json.Marshal(map[string]any{"ok": false, "error": err.Error()})
		} else {
			payload, _ = json.Marshal(map[string]any{"ok": true, "data": data})
		}
		// Snapshot under the lock, then allow other devices to proceed while a
		// slow connection receives its response.
		if locked {
			h.mu.Unlock()
			locked = false
		}
		w.WriteHeader(code)
		_, _ = w.Write(append(payload, '\n'))
	}
	if r.Method != "POST" || r.URL.RawQuery != "" || r.Header.Get("Origin") != "" || r.Header.Get("Sec-Fetch-Site") != "" {
		respond(403, nil, fmt.Errorf("signed native requests only"))
		return
	}
	limit := int64(1 << 20)
	if r.URL.Path == "/v1/control/receipt" {
		limit = 13 << 20
	}
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	body, e := io.ReadAll(r.Body)
	if e != nil || !json.Valid(body) {
		respond(400, nil, fmt.Errorf("invalid JSON request"))
		return
	}
	h.mu.Lock()
	locked = true
	defer func() {
		if locked {
			h.mu.Unlock()
		}
	}()
	if h.closed {
		respond(503, nil, fmt.Errorf("hub closed"))
		return
	}
	// 只读查询与在线观察不改变受理事实，避免每次轮询重写密文队列。
	// 重启后重放这些读取没有副作用；写入请求的 nonce 仍随状态持久化。
	if r.URL.Path == "/v1/control/catalog" || r.URL.Path == "/v1/control/result" || r.URL.Path == "/v1/control/poll" {
		device, err := h.authenticate(r, body)
		if err != nil {
			respond(401, nil, err)
			return
		}
		data, err := h.dispatch(device, r.URL.Path, body)
		if err != nil {
			respond(409, nil, err)
			return
		}
		respond(200, data, nil)
		return
	}
	// 落盘失败时回滚内存，不能把未持久化受理冒充成功。
	before, _ := json.Marshal(h.state)
	restore := func() { h.state = hubState{}; _ = json.Unmarshal(before, &h.state) }
	device, e := h.authenticate(r, body)
	if e != nil {
		restore()
		respond(401, nil, e)
		return
	}
	data, e := h.dispatch(device, r.URL.Path, body)
	if e != nil {
		restore()
		respond(409, nil, e)
		return
	}
	if e = writeJSON(h.path, h.state); e != nil {
		restore()
		respond(500, nil, fmt.Errorf("state not saved"))
		return
	}
	respond(200, data, nil)
}

func decode(b []byte, p any) error {
	d := json.NewDecoder(strings.NewReader(string(b)))
	d.DisallowUnknownFields()
	return d.Decode(p)
}
func (h *Hub) emit(kind, id, state string) {
	h.state.Sequence++
	h.state.Events = append(h.state.Events, Event{h.state.Sequence, kind, id, state, now()})
}
func (h *Hub) dispatch(device Device, path string, body []byte) (any, error) {
	if strings.HasPrefix(path, "/v1/control/") {
		return h.relay(device, path, body)
	}
	switch path {
	case "/v1/pair":
		var p struct {
			Invite string `json:"invite"`
			Device Device `json:"device"`
		}
		if e := decode(body, &p); e != nil {
			return nil, e
		}
		key := hash([]byte(p.Invite))
		invite, ok := h.state.Invites[key]
		if !ok || invite.Expires < time.Now().Unix() || invite.UsedBy != "" && invite.UsedBy != device.ID {
			return nil, fmt.Errorf("invite unavailable")
		}
		if existing, ok := h.state.Devices[device.ID]; ok {
			if existing.Revoked || existing.PublicKey != device.PublicKey {
				return nil, fmt.Errorf("device cannot be paired")
			}
			if invite.UsedBy == device.ID {
				return existing, nil
			}
			return nil, fmt.Errorf("device already paired")
		}
		if len(h.state.Devices) >= 64 || strings.TrimSpace(device.Name) == "" || len(device.Name) > 120 {
			return nil, fmt.Errorf("invalid device or device capacity reached")
		}
		invite.UsedBy = device.ID
		h.state.Invites[key] = invite
		h.state.Devices[device.ID] = device
		h.emit("device", device.ID, "paired")
		return device, nil
	case "/v1/invites":
		if !device.Admin {
			return nil, fmt.Errorf("owner device required")
		}
		for k, v := range h.state.Invites {
			if v.Expires < time.Now().Unix() {
				delete(h.state.Invites, k)
			}
		}
		if len(h.state.Invites) >= 64 {
			return nil, fmt.Errorf("too many pending invitations")
		}
		invite := randomID()
		expires := time.Now().Add(10 * time.Minute).Unix()
		h.state.Invites[hash([]byte(invite))] = invitation{Expires: expires}
		return map[string]any{"invite": invite, "expires_unix": expires}, nil
	case "/v1/revoke":
		var p struct {
			ID string `json:"device_id"`
		}
		if e := decode(body, &p); e != nil {
			return nil, e
		}
		if !device.Admin || p.ID == device.ID {
			return nil, fmt.Errorf("owner must revoke a different device")
		}
		d, ok := h.state.Devices[p.ID]
		if !ok {
			return nil, fmt.Errorf("unknown device")
		}
		d.Revoked = true
		h.state.Devices[p.ID] = d
		h.emit("device", d.ID, "revoked")
		return d, nil
	case "/v1/catalog":
		devices := []Device{}
		sessions := []Session{}
		for _, d := range h.state.Devices {
			devices = append(devices, d)
		}
		for _, s := range h.state.Sessions {
			updated, err := time.Parse(time.RFC3339Nano, s.UpdatedAt)
			if h.state.Devices[s.DeviceID].Revoked || err != nil || time.Since(updated) > 45*time.Second {
				s.State = "offline"
			}
			sessions = append(sessions, s)
		}
		sort.Slice(devices, func(i, j int) bool { return devices[i].ID < devices[j].ID })
		sort.Slice(sessions, func(i, j int) bool { return sessions[i].ID < sessions[j].ID })
		return map[string]any{"devices": devices, "sessions": sessions, "cursor": h.state.Sequence, "presence": "updated_at is last observation, not proof of active reasoning"}, nil
	case "/v1/attach":
		var p struct {
			LocalID string `json:"local_id"`
			Title   string `json:"title"`
			Mode    string `json:"mode"`
		}
		if e := decode(body, &p); e != nil {
			return nil, e
		}
		if !validID(p.LocalID) || len(p.Title) > 160 {
			return nil, fmt.Errorf("invalid session identity or title")
		}
		if p.Mode != "" && p.Mode != "cli" && p.Mode != "os" && p.Mode != "matrix" {
			return nil, fmt.Errorf("invalid session mode")
		}
		id := device.ID + ":" + p.LocalID
		if s, ok := h.state.Sessions[id]; ok {
			if s.Mode != "" && p.Mode != "" && s.Mode != p.Mode {
				return nil, fmt.Errorf("session mode conflicts with original execution identity")
			}
			if s.Mode == "" && p.Mode != "" {
				s.Mode = p.Mode
				h.state.Sessions[id] = s
			}
			return s, nil
		}
		if len(h.state.Sessions) >= 1000 {
			return nil, fmt.Errorf("session directory capacity reached")
		}
		s := Session{ID: id, DeviceID: device.ID, LocalID: p.LocalID, Title: p.Title, State: "attached", UpdatedAt: now(), Mode: p.Mode}
		h.state.Sessions[id] = s
		h.emit("session", id, s.State)
		return s, nil
	case "/v1/session-status":
		var p struct {
			ID    string `json:"id"`
			State string `json:"state"`
		}
		if e := decode(body, &p); e != nil {
			return nil, e
		}
		s, ok := h.state.Sessions[p.ID]
		if !ok || s.DeviceID != device.ID {
			return nil, fmt.Errorf("only the execution owner can update this session")
		}
		switch p.State {
		case "idle", "busy", "waiting_user", "offline":
		default:
			return nil, fmt.Errorf("invalid session state")
		}
		changed := s.State != p.State
		s.State = p.State
		s.UpdatedAt = now()
		h.state.Sessions[s.ID] = s
		if changed {
			h.emit("session", s.ID, s.State)
		}
		return s, nil
	case "/v1/send":
		var p struct {
			SessionID string `json:"session_id"`
			RequestID string `json:"request_id"`
			Text      string `json:"text"`
		}
		if e := decode(body, &p); e != nil {
			return nil, e
		}
		if !validID(p.RequestID) || strings.TrimSpace(p.Text) == "" || len(p.Text) > 64<<10 {
			return nil, fmt.Errorf("request ID and 1–64 KiB text required")
		}
		if _, ok := h.state.Sessions[p.SessionID]; !ok {
			return nil, fmt.Errorf("unknown session")
		}
		id := hash([]byte(device.ID + "\n" + p.RequestID))
		if m, ok := h.state.Messages[id]; ok {
			if m.SessionID != p.SessionID || m.Text != p.Text {
				return nil, fmt.Errorf("request ID conflicts with prior content")
			}
			return m, nil
		}
		if len(h.state.Messages) >= 10000 {
			return nil, fmt.Errorf("message storage capacity reached")
		}
		m := Message{ID: id, SessionID: p.SessionID, SenderID: device.ID, RequestID: p.RequestID, CoreRequestID: "link-" + id, Text: p.Text, State: "received", CreatedAt: now(), UpdatedAt: now()}
		h.state.Messages[id] = m
		h.emit("message", m.ID, m.State)
		return m, nil
	case "/v1/messages":
		var p struct {
			SessionID string `json:"session_id"`
			Pending   bool   `json:"pending"`
			ID        string `json:"id"`
		}
		if e := decode(body, &p); e != nil {
			return nil, e
		}
		if p.ID != "" {
			m, ok := h.state.Messages[p.ID]
			if !ok {
				return nil, fmt.Errorf("unknown message")
			}
			return m, nil
		}
		if _, ok := h.state.Sessions[p.SessionID]; !ok {
			return nil, fmt.Errorf("unknown session")
		}
		rows := []Message{}
		for _, m := range h.state.Messages {
			if m.SessionID == p.SessionID && (!p.Pending || !finalState(m.State)) {
				rows = append(rows, m)
			}
		}
		sort.Slice(rows, func(i, j int) bool {
			if p.Pending && rows[i].CancelRequested != rows[j].CancelRequested {
				return rows[i].CancelRequested
			}
			if rows[i].CreatedAt == rows[j].CreatedAt {
				return rows[i].ID < rows[j].ID
			}
			return rows[i].CreatedAt < rows[j].CreatedAt
		})
		if len(rows) > 100 {
			rows = rows[:100]
		}
		return rows, nil
	case "/v1/receipt":
		var p struct {
			ID    string         `json:"id"`
			State string         `json:"state"`
			Reply string         `json:"reply"`
			Error string         `json:"error"`
			Human *HumanQuestion `json:"human"`
		}
		if e := decode(body, &p); e != nil {
			return nil, e
		}
		m, ok := h.state.Messages[p.ID]
		s := h.state.Sessions[m.SessionID]
		if !ok || s.DeviceID != device.ID {
			return nil, fmt.Errorf("only the execution owner can record results")
		}
		if len(p.Reply) > 512<<10 || len(p.Error) > 64<<10 {
			return nil, fmt.Errorf("result exceeds size limit")
		}
		if p.Human != nil && (p.State != "waiting_user" || p.Human.SessionID != s.LocalID || !validID(p.Human.ID) || p.Human.Version < 1 || p.Human.Generation < 1 || len(p.Human.Token) != 64) {
			return nil, fmt.Errorf("invalid original human decision binding")
		}
		if finalState(m.State) {
			if m.State != p.State || m.Reply != p.Reply || m.Error != p.Error {
				return nil, fmt.Errorf("completed receipt is immutable")
			}
			return m, nil
		}
		if p.State != "accepted" && p.State != "running" && p.State != "waiting_user" && !finalState(p.State) {
			return nil, fmt.Errorf("invalid receipt state")
		}
		if (m.State == "running" || m.State == "waiting_user") && p.State == "accepted" {
			return m, nil
		}
		oldHuman, _ := json.Marshal(m.Human)
		newHuman, _ := json.Marshal(p.Human)
		if m.State == p.State && m.Reply == p.Reply && m.Error == p.Error && string(oldHuman) == string(newHuman) {
			return m, nil
		}
		m.State = p.State
		m.Reply = p.Reply
		m.Error = p.Error
		m.Human = p.Human
		m.UpdatedAt = now()
		h.state.Messages[m.ID] = m
		h.emit("message", m.ID, m.State)
		return m, nil
	case "/v1/cancel", "/v1/answer", "/v1/answers", "/v1/answer-receipt":
		return h.decisions(device, path, body)
	case "/v1/events":
		var p struct {
			After uint64 `json:"after"`
		}
		if e := decode(body, &p); e != nil {
			return nil, e
		}
		if p.After > h.state.Sequence {
			return nil, fmt.Errorf("cursor is ahead of this hub")
		}
		rows := []Event{}
		cursor := p.After
		for _, event := range h.state.Events {
			if event.Sequence > p.After {
				rows = append(rows, event)
				cursor = event.Sequence
				if len(rows) == 100 {
					break
				}
			}
		}
		return map[string]any{"events": rows, "next_cursor": cursor, "has_more": cursor < h.state.Sequence}, nil
	default:
		return nil, fmt.Errorf("unknown endpoint")
	}
}

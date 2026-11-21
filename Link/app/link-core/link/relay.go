// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Link/app/link-core/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: RelayService; RelayJob; relayRetention; relayBytes; relay
// Impact: python -B scripts/code-atlas.py show Link/app/link-core/link/relay.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package link

import (
	"fmt"
	"sort"
	"time"
)

type RelayService struct {
	ID         string `json:"id"`
	DeviceID   string `json:"device_id"`
	Name       string `json:"name"`
	PublicKey  string `json:"public_key"`
	SigningKey string `json:"signing_key"`
	Signature  string `json:"signature"`
	UpdatedAt  string `json:"updated_at"`
	State      string `json:"state"`
}
type RelayJob struct {
	ID         string `json:"id"`
	ServiceID  string `json:"service_id"`
	SenderID   string `json:"sender_id"`
	RequestID  string `json:"request_id"`
	PublicKey  string `json:"public_key"`
	SigningKey string `json:"signing_key"`
	Signature  string `json:"signature"`
	Payload    string `json:"payload"`
	Response   string `json:"response,omitempty"`
	State      string `json:"state"`
	CreatedAt  int64  `json:"created_at"`
}

const relayRetention = 10 * time.Minute

func (h *Hub) relayBytes() int {
	n := 0
	for _, j := range h.state.RelayJobs {
		n += len(j.Payload) + len(j.Response)
	}
	return n
}

func (h *Hub) relay(device Device, path string, body []byte) (any, error) {
	if h.state.Services == nil {
		h.state.Services = map[string]RelayService{}
	}
	if h.state.RelayJobs == nil {
		h.state.RelayJobs = map[string]RelayJob{}
	}
	switch path {
	case "/v1/control/register":
		var p struct {
			Name       string `json:"name"`
			PublicKey  string `json:"public_key"`
			SigningKey string `json:"signing_key"`
			Signature  string `json:"signature"`
		}
		if e := decode(body, &p); e != nil {
			return nil, e
		}
		if len(p.Name) == 0 || len(p.Name) > 120 || !verifyEncryptionProof(device.ID, p.PublicKey, p.SigningKey, p.Signature) {
			return nil, fmt.Errorf("invalid Control service")
		}
		id := device.ID + ":control"
		if old, ok := h.state.Services[id]; ok && old.PublicKey != p.PublicKey {
			return nil, fmt.Errorf("Control identity changed; retain the original private key")
		}
		s := RelayService{ID: id, DeviceID: device.ID, Name: p.Name, PublicKey: p.PublicKey, SigningKey: p.SigningKey, Signature: p.Signature, UpdatedAt: now(), State: "online"}
		h.state.Services[id] = s
		return s, nil
	case "/v1/control/catalog":
		rows := []RelayService{}
		for _, s := range h.state.Services {
			t, e := time.Parse(time.RFC3339Nano, s.UpdatedAt)
			if h.state.Devices[s.DeviceID].Revoked || e != nil || time.Since(t) > 45*time.Second {
				s.State = "offline"
			}
			rows = append(rows, s)
		}
		sort.Slice(rows, func(i, j int) bool { return rows[i].ID < rows[j].ID })
		return map[string]any{"services": rows, "protocol": "aieyra-control-relay/1"}, nil
	case "/v1/control/send":
		var p RelayJob
		if e := decode(body, &p); e != nil {
			return nil, e
		}
		service, ok := h.state.Services[p.ServiceID]
		if !ok || h.state.Devices[service.DeviceID].Revoked {
			return nil, fmt.Errorf("Control service unavailable")
		}
		if !validID(p.RequestID) || !verifyEncryptionProof(device.ID, p.PublicKey, p.SigningKey, p.Signature) || len(p.Payload) == 0 || len(p.Payload) > 128*1024 || p.Response != "" || p.ID != "" || p.State != "" || p.SenderID != "" || p.CreatedAt != 0 {
			return nil, fmt.Errorf("invalid relay request")
		}
		p.ID = hash([]byte(device.ID + ":" + p.RequestID))
		p.SenderID = device.ID
		if old, ok := h.state.RelayJobs[p.ID]; ok {
			if old.ServiceID != p.ServiceID || old.Payload != p.Payload || old.PublicKey != p.PublicKey {
				return nil, fmt.Errorf("relay request ID conflict")
			}
			return old, nil
		}
		// Control 的原 request_id 账本保留权威结果；中继仅短期保存密文回执。
		for id, j := range h.state.RelayJobs {
			if j.CreatedAt < time.Now().Add(-relayRetention).Unix() {
				delete(h.state.RelayJobs, id)
			}
		}
		if len(h.state.RelayJobs) >= 2000 || h.relayBytes()+len(p.Payload) > 64<<20 {
			return nil, fmt.Errorf("relay queue full; retrieve pending receipts")
		}
		p.State = "queued"
		p.CreatedAt = time.Now().Unix()
		h.state.RelayJobs[p.ID] = p
		return p, nil
	case "/v1/control/poll":
		id := device.ID + ":control"
		s, ok := h.state.Services[id]
		if !ok {
			return nil, fmt.Errorf("register Control first")
		}
		s.UpdatedAt = now()
		s.State = "online"
		h.state.Services[id] = s
		rows := []RelayJob{}
		for _, j := range h.state.RelayJobs {
			if j.ServiceID == id && j.State == "queued" && j.CreatedAt >= time.Now().Add(-30*time.Second).Unix() && !h.state.Devices[j.SenderID].Revoked {
				rows = append(rows, j)
			}
		}
		sort.Slice(rows, func(i, j int) bool {
			if rows[i].CreatedAt == rows[j].CreatedAt {
				return rows[i].ID < rows[j].ID
			}
			return rows[i].CreatedAt < rows[j].CreatedAt
		})
		if len(rows) > 32 {
			rows = rows[:32]
		}
		return map[string]any{"requests": rows}, nil
	case "/v1/control/result":
		var p struct {
			ID string `json:"id"`
		}
		if e := decode(body, &p); e != nil {
			return nil, e
		}
		j, ok := h.state.RelayJobs[p.ID]
		if !ok || j.SenderID != device.ID {
			return nil, fmt.Errorf("relay request not found")
		}
		if j.State == "queued" && j.CreatedAt < time.Now().Add(-30*time.Second).Unix() {
			j.State = "unconfirmed"
		}
		return j, nil
	case "/v1/control/receipt":
		var p struct {
			ID       string `json:"id"`
			Response string `json:"response"`
		}
		if e := decode(body, &p); e != nil {
			return nil, e
		}
		j, ok := h.state.RelayJobs[p.ID]
		s := h.state.Services[j.ServiceID]
		if !ok || s.DeviceID != device.ID || h.state.Devices[j.SenderID].Revoked || len(p.Response) == 0 || len(p.Response) > 12*1024*1024 {
			return nil, fmt.Errorf("invalid Control receipt")
		}
		if j.State == "responded" && j.Response != p.Response {
			return nil, fmt.Errorf("Control receipt is immutable")
		}
		if h.relayBytes()-len(j.Response)+len(p.Response) > 80<<20 {
			return nil, fmt.Errorf("relay receipt capacity reached; original response retained by device")
		}
		j.State = "responded"
		j.Response = p.Response
		h.state.RelayJobs[j.ID] = j
		return map[string]any{"id": j.ID, "state": j.State}, nil
	}
	return nil, fmt.Errorf("unknown Control relay endpoint")
}

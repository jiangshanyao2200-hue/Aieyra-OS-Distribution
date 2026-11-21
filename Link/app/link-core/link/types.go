// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Link/app/link-core/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: Version; protocol; Identity; Device; Session; Message; HumanQuestion; HumanOption; Decision; Answer; Event; randomID; hash; now; validID; validURL; newIdentity; key; writeJSON; LoadIdentity; finalState
// Impact: python -B scripts/code-atlas.py show Link/app/link-core/link/types.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Package link connects explicitly selected OS sessions through a private hub.
package link

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/aieyra/aieyra-link/internal/privatefile"
)

const Version = "0.3.1"
const protocol = "aieyra-link/1"

type Identity struct {
	URL            string `json:"url"`
	ID             string `json:"device_id"`
	Name           string `json:"name"`
	PrivateKey     string `json:"private_key"`
	TLSFingerprint string `json:"tls_fingerprint,omitempty"`
}

type Device struct {
	ID        string `json:"device_id"`
	Name      string `json:"name"`
	PublicKey string `json:"public_key"`
	Admin     bool   `json:"admin"`
	Revoked   bool   `json:"revoked"`
}

type Session struct {
	ID        string `json:"id"`
	DeviceID  string `json:"device_id"`
	LocalID   string `json:"local_id"`
	Title     string `json:"title"`
	State     string `json:"state"`
	UpdatedAt string `json:"updated_at"`
	Mode      string `json:"mode,omitempty"`
}

type Message struct {
	ID              string         `json:"id"`
	SessionID       string         `json:"session_id"`
	SenderID        string         `json:"sender_id"`
	RequestID       string         `json:"request_id"`
	CoreRequestID   string         `json:"core_request_id"`
	Text            string         `json:"text"`
	State           string         `json:"state"`
	Reply           string         `json:"reply,omitempty"`
	Error           string         `json:"error,omitempty"`
	CreatedAt       string         `json:"created_at"`
	UpdatedAt       string         `json:"updated_at"`
	CancelRequested bool           `json:"cancel_requested,omitempty"`
	Human           *HumanQuestion `json:"human,omitempty"`
}

// A projection of the original core decision. All binding fields are checked
// again by the owning core; a Link receipt never grants execution authority.
type HumanQuestion struct {
	ID             string        `json:"id"`
	SessionID      string        `json:"session_id"`
	AgentID        string        `json:"agent_id"`
	Generation     int           `json:"generation"`
	Version        int           `json:"version"`
	Token          string        `json:"request_token_sha256"`
	Question       string        `json:"question"`
	Recommendation string        `json:"recommendation"`
	Impact         string        `json:"impact"`
	Options        []HumanOption `json:"options"`
	ExpiresAt      string        `json:"expires_at"`
	State          string        `json:"state"`
}
type HumanOption struct {
	ID     string `json:"id"`
	Label  string `json:"label"`
	Impact string `json:"impact"`
}
type Decision struct {
	OptionID string `json:"option_id,omitempty"`
	Text     string `json:"text,omitempty"`
}
type Answer struct {
	ID        string        `json:"id"`
	MessageID string        `json:"message_id"`
	SenderID  string        `json:"sender_id"`
	RequestID string        `json:"request_id"`
	Human     HumanQuestion `json:"human"`
	Decision  Decision      `json:"decision"`
	State     string        `json:"state"`
	Error     string        `json:"error,omitempty"`
}

type Event struct {
	Sequence uint64 `json:"sequence"`
	Kind     string `json:"kind"`
	ID       string `json:"id"`
	State    string `json:"state"`
	At       string `json:"at"`
}

func randomID() string {
	var b [32]byte
	if _, e := rand.Read(b[:]); e != nil {
		panic(e)
	}
	return hex.EncodeToString(b[:])
}
func hash(b []byte) string { s := sha256.Sum256(b); return hex.EncodeToString(s[:]) }
func now() string          { return time.Now().UTC().Format(time.RFC3339Nano) }
func validID(s string) bool {
	if len(s) < 1 || len(s) > 160 {
		return false
	}
	for _, r := range s {
		if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || strings.ContainsRune("-_.:", r)) {
			return false
		}
	}
	return true
}
func validURL(raw string) (*url.URL, error) {
	u, e := url.Parse(raw)
	if e != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Path != "" && u.Path != "/" {
		return nil, fmt.Errorf("hub URL must be an HTTPS origin or loopback HTTP origin")
	}
	ip := net.ParseIP(u.Hostname())
	if u.Scheme != "https" && !(u.Scheme == "http" && (u.Hostname() == "localhost" || ip != nil && ip.IsLoopback())) {
		return nil, fmt.Errorf("remote hub requires HTTPS; use loopback for an SSH tunnel")
	}
	return u, nil
}
func newIdentity(endpoint, name string) (Identity, Device, error) {
	if _, e := validURL(endpoint); e != nil {
		return Identity{}, Device{}, e
	}
	if strings.TrimSpace(name) == "" || len(name) > 120 {
		return Identity{}, Device{}, fmt.Errorf("device name must be 1–120 bytes")
	}
	pub, priv, e := ed25519.GenerateKey(rand.Reader)
	if e != nil {
		return Identity{}, Device{}, e
	}
	id := hash(pub)[:32]
	return Identity{URL: strings.TrimRight(endpoint, "/"), ID: id, Name: name, PrivateKey: base64.StdEncoding.EncodeToString(priv)}, Device{ID: id, Name: name, PublicKey: base64.StdEncoding.EncodeToString(pub)}, nil
}
func (i Identity) key() (ed25519.PrivateKey, error) {
	b, e := base64.StdEncoding.DecodeString(i.PrivateKey)
	if e != nil || len(b) != ed25519.PrivateKeySize {
		return nil, fmt.Errorf("invalid private device identity")
	}
	k := ed25519.PrivateKey(b)
	if hash(k.Public().(ed25519.PublicKey))[:32] != i.ID {
		return nil, fmt.Errorf("device identity mismatch")
	}
	return k, nil
}

func writeJSON(path string, value any) error {
	b, e := json.MarshalIndent(value, "", "  ")
	if e != nil {
		return e
	}
	if e = os.MkdirAll(filepath.Dir(path), 0700); e != nil {
		return e
	}
	return privatefile.Write(path, b)
}

func LoadIdentity(path string) (Identity, error) {
	var i Identity
	b, e := os.ReadFile(path)
	if e != nil {
		return i, e
	}
	if e = json.Unmarshal(b, &i); e != nil {
		return i, e
	}
	if _, e = i.key(); e != nil {
		return i, e
	}
	_, e = validURL(i.URL)
	return i, e
}

func finalState(s string) bool {
	switch s {
	case "completed", "failed", "cancelled", "timed_out", "persistence_failed", "interrupted", "unknown":
		return true
	}
	return false
}

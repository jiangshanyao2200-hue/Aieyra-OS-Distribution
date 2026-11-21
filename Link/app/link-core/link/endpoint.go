// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Link/app/link-core/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: savedEndpoint; endpointFile; validSavedPin; LoadConnectionIdentity; EndpointRecovery; RecoverEndpoint; pairedTrust
// Impact: python -B scripts/code-atlas.py show Link/app/link-core/link/endpoint.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package link

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"fmt"
	"os"
	"strings"
	"time"
)

type savedEndpoint struct {
	Schema     int    `json:"schema"`
	DeviceID   string `json:"device_id"`
	Pin        string `json:"tls_fingerprint"`
	URL        string `json:"hub_url"`
	VerifiedAt string `json:"verified_at"`
}

func endpointFile(path string) string { return path + ".endpoint.json" }

func validSavedPin(pin string) bool { return validHex(strings.ToLower(pin), 32) }

// The immutable pairing file remains the source of identity and trust. The
// optional endpoint contains only a verified address bound to that identity.
func LoadConnectionIdentity(path string) (Identity, error) {
	i, err := LoadIdentity(path)
	if err != nil {
		return i, err
	}
	raw, err := os.ReadFile(endpointFile(path))
	if os.IsNotExist(err) {
		return i, nil
	}
	if err != nil {
		return i, err
	}
	var endpoint savedEndpoint
	if len(raw) > 4096 || decode(raw, &endpoint) != nil || endpoint.Schema != 1 || endpoint.DeviceID != i.ID || !validSavedPin(i.TLSFingerprint) || !strings.EqualFold(endpoint.Pin, i.TLSFingerprint) {
		return i, fmt.Errorf("saved endpoint does not match the original paired identity; retained")
	}
	u, err := validURL(endpoint.URL)
	_, dateErr := time.Parse(time.RFC3339Nano, endpoint.VerifiedAt)
	if err != nil || u.Scheme != "https" || dateErr != nil {
		return i, fmt.Errorf("invalid saved endpoint; original retained")
	}
	i.URL = strings.TrimRight(endpoint.URL, "/")
	return i, nil
}

type EndpointRecovery struct {
	Verified         bool   `json:"verified"`
	DeviceID         string `json:"device_id"`
	URL              string `json:"hub_url"`
	VerifiedAt       string `json:"verified_at"`
	IdentityRetained bool   `json:"identity_retained"`
	ReplayAllowed    bool   `json:"replay_allowed"`
}

func RecoverEndpoint(ctx context.Context, path, endpoint string) (EndpointRecovery, error) {
	result := EndpointRecovery{}
	// Unlike pairing, recovery must never create an identity or its directory.
	before, err := os.ReadFile(path)
	if err != nil {
		return result, fmt.Errorf("recovery requires an existing paired identity")
	}
	lock, err := os.OpenFile(path+".endpoint.lock", os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return result, err
	}
	defer lock.Close()
	if err = lockFile(lock); err != nil {
		return result, fmt.Errorf("endpoint recovery already in progress")
	}
	defer unlockFile(lock)
	i, err := LoadConnectionIdentity(path)
	if err != nil {
		return result, err
	}
	u, err := validURL(endpoint)
	if err != nil || u.Scheme != "https" || !validSavedPin(i.TLSFingerprint) {
		return result, fmt.Errorf("recovery requires HTTPS and the original saved TLS pin; use a device code for an unpaired server")
	}
	i.URL = strings.TrimRight(endpoint, "/")
	client, err := NewClient(i)
	if err != nil {
		return result, err
	}
	defer client.HTTP.CloseIdleConnections()
	check, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	var catalog struct {
		Devices  []Device  `json:"devices"`
		Sessions []Session `json:"sessions"`
		Cursor   uint64    `json:"cursor"`
		Presence string    `json:"presence"`
	}
	// This checks the actual certificate, its validity and the existing signed
	// device permission. An mDNS pin alone cannot authorize a server or device.
	if err = client.Call(check, "/v1/catalog", nil, &catalog); err != nil {
		return result, err
	}
	key, _ := i.key()
	public := base64.StdEncoding.EncodeToString(key.Public().(ed25519.PublicKey))
	accepted := false
	for _, device := range catalog.Devices {
		if device.ID == i.ID && device.PublicKey == public && !device.Revoked {
			accepted = true
		}
	}
	if !accepted || catalog.Sessions == nil {
		return result, fmt.Errorf("server did not confirm the original device identity")
	}
	after, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(before, after) {
		return result, fmt.Errorf("paired identity changed during recovery; endpoint retained")
	}
	if err = check.Err(); err != nil {
		return result, err
	}
	value := savedEndpoint{Schema: 1, DeviceID: i.ID, Pin: i.TLSFingerprint, URL: i.URL, VerifiedAt: now()}
	if err = writeJSON(endpointFile(path), value); err != nil {
		return result, err
	}
	return EndpointRecovery{Verified: true, DeviceID: i.ID, URL: i.URL, VerifiedAt: value.VerifiedAt, IdentityRetained: true}, nil
}

// Public trust metadata for the local owner; no keys or task content.
func pairedTrust(path string) (map[string]any, error) {
	i, err := LoadConnectionIdentity(path)
	if err != nil {
		return nil, err
	}
	return map[string]any{"device_id": i.ID, "hub_url": i.URL, "tls_fingerprint": strings.ToLower(i.TLSFingerprint), "pinned": validSavedPin(i.TLSFingerprint)}, nil
}

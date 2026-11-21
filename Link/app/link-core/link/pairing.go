// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Link/app/link-core/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: DeviceCode; encodeCode; parseCode; PairCode; identityTransport; prepareTLS
// Impact: python -B scripts/code-atlas.py show Link/app/link-core/link/pairing.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package link

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/subtle"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"math/big"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/aieyra/aieyra-link/internal/privatefile"
)

// A self-contained code works without an official rendezvous account or server.
// It is a one-use secret, not a permanent public device identifier.
type DeviceCode struct {
	Version     int    `json:"v"`
	URL         string `json:"url"`
	Fingerprint string `json:"pin,omitempty"`
	Invite      string `json:"invite"`
	Expires     int64  `json:"expires"`
}

func encodeCode(i Identity, invite string, expires int64) string {
	b, _ := json.Marshal(DeviceCode{1, i.URL, i.TLSFingerprint, invite, expires})
	return "aieyra-link:1:" + base64.RawURLEncoding.EncodeToString(b)
}
func parseCode(raw string) (DeviceCode, error) {
	var c DeviceCode
	if len(raw) > 4096 || !strings.HasPrefix(raw, "aieyra-link:1:") {
		return c, fmt.Errorf("invalid Link device code")
	}
	b, e := base64.RawURLEncoding.DecodeString(strings.TrimPrefix(raw, "aieyra-link:1:"))
	if e != nil {
		return c, fmt.Errorf("invalid Link device code")
	}
	if e = decode(b, &c); e != nil || c.Version != 1 || len(c.Invite) != 64 || !validID(c.Invite) {
		return c, fmt.Errorf("invalid Link device code")
	}
	if _, e = validURL(c.URL); e != nil {
		return c, e
	}
	if c.Expires < time.Now().Unix() {
		return c, fmt.Errorf("device code expired; ask the owner for a new code")
	}
	if c.Fingerprint != "" {
		pin, e := hex.DecodeString(c.Fingerprint)
		if e != nil || len(pin) != 32 || !strings.HasPrefix(c.URL, "https://") {
			return c, fmt.Errorf("invalid server fingerprint")
		}
	}
	return c, nil
}
func PairCode(ctx context.Context, path, name, raw string) (Identity, error) {
	c, e := parseCode(strings.TrimSpace(raw))
	if e != nil {
		return Identity{}, e
	}
	return pairPinned(ctx, path, c.URL, name, c.Invite, c.Fingerprint)
}
func identityTransport(i Identity) (*http.Transport, error) {
	t := http.DefaultTransport.(*http.Transport).Clone()
	// Explicit connections must not send credentials through an ambient HTTP proxy.
	t.Proxy = nil
	t.TLSClientConfig = &tls.Config{MinVersion: tls.VersionTLS12}
	if i.TLSFingerprint != "" {
		expected, e := hex.DecodeString(i.TLSFingerprint)
		if e != nil || len(expected) != 32 || !strings.HasPrefix(i.URL, "https://") {
			return nil, fmt.Errorf("invalid TLS identity pin")
		}
		t.TLSClientConfig.InsecureSkipVerify = true // Replaced by exact certificate pin + validity below.
		t.TLSClientConfig.VerifyConnection = func(cs tls.ConnectionState) error {
			if len(cs.PeerCertificates) == 0 {
				return fmt.Errorf("missing server certificate")
			}
			cert := cs.PeerCertificates[0]
			actual, _ := hex.DecodeString(hash(cert.RawSubjectPublicKeyInfo))
			if subtle.ConstantTimeCompare(actual, expected) != 1 {
				return fmt.Errorf("server identity changed")
			}
			if time.Now().Before(cert.NotBefore) || time.Now().After(cert.NotAfter) {
				return fmt.Errorf("server certificate expired or not yet valid")
			}
			return nil
		}
	}
	return t, nil
}

func prepareTLS(directory, endpoint string) (string, string, string, error) {
	if e := os.MkdirAll(directory, 0700); e != nil {
		return "", "", "", e
	}
	lock, e := os.OpenFile(filepath.Join(directory, "tls-init.lock"), os.O_CREATE|os.O_RDWR, 0600)
	if e != nil {
		return "", "", "", e
	}
	defer lock.Close()
	if e = lockFile(lock); e != nil {
		return "", "", "", fmt.Errorf("TLS initialization already in progress")
	}
	defer unlockFile(lock)
	certFile, keyFile := filepath.Join(directory, "server.pem"), filepath.Join(directory, "server-key.pem")
	if b, e := os.ReadFile(certFile); e == nil {
		block, _ := pem.Decode(b)
		if block == nil {
			return "", "", "", fmt.Errorf("invalid retained server certificate")
		}
		cert, e := x509.ParseCertificate(block.Bytes)
		if e != nil {
			return "", "", "", e
		}
		if time.Now().Before(cert.NotBefore) || time.Now().After(cert.NotAfter) {
			return "", "", "", fmt.Errorf("retained server certificate outside validity period")
		}
		if _, e = tls.LoadX509KeyPair(certFile, keyFile); e != nil {
			return "", "", "", e
		}
		return certFile, keyFile, hash(cert.RawSubjectPublicKeyInfo), nil
	} else if !os.IsNotExist(e) {
		return "", "", "", e
	}
	if _, e := os.Stat(keyFile); !os.IsNotExist(e) {
		return "", "", "", fmt.Errorf("server key already exists; inspect interrupted initialization")
	}
	u, e := url.Parse(endpoint)
	if e != nil || u.Scheme != "https" {
		return "", "", "", fmt.Errorf("direct network hosting requires an HTTPS URL")
	}
	pub, key, e := ed25519.GenerateKey(rand.Reader)
	if e != nil {
		return "", "", "", e
	}
	serial, e := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if e != nil {
		return "", "", "", e
	}
	template := &x509.Certificate{SerialNumber: serial, Subject: pkix.Name{CommonName: "Aieyra Link private server"}, NotBefore: time.Now().Add(-5 * time.Minute), NotAfter: time.Now().AddDate(2, 0, 0), KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}, BasicConstraintsValid: true}
	if ip := net.ParseIP(u.Hostname()); ip != nil {
		template.IPAddresses = []net.IP{ip}
	} else {
		template.DNSNames = []string{u.Hostname()}
	}
	der, e := x509.CreateCertificate(rand.Reader, template, template, pub, key)
	if e != nil {
		return "", "", "", e
	}
	pk, e := x509.MarshalPKCS8PrivateKey(key)
	if e != nil {
		return "", "", "", e
	}
	if e = os.MkdirAll(directory, 0700); e != nil {
		return "", "", "", e
	}
	// The initialization lock and existence checks preserve trust material.
	// Privatefile applies a protected Windows DACL before writing any secret.
	for _, v := range []struct {
		path, kind string
		b          []byte
	}{{keyFile, "PRIVATE KEY", pk}, {certFile, "CERTIFICATE", der}} {
		if e = privatefile.Write(v.path, pem.EncodeToMemory(&pem.Block{Type: v.kind, Bytes: v.b})); e != nil {
			return "", "", "", e
		}
	}
	cert, _ := x509.ParseCertificate(der)
	return certFile, keyFile, hash(cert.RawSubjectPublicKeyInfo), nil
}

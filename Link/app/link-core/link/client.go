// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Link/app/link-core/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: Client; NewClient; request; remoteError; Error; cleanText; callContextError; Call; Pair; pairPinned
// Impact: python -B scripts/code-atlas.py show Link/app/link-core/link/client.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package link

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
	"unicode"
)

type Client struct {
	Identity Identity
	HTTP     *http.Client
}

func NewClient(i Identity) (*Client, error) {
	if _, e := i.key(); e != nil {
		return nil, e
	}
	if _, e := validURL(i.URL); e != nil {
		return nil, e
	}
	transport, e := identityTransport(i)
	if e != nil {
		return nil, e
	}
	return &Client{i, &http.Client{Transport: transport, Timeout: 20 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}, nil
}

func (c *Client) request(ctx context.Context, path string, args any) (*http.Request, error) {
	if args == nil {
		args = map[string]any{}
	}
	b, e := json.Marshal(args)
	if e != nil {
		return nil, e
	}
	r, e := http.NewRequestWithContext(ctx, http.MethodPost, c.Identity.URL+path, bytes.NewReader(b))
	if e != nil {
		return nil, e
	}
	stamp, nonce := strconv.FormatInt(time.Now().Unix(), 10), randomID()
	key, e := c.Identity.key()
	if e != nil {
		return nil, e
	}
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("X-Link-Device", c.Identity.ID)
	r.Header.Set("X-Link-Time", stamp)
	r.Header.Set("X-Link-Nonce", nonce)
	r.Header.Set("X-Link-Signature", base64.StdEncoding.EncodeToString(ed25519.Sign(key, proof(r.Method, r.URL.RequestURI(), stamp, nonce, b))))
	return r, nil
}

type remoteError struct {
	Status  int
	Message string
}

func (e *remoteError) Error() string { return cleanText(e.Message) }
func cleanText(s string) string {
	return strings.Map(func(r rune) rune {
		if unicode.IsControl(r) && r != '\n' && r != '\t' {
			return -1
		}
		return r
	}, s)
}

func callContextError(ctx context.Context, err error) error {
	if stopped := ctx.Err(); stopped != nil {
		return stopped
	}
	if errors.Is(err, context.Canceled) {
		return context.Canceled
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return context.DeadlineExceeded
	}
	return nil
}

func (c *Client) Call(ctx context.Context, path string, args, target any) error {
	r, e := c.request(ctx, path, args)
	if e != nil {
		return e
	}
	res, e := c.HTTP.Do(r)
	if e != nil {
		if stopped := callContextError(ctx, e); stopped != nil {
			return stopped
		}
		return fmt.Errorf("Link hub unavailable")
	}
	defer res.Body.Close()
	limit := int64(8 << 20)
	if path == "/v1/control/result" || path == "/v1/control/send" {
		limit = 13 << 20
	}
	b, e := io.ReadAll(io.LimitReader(res.Body, limit+1))
	if e != nil || int64(len(b)) > limit {
		if e != nil {
			if stopped := callContextError(ctx, e); stopped != nil {
				return stopped
			}
		}
		return fmt.Errorf("invalid hub response")
	}
	var envelope struct {
		OK    bool            `json:"ok"`
		Error string          `json:"error"`
		Data  json.RawMessage `json:"data"`
	}
	if json.Unmarshal(b, &envelope) != nil {
		return fmt.Errorf("invalid hub response")
	}
	if res.StatusCode != 200 || !envelope.OK {
		return &remoteError{res.StatusCode, envelope.Error}
	}
	if target != nil {
		return json.Unmarshal(envelope.Data, target)
	}
	return nil
}

func Pair(ctx context.Context, path, endpoint, name, invite string) (Identity, error) {
	return pairPinned(ctx, path, endpoint, name, invite, "")
}

func pairPinned(ctx context.Context, path, endpoint, name, invite, fingerprint string) (Identity, error) {
	if _, e := os.Stat(path); e == nil {
		return Identity{}, fmt.Errorf("device identity exists; retained")
	} else if !os.IsNotExist(e) {
		return Identity{}, e
	}
	if e := os.MkdirAll(filepath.Dir(path), 0700); e != nil {
		return Identity{}, e
	}
	lock, e := os.OpenFile(path+".lock", os.O_CREATE|os.O_RDWR, 0600)
	if e != nil {
		return Identity{}, e
	}
	defer lock.Close()
	if e = lockFile(lock); e != nil {
		return Identity{}, fmt.Errorf("pairing already in progress")
	}
	defer unlockFile(lock)
	if _, e = os.Stat(path); e == nil {
		return Identity{}, fmt.Errorf("device identity was created concurrently; retained")
	}
	pending := path + ".pending"
	i, e := LoadIdentity(pending)
	if os.IsNotExist(e) {
		i, _, e = newIdentity(endpoint, name)
		i.TLSFingerprint = fingerprint
		if e == nil {
			e = writeJSON(pending, i)
		}
	}
	if e != nil {
		return Identity{}, e
	}
	if i.URL != endpoint || i.Name != name || i.TLSFingerprint != fingerprint {
		return Identity{}, fmt.Errorf("pending pairing belongs to another hub or name; original retained")
	}
	c, e := NewClient(i)
	if e != nil {
		return Identity{}, e
	}
	key, _ := i.key()
	d := Device{ID: i.ID, Name: i.Name, PublicKey: base64.StdEncoding.EncodeToString(key.Public().(ed25519.PublicKey))}
	if e = c.Call(ctx, "/v1/pair", map[string]any{"invite": invite, "device": d}, nil); e != nil {
		return Identity{}, e
	}
	if e = writeJSON(path, i); e != nil {
		return Identity{}, e
	}
	_ = os.Remove(pending)
	return i, nil
}

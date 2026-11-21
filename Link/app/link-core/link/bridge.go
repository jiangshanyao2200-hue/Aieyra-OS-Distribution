// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Link/app/link-core/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: discovery; loadDiscovery; coreCall; bridgeState; Bridge; OpenBridge; SessionID; Close; coreStatus; receipt; Step; applyAnswers; Run
// Impact: python -B scripts/code-atlas.py show Link/app/link-core/link/bridge.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package link

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"
)

type discovery struct {
	Session string `json:"session_id"`
	URL     string `json:"url"`
	Token   string `json:"token"`
	Mode    string `json:"mode"`
}

func loadDiscovery(path string) (discovery, error) {
	var d discovery
	f, e := os.Open(path)
	if e != nil {
		return d, e
	}
	defer f.Close()
	i, e := f.Stat()
	if e != nil {
		return d, e
	}
	if !i.Mode().IsRegular() || i.Size() > 64<<10 || runtime.GOOS != "windows" && i.Mode().Perm()&0077 != 0 {
		return d, fmt.Errorf("select a private OS discovery file")
	}
	if e = json.NewDecoder(f).Decode(&d); e != nil {
		return d, e
	}
	u, e := url.Parse(d.URL)
	if e != nil || u.Scheme != "http" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Path != "/v1/rpc" || net.ParseIP(u.Hostname()) == nil || !net.ParseIP(u.Hostname()).IsLoopback() || !validID(d.Session) || len(d.Token) < 32 {
		return d, fmt.Errorf("invalid local OS discovery")
	}
	return d, nil
}

func coreCall(ctx context.Context, d discovery, action string, args, target any) error {
	if args == nil {
		args = map[string]any{}
	}
	b, e := json.Marshal(map[string]any{"action": action, "arguments": args})
	if e != nil {
		return e
	}
	r, e := http.NewRequestWithContext(ctx, "POST", d.URL, bytes.NewReader(b))
	if e != nil {
		return e
	}
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Authorization", "Bearer "+d.Token)
	c := &http.Client{Timeout: 15 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	res, e := c.Do(r)
	if e != nil {
		return fmt.Errorf("local OS core unavailable")
	}
	defer res.Body.Close()
	b, e = io.ReadAll(io.LimitReader(res.Body, (8<<20)+1))
	if e != nil || len(b) > 8<<20 {
		return fmt.Errorf("invalid core response")
	}
	var envelope struct {
		OK    bool            `json:"ok"`
		Error string          `json:"error"`
		Data  json.RawMessage `json:"data"`
	}
	if json.Unmarshal(b, &envelope) != nil {
		return fmt.Errorf("invalid core response")
	}
	if res.StatusCode != 200 || !envelope.OK {
		return &remoteError{res.StatusCode, envelope.Error}
	}
	if target != nil {
		return json.Unmarshal(envelope.Data, target)
	}
	return nil
}

type bridgeState struct {
	SessionID   string            `json:"session_id"`
	DeviceID    string            `json:"device_id"`
	Hub         string            `json:"hub"`
	Submissions map[string]string `json:"submissions"`
}
type Bridge struct {
	client                   *Client
	discoveryPath, statePath string
	lock                     *os.File
	state                    bridgeState
	closed                   bool
	attached                 bool
	lastPresence             time.Time
}

func OpenBridge(ctx context.Context, client *Client, discoveryPath, title string) (*Bridge, error) {
	abs, e := filepath.Abs(discoveryPath)
	if e != nil {
		return nil, e
	}
	d, e := loadDiscovery(abs)
	if e != nil {
		return nil, e
	}
	f, e := os.OpenFile(abs+".link.lock", os.O_CREATE|os.O_RDWR, 0600)
	if e != nil {
		return nil, e
	}
	if e = lockFile(f); e != nil {
		f.Close()
		return nil, fmt.Errorf("this local OS session already has a Link bridge")
	}
	b := &Bridge{client: client, discoveryPath: abs, statePath: abs + ".link-state.json", lock: f}
	data, e := os.ReadFile(b.statePath)
	if os.IsNotExist(e) {
		b.state = bridgeState{DeviceID: client.Identity.ID, Hub: client.Identity.URL, Submissions: map[string]string{}}
	} else if e == nil {
		e = json.Unmarshal(data, &b.state)
	}
	if e != nil && !os.IsNotExist(e) {
		b.Close()
		return nil, e
	}
	if b.state.DeviceID != client.Identity.ID || b.state.Hub != client.Identity.URL || b.state.Submissions == nil {
		b.Close()
		return nil, fmt.Errorf("this session belongs to its recorded Link device and hub")
	}
	// 先证实当前核心可达，不把任意文件当成在线会话。
	if e = coreCall(ctx, d, "matrix.status", nil, nil); e != nil {
		b.Close()
		return nil, e
	}
	var session Session
	if e = client.Call(ctx, "/v1/attach", map[string]string{"local_id": d.Session, "title": title, "mode": d.Mode}, &session); e != nil {
		b.Close()
		return nil, e
	}
	if b.state.SessionID != "" && b.state.SessionID != session.ID {
		b.Close()
		return nil, fmt.Errorf("session ownership changed")
	}
	b.state.SessionID = session.ID
	b.attached = true
	if e = writeJSON(b.statePath, b.state); e != nil {
		b.Close()
		return nil, e
	}
	return b, nil
}
func (b *Bridge) SessionID() string { return b.state.SessionID }
func (b *Bridge) Close() {
	if !b.closed {
		b.closed = true
		if b.attached {
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			_ = b.client.Call(ctx, "/v1/session-status", map[string]string{"id": b.state.SessionID, "state": "offline"}, nil)
			cancel()
		}
		unlockFile(b.lock)
		_ = b.lock.Close()
	}
}

type coreStatus struct {
	State, Reply, Error string
	Generation          int
}

func (b *Bridge) receipt(ctx context.Context, m Message, state, reply, issue string) error {
	return b.client.Call(ctx, "/v1/receipt", map[string]string{"id": m.ID, "state": state, "reply": reply, "error": issue}, nil)
}

func (b *Bridge) Step(ctx context.Context) error {
	if b.closed {
		return fmt.Errorf("bridge closed")
	}
	d, e := loadDiscovery(b.discoveryPath)
	if e != nil {
		return e
	}
	if b.state.SessionID != b.client.Identity.ID+":"+d.Session {
		return fmt.Errorf("local session changed; original binding retained")
	}
	var presence struct {
		Busy  bool
		Phase string
	}
	if e = coreCall(ctx, d, "matrix.status", nil, &presence); e != nil {
		return e
	}
	if time.Since(b.lastPresence) >= 15*time.Second {
		state := "idle"
		if presence.Busy {
			state = "busy"
		}
		if presence.Phase == "waiting_user" {
			state = "waiting_user"
		}
		if e = b.client.Call(ctx, "/v1/session-status", map[string]string{"id": b.state.SessionID, "state": state}, nil); e != nil {
			return e
		}
		b.lastPresence = time.Now()
	}
	// Reconcile durable decisions even after the original task has left
	// waiting_user (including when its final message receipt already exists).
	if e = b.applyAnswers(ctx, d); e != nil {
		return e
	}
	var pending []Message
	if e = b.client.Call(ctx, "/v1/messages", map[string]any{"session_id": b.state.SessionID, "pending": true}, &pending); e != nil {
		return e
	}
	sort.Slice(pending, func(i, j int) bool {
		if pending[i].CancelRequested != pending[j].CancelRequested {
			return pending[i].CancelRequested
		}
		if pending[i].CreatedAt == pending[j].CreatedAt {
			return pending[i].ID < pending[j].ID
		}
		return pending[i].CreatedAt < pending[j].CreatedAt
	})
	for _, m := range pending {
		var status coreStatus
		e = coreCall(ctx, d, "matrix.status", map[string]string{"request_id": m.CoreRequestID}, &status)
		var re *remoteError
		missing := errors.As(e, &re) && re.Message == "request not found"
		if e != nil && !missing {
			return e
		}
		if missing {
			if b.state.Submissions[m.ID] != "" || m.State != "received" {
				// 发送边界中断且核心无回执，不能自动重放未知副作用。
				if e = b.receipt(ctx, m, "unknown", "", "Core receipt missing after a submission boundary; inspect the original executor before retrying."); e != nil {
					return e
				}
				continue
			}
			if m.CancelRequested {
				if e = b.receipt(ctx, m, "cancelled", "", ""); e != nil {
					return e
				}
				continue
			}
			if presence.Busy {
				continue
			}
			b.state.Submissions[m.ID] = "submitting"
			if e = writeJSON(b.statePath, b.state); e != nil {
				delete(b.state.Submissions, m.ID)
				return e
			}
			if e = coreCall(ctx, d, "matrix.send", map[string]string{"request_id": m.CoreRequestID, "message": m.Text}, nil); e != nil {
				return e
			}
			b.state.Submissions[m.ID] = "accepted"
			if e = writeJSON(b.statePath, b.state); e != nil {
				return e
			}
			if e = b.receipt(ctx, m, "accepted", "", ""); e != nil {
				return e
			}
			presence.Busy = true
			continue
		}
		if m.CancelRequested && !finalState(status.State) {
			if e = coreCall(ctx, d, "matrix.cancel", map[string]string{"request_id": m.CoreRequestID}, nil); e != nil {
				return e
			}
			if e = coreCall(ctx, d, "matrix.status", map[string]string{"request_id": m.CoreRequestID}, &status); e != nil {
				return e
			}
		}
		if status.State == "queued" {
			status.State = "accepted"
		}
		if status.State == "delivered" {
			status.State = "running"
		}
		if status.State == "running" && presence.Phase == "waiting_user" {
			status.State = "waiting_user"
		}
		if status.State == "waiting_user" {
			var humans []HumanQuestion
			if e = coreCall(ctx, d, "humans.list", nil, &humans); e != nil {
				return e
			}
			for _, human := range humans {
				if human.Generation == status.Generation && human.State == "waiting_user" {
					if e = b.client.Call(ctx, "/v1/receipt", map[string]any{"id": m.ID, "state": status.State, "human": human}, nil); e != nil {
						return e
					}
					break
				}
			}
			continue
		}
		if finalState(status.State) {
			var snapshot struct {
				Messages []struct {
					From, State string
					Generation  int
					DocumentID  string `json:"document_id"`
				}
			}
			if e = coreCall(ctx, d, "workspace.snapshot", nil, &snapshot); e != nil {
				return e
			}
			for i := len(snapshot.Messages) - 1; i >= 0; i-- {
				v := snapshot.Messages[i]
				if v.From != "matrix" || v.Generation != status.Generation || v.State == "commentary" {
					continue
				}
				if v.DocumentID != "" {
					var doc struct{ Content string }
					if e = coreCall(ctx, d, "workspace.document", map[string]string{"id": v.DocumentID}, &doc); e != nil {
						return e
					}
					status.Reply = doc.Content
				}
				break
			}
		}
		if e = b.receipt(ctx, m, status.State, status.Reply, status.Error); e != nil {
			return e
		}
	}
	return nil
}

func (b *Bridge) applyAnswers(ctx context.Context, d discovery) error {
	var answers []Answer
	if err := b.client.Call(ctx, "/v1/answers", map[string]string{"session_id": b.SessionID()}, &answers); err != nil {
		return err
	}
	for _, a := range answers {
		var m Message
		if err := b.client.Call(ctx, "/v1/messages", map[string]string{"id": a.MessageID}, &m); err != nil {
			return err
		}
		if m.CancelRequested && !finalState(m.State) {
			if err := coreCall(ctx, d, "matrix.cancel", map[string]string{"request_id": m.CoreRequestID}, nil); err != nil {
				return err
			}
		}
		state, issue := "applied", ""
		h := a.Human
		err := coreCall(ctx, d, "humans.reply", map[string]any{"request_id": "link-answer-" + a.ID, "session_id": h.SessionID, "agent_id": h.AgentID, "generation": h.Generation, "human_id": h.ID, "expected_request_version": h.Version, "request_token_sha256": h.Token, "decision": a.Decision}, nil)
		if err != nil {
			var rejection *remoteError
			if !errors.As(err, &rejection) {
				return err
			} // Lost response: same guarded decision ID on retry.
			state, issue = "rejected", rejection.Message
		}
		if err = b.client.Call(ctx, "/v1/answer-receipt", map[string]string{"id": a.ID, "state": state, "error": issue}, nil); err != nil {
			return err
		}
	}
	return nil
}

func (b *Bridge) Run(ctx context.Context, diagnostic io.Writer) error {
	lastError := ""
	for {
		e := b.Step(ctx)
		if ctx.Err() != nil {
			return nil
		}
		if e != nil {
			if e.Error() != lastError {
				fmt.Fprintln(diagnostic, "Link:", strings.Map(func(r rune) rune {
					if r < ' ' || r == 127 {
						return -1
					}
					return r
				}, e.Error()))
				lastError = e.Error()
			}
		} else {
			lastError = ""
		}
		select {
		case <-ctx.Done():
			return nil
		case <-time.After(time.Second):
		}
	}
}

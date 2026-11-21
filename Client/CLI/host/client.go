// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/CLI/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: client; newClient; call; terminalText; history; run; wait; answer
// Impact: python -B scripts/code-atlas.py show Client/CLI/host/client.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package cli

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
	"unicode"

	agent "github.com/aieyra/aieyra-os/CORE"
)

type client struct {
	url, token, session string
	root                string
	http                *http.Client
}

func newClient(d map[string]any) *client {
	return &client{url: d["url"].(string), token: d["token"].(string), session: d["session_id"].(string), root: d["session_id"].(string), http: &http.Client{Timeout: 60 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
}
func (c *client) call(ctx context.Context, action string, args any, target any) error {
	if args == nil {
		args = map[string]any{}
	}
	if mapped, ok := map[string]string{"workspace.snapshot": "workspace.task_snapshot", "matrix.status": "workspace.task_status", "matrix.send": "workspace.task_send", "matrix.cancel": "workspace.task_cancel"}[action]; ok {
		data, e := json.Marshal(args)
		if e != nil {
			return e
		}
		scoped := map[string]any{}
		if e = json.Unmarshal(data, &scoped); e != nil {
			return e
		}
		scoped["task_id"] = c.session
		action, args = mapped, scoped
	}
	b, err := json.Marshal(map[string]any{"action": action, "arguments": args})
	if err != nil {
		return err
	}
	r, err := http.NewRequestWithContext(ctx, http.MethodPost, c.url, bytes.NewReader(b))
	if err != nil {
		return err
	}
	r.Header.Set("Authorization", "Bearer "+c.token)
	r.Header.Set("Content-Type", "application/json")
	res, err := c.http.Do(r)
	if err != nil {
		return fmt.Errorf("local core request failed")
	}
	defer res.Body.Close()
	b, err = io.ReadAll(io.LimitReader(res.Body, (4<<20)+1))
	if err != nil || len(b) > 4<<20 {
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
		return fmt.Errorf("%s", terminalText(envelope.Error))
	}
	if target != nil {
		return json.Unmarshal(envelope.Data, target)
	}
	return nil
}

// Terminal control sequences are never interpreted from a model/tool response.
func terminalText(s string) string {
	var out strings.Builder
	state := byte(0)
	for _, r := range s {
		switch state {
		case 1: // ESC
			switch r {
			case '[':
				state = 2
			case ']', 'P', '^', '_':
				state = 3
			default:
				state = 0
			}
			continue
		case 2: // CSI parameters and final byte
			if r >= 0x40 && r <= 0x7e {
				state = 0
			}
			continue
		case 3: // OSC/DCS/APC payload through BEL or ST
			if r == 7 || r == 0x9c {
				state = 0
			} else if r == 0x1b {
				state = 4
			}
			continue
		case 4:
			if r == '\\' {
				state = 0
			} else {
				state = 3
			}
			continue
		}
		switch r {
		case 0x1b:
			state = 1
		case 0x9b:
			state = 2
		case 0x90, 0x9d, 0x9e, 0x9f:
			state = 3
		default:
			if r == '\n' || r == '\t' || !unicode.IsControl(r) && r != 0x7f {
				out.WriteRune(r)
			}
		}
	}
	return out.String()
}

func (c *client) history(ctx context.Context, out io.Writer, asJSON bool) error {
	var snapshot struct {
		Messages []struct {
			From, State, Text string
			DocumentID        string `json:"document_id"`
		}
	}
	if err := c.call(ctx, "workspace.snapshot", nil, &snapshot); err != nil {
		return err
	}
	if asJSON {
		return json.NewEncoder(out).Encode(snapshot.Messages)
	}
	for _, message := range snapshot.Messages {
		text := message.Text
		if message.DocumentID != "" {
			var document struct{ Content string }
			if err := c.call(ctx, "workspace.document", map[string]string{"id": message.DocumentID}, &document); err != nil {
				return err
			}
			text = document.Content
		}
		if _, err := fmt.Fprintf(out, "%s · %s\n%s\n\n", terminalText(message.From), terminalText(message.State), terminalText(text)); err != nil {
			return err
		}
	}
	return nil
}

func (c *client) run(ctx context.Context, id, prompt string, out, diagnostic io.Writer, asJSON bool, lines <-chan inputLine) error {
	if id == "" {
		id = identifier()
	}
	var view struct{ Roles []struct{ Generation int } }
	if err := c.call(ctx, "workspace.snapshot", nil, &view); err != nil {
		return err
	}
	generation := 0
	if len(view.Roles) > 0 {
		generation = view.Roles[0].Generation
	}
	if err := c.call(ctx, "matrix.send", map[string]any{"request_id": id, "message": prompt, "generation": generation}, nil); err != nil {
		return err
	}
	_, _ = fmt.Fprintln(diagnostic, "Request:", id)
	return c.wait(ctx, id, out, diagnostic, asJSON, lines)
}

func (c *client) wait(ctx context.Context, id string, out, diagnostic io.Writer, asJSON bool, lines <-chan inputLine) error {
	completed := false
	generation := 0
	defer func() {
		if !completed {
			cancelCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			if generation == 0 {
				var status struct{ Generation int }
				if c.call(cancelCtx, "matrix.status", map[string]any{"request_id": id}, &status) == nil {
					generation = status.Generation
				}
			}
			_ = c.call(cancelCtx, "matrix.cancel", map[string]any{"request_id": id, "generation": generation}, nil)
		}
	}()
	seen := map[string]string{}
	for {
		var status struct {
			State, Reply, Error string
			Generation          int
		}
		if err := c.call(ctx, "matrix.status", map[string]any{"request_id": id}, &status); err != nil {
			return err
		}
		generation = status.Generation
		var snapshot struct {
			Messages []struct {
				ID, From, State, Text string
				Generation            int
				DocumentID            string `json:"document_id"`
			}
			Roles []struct {
				ID, State  string
				Generation int
				Humans     []agent.HumanRequest `json:"human_requests"`
				Activity   struct {
					Items []agent.AgentActivity `json:"items"`
				} `json:"activity"`
			}
		}
		if err := c.call(ctx, "workspace.snapshot", nil, &snapshot); err != nil {
			return err
		}
		for _, m := range snapshot.Messages {
			if m.From == agent.WorkspaceMatrix && m.Generation == status.Generation && m.State == "commentary" && seen[m.ID] == "" {
				_, _ = fmt.Fprintln(diagnostic, terminalText(m.Text))
				seen[m.ID] = "shown"
			}
		}
		for _, role := range snapshot.Roles {
			if role.Generation != status.Generation {
				continue
			}
			for _, a := range role.Activity.Items {
				if a.Generation == status.Generation && seen[a.ID] != a.State {
					_, _ = fmt.Fprintf(diagnostic, "[%s] %s\n", terminalText(a.State), terminalText(a.Tool))
					seen[a.ID] = a.State
				}
			}
			if role.State == "waiting_user" {
				for _, human := range role.Humans {
					if human.State != "waiting_user" || human.Generation != role.Generation || human.AgentID != role.ID {
						continue
					}
					if lines == nil {
						completed = true
						_ = json.NewEncoder(out).Encode(map[string]any{"state": "waiting_user", "session_id": c.session, "request_id": id, "question": human.Question})
						return fmt.Errorf("human input required; use interactive chat for tasks needing a decision")
					}
					if err := c.answer(ctx, human, lines, diagnostic); err != nil {
						return err
					}
				}
			}
		}
		switch status.State {
		case "completed", "failed", "cancelled", "timed_out", "persistence_failed", "interrupted":
			completed = true
			// 桌面存档可把长回复收成文档；终端读取同一正文，不能只显示画布提示。
			for i := len(snapshot.Messages) - 1; i >= 0; i-- {
				m := snapshot.Messages[i]
				if m.From != agent.WorkspaceMatrix || m.Generation != status.Generation || m.State == "commentary" {
					continue
				}
				if m.DocumentID != "" {
					var document struct{ Content string }
					if err := c.call(ctx, "workspace.document", map[string]string{"id": m.DocumentID}, &document); err != nil {
						return fmt.Errorf("read saved response: %w", err)
					}
					status.Reply = document.Content
				}
				break
			}
			if asJSON {
				if err := json.NewEncoder(out).Encode(map[string]any{"session_id": c.session, "request_id": id, "state": status.State, "reply": status.Reply, "error": status.Error}); err != nil {
					return err
				}
			} else if status.Reply != "" {
				if _, err := fmt.Fprintln(out, terminalText(status.Reply)); err != nil {
					return err
				}
			}
			if status.State != "completed" {
				return fmt.Errorf("task %s: %s", status.State, terminalText(status.Error))
			}
			return nil
		}
		if err := pause(ctx); err != nil {
			return err
		}
	}
}

func (c *client) answer(ctx context.Context, h agent.HumanRequest, lines <-chan inputLine, out io.Writer) error {
	_, _ = fmt.Fprintln(out, terminalText(h.Question))
	for _, o := range h.Options {
		_, _ = fmt.Fprintf(out, "%s: %s\n", terminalText(o.ID), terminalText(o.Label))
	}
	_, _ = fmt.Fprint(out, "Answer (option ID or text): ")
	text, err := nextLine(ctx, lines)
	if err != nil {
		return err
	}
	if strings.TrimSpace(text) == "" {
		return fmt.Errorf("empty answer is not a decision")
	}
	decision := agent.HumanDecision{Text: text}
	for _, o := range h.Options {
		if text == o.ID {
			decision = agent.HumanDecision{OptionID: text}
		}
	}
	return c.call(ctx, "humans.reply", agent.HumanReply{RequestID: identifier(), SessionID: h.SessionID, AgentID: h.AgentID, Generation: h.Generation, HumanID: h.ID, ExpectedRequestVersion: h.Version, RequestTokenSHA256: h.RequestTokenSHA256, Decision: decision}, nil)
}

// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestLiveMuseProtocolTrace; museTrace; add; museTraceTransport; RoundTrip; museTraceBody; Read
// Impact: python -B scripts/code-atlas.py show Core/muse_live_trace_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

//go:build live

package CORE

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// Explicit private acceptance: uses the real client, endpoint, headers and SSE
// parser. Captures only event metadata, never keys, ciphertext or model prose.
func TestLiveMuseProtocolTrace(t *testing.T) {
	if os.Getenv("AIEYRA_REAL_MODEL_ACCEPTANCE") != "1" {
		t.Skip("explicit real-model opt-in required")
	}
	source, out := os.Getenv("AIEYRA_REAL_CONFIG"), os.Getenv("AIEYRA_REAL_OUT")
	if !filepath.IsAbs(source) || !filepath.IsAbs(out) {
		t.Fatal("explicit absolute config and private output required")
	}
	if err := os.Mkdir(out, 0700); err != nil {
		t.Fatal(err)
	}
	for _, variant := range []string{"default", "detailed"} {
		t.Run(variant, func(t *testing.T) {
			s, err := Load(source)
			if err != nil {
				t.Fatal("cannot load explicit configuration")
			}
			if s.Model != "muse-spark-1.3-contributor" || !s.OpenCode() || s.Protocol() != ProtocolResponses || !s.StreamEnabled() {
				t.Fatal("expected current enabled streaming Muse Responses profile")
			}
			s.ModelOptions = cloneOptions(s.ModelOptions)
			if variant == "detailed" {
				if s.ModelOptions == nil {
					s.ModelOptions = map[string]any{}
				}
				s.ModelOptions["reasoning_summary"] = "detailed"
			}
			f, err := os.OpenFile(filepath.Join(out, variant+".jsonl"), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
			if err != nil {
				t.Fatal(err)
			}
			defer f.Close()
			trace := &museTrace{start: time.Now(), encoder: json.NewEncoder(f)}
			client := New(s)
			client.http.Transport = &museTraceTransport{base: client.http.Transport, trace: trace}
			fixture := filepath.Join(out, variant+"-fixture.txt")
			value := "MUSE_TRACE_" + variant + "_" + fmt.Sprint(time.Now().UnixNano())
			if err := os.WriteFile(fixture, []byte(value), 0600); err != nil {
				t.Fatal(err)
			}
			tool := ToolDefinition{Type: "function", Name: "read_probe", Description: "Read the isolated acceptance fixture and return its exact text.", Strict: true, Parameters: map[string]any{"type": "object", "properties": map[string]any{}, "required": []string{}, "additionalProperties": false}}
			messages := []Message{{Role: RoleUser, Content: "Call read_probe exactly once to read its isolated fixture. After receiving the actual tool result, reply with exactly that result and no other text. Do not guess the fixture contents."}}
			w := &Workspace{live: map[string]WorkspaceLive{}}
			toolSeen, completed := false, false
			var final string
			for round := 0; round < 3; round++ {
				w.requestStart(WorkspaceMatrix, true)
				ctx, cancel := context.WithTimeout(WithProviderSession(context.Background(), "aieyra-muse-trace-"+variant), 120*time.Second)
				var response *Message
				for e := range client.StreamResponses(withoutRequestRetry(ctx), s, messages, []ToolDefinition{tool}) {
					w.stream(WorkspaceMatrix, e)
					row := map[string]any{"layer": "core", "round": round, "kind": e.Kind, "text_bytes": len(e.Text), "phase": w.live[WorkspaceMatrix].Phase}
					if e.Usage != nil {
						row["usage"] = e.Usage
					}
					if e.Err != nil {
						row["error"] = strings.ReplaceAll(e.Err.Error(), s.APIKey, "[REDACTED]")
					}
					trace.add(row)
					if e.Kind == EventResponse {
						response = e.Message
					}
					if e.Kind == EventError {
						t.Error("real Muse request failed; see private metadata trace")
					}
				}
				cancel()
				if response == nil {
					break
				}
				response.Provider = s.ProviderIdentity()
				messages = append(messages, *response)
				if len(response.ToolCalls) == 0 {
					final = response.Content
					completed = true
					break
				}
				for _, call := range response.ToolCalls {
					if call.Function.Name != "read_probe" || toolSeen {
						t.Fatal("unexpected or repeated probe tool")
					}
					var args map[string]any
					if json.Unmarshal([]byte(call.Function.Arguments), &args) != nil || len(args) != 0 {
						t.Fatal("unexpected probe arguments")
					}
					data, err := os.ReadFile(fixture)
					if err != nil {
						t.Fatal(err)
					}
					toolSeen = true
					trace.add(map[string]any{"layer": "tool", "state": "completed", "tool": "read_probe", "bytes": len(data)})
					messages = append(messages, Message{Role: RoleTool, ToolCallID: call.ID, Content: string(data)})
				}
			}
			trace.add(map[string]any{"layer": "result", "model": s.Model, "variant": variant, "tool_seen": toolSeen, "completed": completed, "exact_reply": strings.TrimSpace(final) == value})
			if !toolSeen || !completed || strings.TrimSpace(final) != value {
				t.Error("real tool roundtrip did not return exact fixture")
			}
		})
	}
}

type museTrace struct {
	mu      sync.Mutex
	start   time.Time
	encoder *json.Encoder
}

func (t *museTrace) add(row map[string]any) {
	t.mu.Lock()
	defer t.mu.Unlock()
	row["ms"] = time.Since(t.start).Milliseconds()
	_ = t.encoder.Encode(row)
}

type museTraceTransport struct {
	base  http.RoundTripper
	trace *museTrace
}

func (t *museTraceTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	var wire map[string]json.RawMessage
	if r.GetBody != nil {
		b, err := r.GetBody()
		if err == nil {
			_ = json.NewDecoder(b).Decode(&wire)
			_ = b.Close()
		}
	}
	meta := map[string]any{"layer": "request", "host": r.URL.Hostname(), "path": r.URL.Path, "session_header": r.Header.Get("x-opencode-session") != "", "user_agent": r.Header.Get("User-Agent")}
	for _, k := range []string{"model", "stream", "reasoning", "include", "store"} {
		if v := wire[k]; v != nil {
			meta[k] = v
		}
	}
	t.trace.add(meta)
	resp, err := t.base.RoundTrip(r)
	if err != nil {
		return nil, err
	}
	t.trace.add(map[string]any{"layer": "http", "status": resp.StatusCode, "content_type": resp.Header.Get("Content-Type")})
	resp.Body = &museTraceBody{ReadCloser: resp.Body, trace: t.trace}
	return resp, nil
}

type museTraceBody struct {
	io.ReadCloser
	trace   *museTrace
	pending []byte
}

func (b *museTraceBody) Read(p []byte) (int, error) {
	n, err := b.ReadCloser.Read(p)
	b.pending = append(b.pending, p[:n]...)
	for {
		at := bytes.IndexByte(b.pending, '\n')
		if at < 0 {
			break
		}
		line := b.pending[:at]
		b.pending = b.pending[at+1:]
		if !bytes.HasPrefix(line, []byte("data:")) {
			continue
		}
		data := bytes.TrimSpace(line[5:])
		var e struct {
			Type  string `json:"type"`
			Delta string `json:"delta"`
			Item  struct {
				Type      string `json:"type"`
				Encrypted string `json:"encrypted_content"`
			} `json:"item"`
		}
		if json.Unmarshal(data, &e) == nil {
			b.trace.add(map[string]any{"layer": "sse", "type": e.Type, "bytes": len(data), "delta_bytes": len(e.Delta), "item_type": e.Item.Type, "opaque": e.Item.Encrypted != ""})
		}
	}
	if len(b.pending) > bufio.MaxScanTokenSize*128 {
		b.pending = nil
	}
	return n, err
}

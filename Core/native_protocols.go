// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: BuildNativeRequest; nativeHTTP; CompleteNative; StreamNative
// Impact: python -B scripts/code-atlas.py show Core/native_protocols.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"github.com/aieyra/aieyra-os/api/request"
	"io"
	"net/http"
)

func BuildNativeRequest(s *Settings, messages []Message, stream bool, tools []ToolDefinition) map[string]any {
	return request.BuildNative(requestProfile(s, stream), messages, stream, tools)
}

func (c *Client) nativeHTTP(ctx context.Context, s *Settings, body map[string]any, stream bool) (*http.Response, error) {
	if c.poolError != nil {
		return nil, c.poolError
	}
	if err := c.validateRequestSettings(s); err != nil {
		return nil, err
	}
	req, err := c.modelRequest(ctx, s.Protocol(), s.Model, body, stream)
	if err != nil {
		return nil, err
	}
	client := *c.http
	if stream {
		client.Timeout = 0
		req.Header.Set("Accept", "text/event-stream")
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != 200 {
		defer resp.Body.Close()
		return nil, parseAPIError(resp)
	}
	return resp, nil
}
func (c *Client) CompleteNative(ctx context.Context, s *Settings, messages []Message) (Message, *Usage, error) {
	resp, err := c.nativeHTTP(ctx, s, BuildNativeRequest(s, messages, false, nil), false)
	if err != nil {
		return Message{}, nil, err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 32<<20))
	if err != nil {
		return Message{}, nil, err
	}
	var message Message
	var usage *Usage
	if s.Protocol() == ProtocolGoogle {
		message, usage, err = parseGoogle(data, nil)
	} else {
		message, usage, err = parseAnthropic(data, nil)
	}
	return *normalizeInlineThinking(&message), usage, err
}
func (c *Client) StreamNative(ctx context.Context, s *Settings, messages []Message, tools []ToolDefinition) <-chan Event {
	snapshot := s.Clone()
	body := BuildNativeRequest(snapshot, messages, snapshot.StreamEnabled(), tools)
	out := make(chan Event, 64)
	go func() {
		defer close(out)
		send := func(e Event) error {
			select {
			case out <- e:
				return nil
			case <-ctx.Done():
				return ctx.Err()
			}
		}
		err := c.retryStream(ctx, send, func(ctx context.Context, send func(Event) error) error {
			resp, err := c.nativeHTTP(ctx, snapshot, body, snapshot.StreamEnabled())
			if err == nil {
				defer resp.Body.Close()
				var m Message
				var usage *Usage
				if snapshot.StreamEnabled() {
					if snapshot.Protocol() == ProtocolGoogle {
						m, usage, err = readGoogle(resp.Body, send)
					} else {
						m, usage, err = readAnthropic(resp.Body, send)
					}
				} else {
					var data []byte
					data, err = io.ReadAll(io.LimitReader(resp.Body, 32<<20))
					if err == nil {
						if snapshot.Protocol() == ProtocolGoogle {
							m, usage, err = parseGoogle(data, send)
						} else {
							m, usage, err = parseAnthropic(data, send)
						}
					}
				}
				if err == nil {
					m.Provider = snapshot.ProviderIdentity()
					for _, ev := range []Event{{Kind: EventUsage, Usage: usage}, {Kind: EventResponse, Message: &m}, {Kind: EventFinish, Finish: m.FinishReason}, {Kind: EventDone}} {
						if err = send(ev); err != nil {
							break
						}
					}
				}
			}
			return err
		})
		if err != nil {
			_ = send(Event{Kind: EventError, Err: err})
		}
	}()
	return out
}

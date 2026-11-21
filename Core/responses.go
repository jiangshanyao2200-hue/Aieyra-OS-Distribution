// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: Protocol; ResponseReasoning; ResponsesRequest; rawJSON; BuildResponsesRequest; responsesHTTP; CompleteResponses; responsesErrorWithHTTPStatus; pingResponses; StreamResponses
// Impact: python -B scripts/code-atlas.py show Core/responses.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/aieyra/aieyra-os/api/request"
	"io"
	"net/http"
)

const (
	ProtocolResponses = request.ProtocolResponses
	ProtocolChat      = request.ProtocolChat
	ProtocolMessages  = request.ProtocolMessages
	ProtocolGoogle    = request.ProtocolGoogle
)

func (s *Settings) Protocol() string {
	if s.APIProtocol == "" {
		return ProtocolResponses
	}
	return s.APIProtocol
}

type ResponseReasoning = request.ResponseReasoning
type ResponsesRequest = request.ResponsesRequest

func rawJSON(v any) json.RawMessage { b, _ := json.Marshal(v); return b }

func BuildResponsesRequest(s *Settings, messages []Message, stream bool, tools []ToolDefinition) *ResponsesRequest {
	profile := requestProfile(s, stream)
	return request.BuildResponses(profile, messages, stream, tools, requestImages(profile.SupportsImages, s.Path()))
}

func (c *Client) responsesHTTP(ctx context.Context, req *ResponsesRequest) (*http.Response, error) {
	if c.poolError != nil {
		return nil, c.poolError
	}
	if c.poolModel != "" && req.Model != c.poolModel {
		return nil, fmt.Errorf("请求模型不在当前启用的模型池配置中")
	}
	r, err := c.modelRequest(ctx, ProtocolResponses, req.Model, req, req.Stream)
	if err != nil {
		return nil, err
	}
	client := *c.http
	if req.Stream {
		client.Timeout = 0
		r.Header.Set("Accept", "text/event-stream")
	}
	response, err := client.Do(r)
	if err != nil {
		return nil, err
	}
	if response.StatusCode != http.StatusOK {
		defer response.Body.Close()
		return nil, parseAPIError(response)
	}
	return response, nil
}
func (c *Client) CompleteResponses(ctx context.Context, s *Settings, messages []Message) (Message, *Usage, error) {
	if err := c.validateRequestSettings(s); err != nil {
		return Message{}, nil, err
	}
	resp, err := c.responsesHTTP(ctx, withPromptCacheKey(ctx, s, BuildResponsesRequest(s, messages, false, nil)))
	if err != nil {
		return Message{}, nil, err
	}
	defer resp.Body.Close()
	var env responseEnvelope
	if err = json.NewDecoder(io.LimitReader(resp.Body, 32<<20)).Decode(&env); err != nil {
		return Message{}, nil, err
	}
	m, err := env.message()
	return *normalizeInlineThinking(&m), env.usage(), responsesErrorWithHTTPStatus(err, resp.StatusCode)
}

// A Responses body can fail after HTTP 200. Keep the observed status instead
// of synthesizing a retryable HTTP failure from the provider's error message.
func responsesErrorWithHTTPStatus(err error, status int) error {
	var api *APIError
	if errors.As(err, &api) && api.StatusCode == 0 {
		api.StatusCode = status
	}
	return err
}

func (c *Client) pingResponses(ctx context.Context, s *Settings) (string, error) {
	s.MaxTokens = 1
	s.APIProtocol = ProtocolResponses
	_, _, err := c.CompleteResponses(ctx, s, []Message{{Role: RoleUser, Content: "hi"}})
	if err != nil {
		return "", err
	}
	return "连通正常", nil
}
func (c *Client) StreamResponses(ctx context.Context, s *Settings, messages []Message, tools []ToolDefinition) <-chan Event {
	if err := c.validateRequestSettings(s); err != nil {
		return rejectedModelStream(err)
	}
	req := withPromptCacheKey(ctx, s, BuildResponsesRequest(s, messages, s.StreamEnabled(), tools))
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
			resp, err := c.responsesHTTP(ctx, req)
			if err == nil {
				defer resp.Body.Close()
				if req.Stream {
					err = readResponseStream(resp.Body, send)
				} else {
					var env responseEnvelope
					err = json.NewDecoder(io.LimitReader(resp.Body, 32<<20)).Decode(&env)
					if err == nil {
						var m Message
						m, err = env.message()
						if err != nil && env.Usage != nil && (env.Status == "completed" || env.Status == "incomplete" || env.Status == "failed") {
							// A rejected result still carries the supplier's actual cost.
							if usageErr := send(Event{Kind: EventUsage, Usage: env.usage()}); usageErr != nil {
								err = usageErr
							}
						}
						if err == nil {
							for _, ev := range append(env.reasoningEvents(), Event{Kind: EventDelta, Text: m.Content}, Event{Kind: EventUsage, Usage: env.usage()}, Event{Kind: EventResponse, Message: &m}, Event{Kind: EventFinish, Finish: m.FinishReason}, Event{Kind: EventDone}) {
								if err = send(ev); err != nil {
									break
								}
							}
						}
					}
				}
				err = responsesErrorWithHTTPStatus(err, resp.StatusCode)
			}
			return err
		})
		if err != nil {
			_ = send(Event{Kind: EventError, Err: err})
		}
	}()
	return out
}

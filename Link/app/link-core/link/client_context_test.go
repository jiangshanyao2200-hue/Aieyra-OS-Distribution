// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Link/app/link-core/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: contextClient; TestClientCallPreservesCancellationAndDeadlines; contextRoundTrip; RoundTrip; contextObservedBody; Read; contextReadFailure; Read; Close; TestClientCallKeepsTransportDiagnosticsPrivate; TestWaitAndCLIContextStopRetainTheOriginalMessage
// Impact: python -B scripts/code-atlas.py show Link/app/link-core/link/client_context_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package link

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func contextClient(t *testing.T, endpoint string) *Client {
	t.Helper()
	i, _, err := newIdentity(endpoint, "context-test")
	if err != nil {
		t.Fatal(err)
	}
	c, err := NewClient(i)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(c.HTTP.CloseIdleConnections)
	return c
}

func TestClientCallPreservesCancellationAndDeadlines(t *testing.T) {
	for _, stage := range []string{"headers", "body"} {
		for _, kind := range []string{"cancel", "deadline", "client-timeout"} {
			t.Run(stage+"/"+kind, func(t *testing.T) {
				entered, stopped := make(chan struct{}), make(chan struct{})
				release := make(chan struct{})
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					io.Copy(io.Discard, r.Body)
					if stage == "body" {
						w.Header().Set("Content-Type", "application/json")
						io.WriteString(w, `{"ok":true,"data":`)
						w.(http.Flusher).Flush()
					}
					close(entered)
					select {
					case <-r.Context().Done():
						close(stopped)
					case <-release:
					}
				}))
				defer server.Close()
				defer close(release)
				c := contextClient(t, server.URL)
				bodyReading := make(chan struct{})
				if stage == "body" {
					transport := c.HTTP.Transport
					c.HTTP.Transport = contextRoundTrip(func(r *http.Request) (*http.Response, error) {
						res, err := transport.RoundTrip(r)
						if err == nil {
							res.Body = &contextObservedBody{ReadCloser: res.Body, entered: bodyReading}
						}
						return res, err
					})
				}
				ctx, cancel := context.WithCancel(context.Background())
				if kind == "deadline" {
					cancel()
					ctx, cancel = context.WithTimeout(context.Background(), 250*time.Millisecond)
				} else if kind == "client-timeout" {
					c.HTTP.Timeout = 250 * time.Millisecond
				}
				defer cancel()
				done := make(chan error, 1)
				go func() { done <- c.Call(ctx, "/v1/catalog", nil, nil) }()
				select {
				case <-entered:
				case <-time.After(5 * time.Second):
					t.Fatal("local HTTP request did not start")
				}
				if stage == "body" {
					select {
					case <-bodyReading:
					case <-time.After(5 * time.Second):
						t.Fatal("Call did not enter response body reading")
					}
				}
				want := context.DeadlineExceeded
				if kind == "cancel" {
					want = context.Canceled
					cancel()
				}
				select {
				case err := <-done:
					if !errors.Is(err, want) {
						t.Fatalf("%s cancellation lost: got %v, want %v", stage, err, want)
					}
					if err.Error() != want.Error() || strings.Contains(err.Error(), server.URL) {
						t.Fatalf("context failure exposed transport diagnostics: %v", err)
					}
				case <-time.After(5 * time.Second):
					t.Fatal("context cancellation did not release Call")
				}
				select {
				case <-stopped:
				case <-time.After(5 * time.Second):
					t.Fatal("HTTP server did not observe request cancellation")
				}
			})
		}
	}
}

type contextRoundTrip func(*http.Request) (*http.Response, error)

func (f contextRoundTrip) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

type contextObservedBody struct {
	io.ReadCloser
	entered chan struct{}
	once    sync.Once
}

func (b *contextObservedBody) Read(p []byte) (int, error) {
	b.once.Do(func() { close(b.entered) })
	return b.ReadCloser.Read(p)
}

type contextReadFailure struct{ err error }

func (r contextReadFailure) Read([]byte) (int, error) { return 0, r.err }
func (r contextReadFailure) Close() error             { return nil }

func TestClientCallKeepsTransportDiagnosticsPrivate(t *testing.T) {
	for _, stage := range []string{"transport", "body"} {
		for _, cause := range []error{nil, context.Canceled, context.DeadlineExceeded} {
			name := stage + "/ordinary"
			if cause != nil {
				name = stage + "/" + cause.Error()
			}
			t.Run(name, func(t *testing.T) {
				c := contextClient(t, "http://127.0.0.1:17920")
				failure := errors.New("secret identity file and endpoint token")
				if cause != nil {
					failure = fmt.Errorf("secret identity file and endpoint token: %w", cause)
				}
				c.HTTP.Transport = contextRoundTrip(func(*http.Request) (*http.Response, error) {
					if stage == "transport" {
						return nil, failure
					}
					return &http.Response{StatusCode: 200, Body: contextReadFailure{failure}, Header: make(http.Header)}, nil
				})
				err := c.Call(context.Background(), "/v1/catalog", nil, nil)
				if err == nil || strings.Contains(err.Error(), "secret") || strings.Contains(err.Error(), "127.0.0.1") {
					t.Fatalf("unsanitized transport failure: %v", err)
				}
				if cause != nil {
					if !errors.Is(err, cause) || err.Error() != cause.Error() {
						t.Fatalf("wrapped context sentinel lost: %v", err)
					}
				} else {
					want := "Link hub unavailable"
					if stage == "body" {
						want = "invalid hub response"
					}
					if err.Error() != want {
						t.Fatalf("ordinary failure changed: %v", err)
					}
				}
			})
		}
	}
}

func TestWaitAndCLIContextStopRetainTheOriginalMessage(t *testing.T) {
	f := fixtureHub(t)
	var session Session
	mustCall(t, f.owner, "/v1/attach", map[string]string{"local_id": "context-executor"}, &session)
	var original Message
	mustCall(t, f.owner, "/v1/send", map[string]string{"session_id": session.ID, "request_id": "context-observe-once", "text": "original task"}, &original)
	for _, consumer := range []string{"Wait", "CLI"} {
		t.Run(consumer, func(t *testing.T) {
			entered := make(chan struct{})
			release := make(chan struct{})
			paths := make(chan string, 4)
			gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				io.Copy(io.Discard, r.Body)
				paths <- r.URL.Path
				if r.URL.Path != "/v1/messages" {
					http.Error(w, "unexpected mutation", http.StatusBadRequest)
					return
				}
				close(entered)
				select {
				case <-r.Context().Done():
				case <-release:
				}
			}))
			defer gateway.Close()
			defer close(release)
			i := f.owner.Identity
			i.URL = gateway.URL
			c, err := NewClient(i)
			if err != nil {
				t.Fatal(err)
			}
			defer c.HTTP.CloseIdleConnections()
			data := t.TempDir()
			if err := writeJSON(filepath.Join(data, "owner.json"), i); err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithCancel(context.Background())
			want := context.Canceled
			if consumer == "CLI" {
				cancel()
				ctx, cancel = context.WithTimeout(context.Background(), 250*time.Millisecond)
				want = context.DeadlineExceeded
			}
			defer cancel()
			done := make(chan error, 1)
			var output, diagnostic bytes.Buffer
			go func() {
				if consumer == "CLI" {
					done <- Run(ctx, []string{"wait", "--data", data, "--id", original.ID}, &output, &diagnostic)
				} else {
					_, err := c.Wait(ctx, original.ID)
					done <- err
				}
			}()
			select {
			case <-entered:
			case <-time.After(5 * time.Second):
				t.Fatal("original message was not observed")
			}
			if consumer == "Wait" {
				cancel()
			}
			select {
			case err := <-done:
				if !errors.Is(err, want) || !strings.Contains(err.Error(), original.ID) || !strings.Contains(err.Error(), "remains on its original executor") {
					t.Fatalf("wait lost context or durable message handle: %v", err)
				}
			case <-time.After(5 * time.Second):
				t.Fatal("wait did not stop")
			}
			if output.Len() != 0 || len(paths) != 1 || <-paths != "/v1/messages" {
				t.Fatal("stopping observation resubmitted/cancelled a task or printed a result")
			}
			var current Message
			mustCall(t, f.owner, "/v1/messages", map[string]string{"id": original.ID}, &current)
			if current.ID != original.ID || current.CoreRequestID != original.CoreRequestID || current.State != "received" || current.CancelRequested {
				t.Fatalf("observing context changed the original durable task: %+v", current)
			}
		})
	}
}

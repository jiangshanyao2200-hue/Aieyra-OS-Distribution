// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: API/images/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestPaidResponseIsRetainedBeforeValidationAndNeverRetried; TestImageSubmissionRequiresPersistedUnknownAndOutputValidator; TestImageDownloadDoesNotForwardCredentialsAndRedirectNeverFollows; TestImageUsageRequiresBothReportedSides
// Impact: python -B scripts/code-atlas.py show API/images/generator_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package images

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/aieyra/aieyra-os/contracts/protocol"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
)

func TestPaidResponseIsRetainedBeforeValidationAndNeverRetried(t *testing.T) {
	for _, mode := range []string{"malformed", "bad-image", "preserve-failed", "http500"} {
		t.Run(mode, func(t *testing.T) {
			events := []string{}
			calls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				events = append(events, "request")
				if r.Header.Get("Authorization") != "Bearer fixture-only" || r.Header.Get("X-Request-ID") != "fixture-request" || r.URL.Path != "/v1/images/generations" {
					t.Error("request contract changed")
				}
				if mode == "http500" {
					w.WriteHeader(500)
					return
				}
				if mode == "malformed" {
					fmt.Fprint(w, "broken")
					return
				}
				fmt.Fprint(w, `{"usage":{"input_tokens":0,"output_tokens":2},"data":[{"b64_json":"eA=="}]}`)
			}))
			defer server.Close()
			gen, err := NewGenerator(server.URL+"/v1", "fixture-only", server.Client(), func(data []byte) (string, error) {
				events = append(events, "inspect")
				return "", errors.New("incomplete image")
			})
			if err != nil {
				t.Fatal(err)
			}
			_, err = gen(context.Background(), protocol.ImageRequest{Prompt: "fixture", Model: "image", Size: "auto"}, Hooks{RequestID: "fixture-request", BeforeSubmit: func() error { events = append(events, "unknown"); return nil }, PreserveResponse: func(raw []byte) error {
				events = append(events, "preserve")
				if len(raw) == 0 {
					t.Error("lost receipt")
				}
				if mode == "preserve-failed" {
					return errors.New("disk full")
				}
				return nil
			}, Usage: func(u protocol.ImageUsage) {
				events = append(events, "usage")
				if u.Input != 0 || u.Output != 2 {
					t.Error(u)
				}
			}})
			var uncertain *protocol.ImageProviderError
			if !errors.As(err, &uncertain) || !uncertain.Unknown || calls != 1 {
				t.Fatal(err, calls)
			}
			want := []string{"unknown", "request"}
			if mode != "http500" {
				want = append(want, "preserve")
			}
			if mode == "bad-image" {
				want = append(want, "usage", "inspect")
			}
			if !reflect.DeepEqual(events, want) {
				t.Fatal(events, want)
			}
		})
	}
}
func TestImageSubmissionRequiresPersistedUnknownAndOutputValidator(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls++ }))
	defer server.Close()
	if _, err := NewGenerator(server.URL, "", nil, nil); err == nil {
		t.Fatal("missing image validation accepted")
	}
	gen, err := NewGenerator(server.URL, "", nil, func([]byte) (string, error) { return "png", nil })
	if err != nil {
		t.Fatal(err)
	}
	sentinel := errors.New("receipt unavailable")
	_, err = gen(context.Background(), protocol.ImageRequest{Prompt: "fixture", Model: "image", Size: "auto"}, Hooks{BeforeSubmit: func() error { return sentinel }})
	if !errors.Is(err, sentinel) || calls != 0 {
		t.Fatal(err, calls)
	}
}
func TestImageDownloadDoesNotForwardCredentialsAndRedirectNeverFollows(t *testing.T) {
	for _, redirect := range []bool{false, true} {
		t.Run(fmt.Sprint(redirect), func(t *testing.T) {
			downloads := 0
			var server *httptest.Server
			server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/image" {
					downloads++
					if r.Header.Get("Authorization") != "" {
						t.Error("credential forwarded to image download")
					}
					fmt.Fprint(w, "image-fixture")
					return
				}
				if redirect {
					http.Redirect(w, r, server.URL+"/image", http.StatusTemporaryRedirect)
					return
				}
				_ = json.NewEncoder(w).Encode(map[string]any{"data": []any{map[string]string{"url": server.URL + "/image"}}})
			}))
			defer server.Close()
			gen, _ := NewGenerator(server.URL, "fixture-only", server.Client(), func(data []byte) (string, error) {
				if string(data) != "image-fixture" {
					return "", errors.New("image changed")
				}
				return "png", nil
			})
			data, err := gen(context.Background(), protocol.ImageRequest{Prompt: "fixture", Model: "image", Size: "auto"}, Hooks{})
			if redirect {
				if err == nil || downloads != 0 {
					t.Fatal(err, downloads)
				}
			} else if err != nil || downloads != 1 || string(data) != "image-fixture" {
				t.Fatal(err, downloads)
			}
		})
	}
}
func TestImageUsageRequiresBothReportedSides(t *testing.T) {
	for _, raw := range []string{`null`, `{}`, `{"input_tokens":0}`, `{"input_tokens":-1,"output_tokens":2}`, `{"input_tokens":1.5,"output_tokens":2}`} {
		if ParseUsage([]byte(raw)) != nil {
			t.Fatal(raw)
		}
	}
	for _, raw := range []string{`{"input_tokens":0,"output_tokens":0}`, `{"prompt_tokens":0,"completion_tokens":0}`} {
		u := ParseUsage([]byte(raw))
		if u == nil || u.Input != 0 || u.Output != 0 {
			t.Fatal(raw, u)
		}
	}
}

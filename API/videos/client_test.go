// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: API/videos/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: fixtureTransport; RoundTrip; fixtureResponse; TestMuseVideoCreatePollAndMediaNeverMixIDsOrCredentials; TestMuseVideoUnknownSubmissionAndUnavailablePollNeverResubmit; TestMuseVideoRejectsBeforePaidBoundaryAndCapturesReceiptForOfflineRecovery
// Impact: python -B scripts/code-atlas.py show API/videos/client_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package videos

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"strings"
	"testing"

	"github.com/aieyra/aieyra-os/contracts/protocol"
)

type fixtureTransport func(*http.Request) (*http.Response, error)

func (f fixtureTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func fixtureResponse(r *http.Request, status int, body string) *http.Response {
	return &http.Response{Request: r, StatusCode: status, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(body))}
}

func TestMuseVideoCreatePollAndMediaNeverMixIDsOrCredentials(t *testing.T) {
	posts, queries, downloads, preserved := 0, 0, 0, 0
	intent := false
	jar, _ := cookiejar.New(nil)
	media, _ := url.Parse("https://media.example.test/")
	jar.SetCookies(media, []*http.Cookie{{Name: "private-cookie", Value: "must-not-leak"}})
	transport := fixtureTransport(func(r *http.Request) (*http.Response, error) {
		if r.URL.Host == "fast.aieyra.cn" {
			if r.Header.Get("Authorization") != "Bearer fixture-only" {
				t.Fatal("provider authentication missing")
			}
			if r.Method == "POST" {
				posts++
				var body map[string]any
				_ = json.NewDecoder(r.Body).Decode(&body)
				if !intent || len(body) != 4 || body["seconds"] != "6" || body["duration"] != float64(6) || body["model"] != "muse-video" || r.URL.Path != "/v1/videos" || r.Header.Get("Content-Type") != "application/json" {
					t.Fatal("paid request preceded its intent or used wrong wire fields", body)
				}
				return fixtureResponse(r, 200, `{"id":"task_public","task_id":"task_public","status":"queued","progress":0}`), nil
			}
			queries++
			if r.URL.Path != "/v1/videos/task_public" || r.Method != "GET" || r.URL.RawQuery != "" {
				t.Fatal("status did not use the original public task route")
			}
			return fixtureResponse(r, 200, `{"id":"task_public","status":"completed","result":{"url":"https://media.example.test/movie.mp4?signature=fixture"}}`), nil
		}
		downloads++
		if r.Header.Get("Authorization") != "" || r.Header.Get("Cookie") != "" || r.Method != "GET" {
			t.Fatal("media request carried private authentication")
		}
		if downloads == 1 {
			response := fixtureResponse(r, 302, "")
			response.Header.Set("Location", "https://cdn.example.test/movie.mp4")
			return response, nil
		}
		return fixtureResponse(r, 200, "fixture-media-bytes"), nil
	})
	c, err := NewClient("https://fast.aieyra.cn/v1", "fixture-only", &http.Client{Transport: transport, Jar: jar})
	if err != nil {
		t.Fatal(err)
	}
	save := func(raw []byte) error { preserved++; return nil }
	task, err := c.Create(context.Background(), protocol.VideoRequest{Model: "muse-video", Prompt: "A quiet river", Duration: 6}, Hooks{BeforeSubmit: func() error { intent = true; return nil }, PreserveResponse: save})
	if err != nil || task.ID != "task_public" || preserved != 1 {
		t.Fatal(task, err, preserved)
	}
	task, err = c.Status(context.Background(), task.ID, save)
	if err != nil {
		t.Fatal(err)
	}
	var output bytes.Buffer
	n, err := c.Download(context.Background(), task, &output)
	if err != nil || n != int64(output.Len()) || output.String() != "fixture-media-bytes" || posts != 1 || queries != 1 || downloads != 2 || preserved != 2 {
		t.Fatal("video lifecycle lost or repeated an operation", err, posts, queries, downloads, preserved)
	}
}

func TestMuseVideoUnknownSubmissionAndUnavailablePollNeverResubmit(t *testing.T) {
	for _, scenario := range []string{"network", "invalid_json", "missing_id", "mixed_ids", "wrong_model", "save_failed", "server_failed", "poll_failed", "wrong_poll_id"} {
		t.Run(scenario, func(t *testing.T) {
			calls, saved := 0, 0
			c, err := NewClient("https://fast.aieyra.cn/v1", "fixture-only", &http.Client{Transport: fixtureTransport(func(r *http.Request) (*http.Response, error) {
				calls++
				body, status := `{"id":"task_public","status":"queued"}`, 200
				switch scenario {
				case "network":
					return nil, errors.New("fixture secret must not reach error output")
				case "invalid_json":
					body = "{"
				case "missing_id":
					body = `{"status":"queued"}`
				case "mixed_ids":
					body = `{"id":"task_public","task_id":"task_upstream","status":"queued"}`
				case "wrong_model":
					body = `{"id":"task_public","model":"unexpected-model","status":"queued"}`
				case "server_failed", "poll_failed":
					body, status = `{"error":"channel is nil"}`, 503
				case "wrong_poll_id":
					body = `{"id":"task_other","status":"completed"}`
				}
				return fixtureResponse(r, status, body), nil
			})})
			if err != nil {
				t.Fatal(err)
			}
			preserve := func(raw []byte) error {
				saved++
				if scenario == "save_failed" {
					return errors.New("disk fixture")
				}
				return nil
			}
			poll := scenario == "poll_failed" || scenario == "wrong_poll_id"
			if poll {
				_, err = c.Status(context.Background(), "task_public", preserve)
			} else {
				_, err = c.Create(context.Background(), protocol.VideoRequest{Model: "muse-video", Prompt: "fixture", Duration: 6}, Hooks{BeforeSubmit: func() error { return nil }, PreserveResponse: preserve})
			}
			var provider *protocol.VideoProviderError
			if !errors.As(err, &provider) || provider.Unknown == poll || calls != 1 || strings.Contains(err.Error(), "secret") || scenario != "network" && saved != 1 {
				t.Fatal("unknown result was retried, lost or misclassified", calls, saved, err)
			}
		})
	}
}

func TestMuseVideoRejectsBeforePaidBoundaryAndCapturesReceiptForOfflineRecovery(t *testing.T) {
	c, _ := NewClient("https://fast.aieyra.cn/v1", "fixture-only", &http.Client{Transport: fixtureTransport(func(*http.Request) (*http.Response, error) {
		t.Fatal("invalid input reached provider")
		return nil, nil
	})})
	for _, input := range []protocol.VideoRequest{{Model: "muse-video", Duration: 6}, {Model: "muse-video", Prompt: "fixture", Duration: 0}, {Model: "muse-video", Prompt: "fixture", Duration: 31}, {Model: "muse-spark", Prompt: "fixture", Duration: 6}} {
		if _, err := c.Create(context.Background(), input, Hooks{BeforeSubmit: func() error { t.Error("invalid input committed intent"); return nil }, PreserveResponse: func([]byte) error { return nil }}); err == nil {
			t.Fatal("accepted invalid video input")
		}
	}
	if _, err := c.Create(context.Background(), protocol.VideoRequest{Model: "muse-video", Prompt: "fixture", Duration: 6}, Hooks{BeforeSubmit: func() error { return errors.New("disk full") }, PreserveResponse: func([]byte) error { return nil }}); err == nil {
		t.Fatal("submission ignored intent persistence failure")
	}
	if _, err := c.Status(context.Background(), "../task_elsewhere", nil); err == nil {
		t.Fatal("escaping task ID accepted")
	}
	for _, target := range []string{"http://media.example.test/file", "https://user:fixture@example.com/file"} {
		if _, err := c.Download(context.Background(), protocol.VideoTask{ID: "task_public", State: "completed", URL: target}, &bytes.Buffer{}); err == nil {
			t.Fatal("invalid download route accepted")
		}
	}
	recovered, err := DecodeTask([]byte(`{"task_id":"task_public","status":"processing"}`), "")
	if err != nil || recovered.ID != "task_public" {
		t.Fatal("saved response could not recover the original task offline", err)
	}
	for _, state := range []string{"processing", "in_progress"} {
		recovered, err = DecodeTask([]byte(`{"id":"task_public","status":"`+state+`"}`), "task_public")
		if err != nil || recovered.State != "processing" {
			t.Fatal("standard video progress state not recognized", recovered, err)
		}
	}
	recovered, err = DecodeTask([]byte(`{"id":"task_public","status":"completed","metadata":{"url":"https://media.example.test/movie.mp4"}}`), "task_public")
	if err != nil || recovered.URL != "https://media.example.test/movie.mp4" {
		t.Fatal("standard media metadata was lost", err)
	}
}

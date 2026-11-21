// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: API/images/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: museImageTransport; RoundTrip; TestMuseImageURLUsesMinimalFieldsAndNeverForwardsCredentials
// Impact: python -B scripts/code-atlas.py show API/images/muse_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package images

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/aieyra/aieyra-os/contracts/protocol"
)

type museImageTransport func(*http.Request) (*http.Response, error)

func (f museImageTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestMuseImageURLUsesMinimalFieldsAndNeverForwardsCredentials(t *testing.T) {
	posts, downloads, preserved, unknown := 0, 0, 0, 0
	client := &http.Client{Transport: museImageTransport(func(r *http.Request) (*http.Response, error) {
		body := "image-bytes"
		if r.Method == "POST" {
			posts++
			var b map[string]any
			if e := json.NewDecoder(r.Body).Decode(&b); e != nil {
				t.Fatal(e)
			}
			if len(b) != 4 || b["n"] != float64(1) || b["response_format"] != "url" || b["model"] != "muse-image" || !strings.Contains(b["prompt"].(string), "1024x1536") {
				t.Fatal(b)
			}
			if r.Header.Get("Authorization") != "Bearer fixture-only" || r.URL.Path != "/v1/images/generations" {
				t.Fatal("wrong submission")
			}
			body = `{"usage":{"input_tokens":0,"output_tokens":0},"data":[{"url":"https://media.example.test/output.webp?signature=fixture"}]}`
		} else {
			downloads++
			if r.Method != "GET" || r.Header.Get("Authorization") != "" || r.URL.Hostname() != "media.example.test" {
				t.Fatal("credentials or route crossed")
			}
		}
		return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": []string{"application/octet-stream"}}, Body: io.NopCloser(strings.NewReader(body)), Request: r}, nil
	})}
	gen, e := NewGenerator("https://fast.aieyra.cn/v1", "fixture-only", client, func(b []byte) (string, error) {
		if string(b) != "image-bytes" {
			t.Fatal("image validation did not get downloaded bytes")
		}
		return "webp", nil
	})
	if e != nil {
		t.Fatal(e)
	}
	input := protocol.ImageRequest{Model: "muse-image", Prompt: "a lamp", Size: "1024x1536", Quality: "high", OutputFormat: "png"}
	_, e = gen(context.Background(), input, Hooks{BeforeSubmit: func() error { unknown++; return nil }, PreserveResponse: func([]byte) error { preserved++; return nil }, Usage: func(protocol.ImageUsage) { t.Error("unreliable zero promoted to real usage") }})
	if e != nil || posts != 1 || downloads != 1 || preserved != 1 || unknown != 1 {
		t.Fatal(posts, downloads, preserved, unknown, e)
	}
	input.Operation = "edit"
	if _, e = gen(context.Background(), input, Hooks{}); e == nil || posts != 1 {
		t.Fatal("unverified edit submitted", e)
	}
}

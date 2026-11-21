// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: API/images/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestPaidURLRecoveryNeverResubmitsOrForwardsCredentials; TestPaidRecoveryRequiresAdmissionAndNeverFollowsRedirects; TestPaidReceiptUsageDoesNotTrustUnknownOriginsOrMuseEstimates
// Impact: python -B scripts/code-atlas.py show API/images/recovery_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package images

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/aieyra/aieyra-os/contracts/protocol"
)

func TestPaidURLRecoveryNeverResubmitsOrForwardsCredentials(t *testing.T) {
	posts, downloads := 0, 0
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			posts++
			fmt.Fprintf(w, `{"usage":{"input_tokens":7,"output_tokens":9},"data":[{"url":%q}]}`, server.URL+"/image?private-signature=fixture")
			return
		}
		downloads++
		if r.Header.Get("Authorization") != "" || r.Header.Get("Cookie") != "" || r.URL.Path != "/image" {
			t.Error("download forwarded credentials or changed its URL")
		}
		if downloads == 1 {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		fmt.Fprint(w, "image-fixture")
	}))
	defer server.Close()
	client := server.Client()
	client.Jar, _ = cookiejar.New(nil)
	origin, _ := url.Parse(server.URL)
	client.Jar.SetCookies(origin, []*http.Cookie{{Name: "provider-session", Value: "fixture-only"}})
	inspect := func(b []byte) (string, error) {
		if string(b) != "image-fixture" {
			return "", errors.New("unexpected image")
		}
		return "png", nil
	}
	generate, err := NewGenerator(server.URL, "fixture-only", client, inspect)
	if err != nil {
		t.Fatal(err)
	}
	var paid []byte
	usage := []protocol.ImageUsage{}
	_, err = generate(context.Background(), protocol.ImageRequest{Prompt: "fixture", Model: "image", Size: "auto"}, Hooks{
		PreserveResponse: func(data []byte) error { paid = append([]byte(nil), data...); return nil },
		Usage:            func(u protocol.ImageUsage) { usage = append(usage, u) },
	})
	if err == nil || len(paid) == 0 || strings.Contains(err.Error(), "private-signature") {
		t.Fatal("paid download failure lost or exposed its receipt", err)
	}
	data, err := Recover(context.Background(), paid, Recovery{
		BaseURL: server.URL, Model: "image", Client: client, Inspect: inspect,
		BeforeDownload: func() error { return nil }, Usage: func(u protocol.ImageUsage) { usage = append(usage, u) },
	})
	if err != nil || string(data) != "image-fixture" || posts != 1 || downloads != 2 || len(usage) != 2 || usage[1].Input != 7 || usage[1].Output != 9 {
		t.Fatal("recovery replayed generation or lost real usage", posts, downloads, usage, err)
	}
	if len(client.Jar.Cookies(origin)) != 1 {
		t.Fatal("download mutated the caller's cookie jar")
	}
}

func TestPaidRecoveryRequiresAdmissionAndNeverFollowsRedirects(t *testing.T) {
	requests, destination := 0, 0
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		if r.Method != http.MethodGet {
			t.Error("recovery attempted a generation request")
		}
		if r.URL.Path == "/destination" {
			destination++
		}
		http.Redirect(w, r, server.URL+"/destination", http.StatusTemporaryRedirect)
	}))
	defer server.Close()
	raw := []byte(fmt.Sprintf(`{"usage":{"input_tokens":0,"output_tokens":2},"data":[{"url":%q}]}`, server.URL+"/image"))
	inspect := func([]byte) (string, error) { return "png", nil }
	for _, mode := range []string{"no-admission", "revoked", "cancelled", "redirect"} {
		t.Run(mode, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			options := Recovery{BaseURL: server.URL, Model: "image", Client: server.Client(), Inspect: inspect}
			switch mode {
			case "revoked":
				options.BeforeDownload = func() error { return errors.New("original connection revoked") }
			case "cancelled":
				options.BeforeDownload = func() error { cancel(); return nil }
			case "redirect":
				options.BeforeDownload = func() error { return nil }
			}
			before := requests
			if _, err := Recover(ctx, raw, options); err == nil {
				t.Fatal("unresolved recovery reported success")
			}
			want := before
			if mode == "redirect" {
				want++
			}
			if requests != want || destination != 0 {
				t.Fatal("recovery bypassed admission or followed redirect", requests, want, destination)
			}
		})
	}
}

func TestPaidReceiptUsageDoesNotTrustUnknownOriginsOrMuseEstimates(t *testing.T) {
	raw := []byte(`{"usage":{"input_tokens":0,"output_tokens":0},"data":[{"b64_json":"eA=="}]}`)
	credentialOrigin := &url.URL{Scheme: "https", Host: "provider.invalid", Path: "/v1", User: url.UserPassword("synthetic-user", "synthetic-pass")}
	for _, origin := range []string{"", credentialOrigin.String(), "https://fast.aieyra.cn/v1"} {
		if got := ReceiptUsage(raw, origin, "muse-image"); got != nil {
			t.Fatal("untrusted usage became a real charge", origin, got)
		}
	}
	if got := ReceiptUsage(raw, "https://provider.invalid/v1", "image"); got == nil || got.Input != 0 || got.Output != 0 {
		t.Fatal("explicit zero usage was lost", got)
	}
	if got := ReceiptUsage([]byte(`{"usage":{"input_tokens":2},"data":[]}`), "https://provider.invalid/v1", "image"); got != nil {
		t.Fatal("partial usage became known", got)
	}
}

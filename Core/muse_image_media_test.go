// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestMuseWebPOriginalSurvivesDownloadAlbumAndImageReference
// Impact: python -B scripts/code-atlas.py show Core/muse_image_media_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/aieyra/aieyra-os/api/images"
	"github.com/aieyra/aieyra-os/contracts/protocol"
)

// A complete synthetic 3x2 lossless WebP, not a renamed PNG. The same bytes
// cross the provider, real decoder, immutable album, tool snapshot and wire.
func TestMuseWebPOriginalSurvivesDownloadAlbumAndImageReference(t *testing.T) {
	data, err := base64.StdEncoding.DecodeString("UklGRh4AAABXRUJQVlA4TBEAAAAvAkAAAAdQrXqUtv+BiOh/AAA=")
	if err != nil {
		t.Fatal(err)
	}
	posts, downloads, preserved := 0, 0, 0
	client := &http.Client{Transport: museCoreTransport(func(r *http.Request) (*http.Response, error) {
		var body []byte
		if r.Method == "POST" {
			posts++
			var input map[string]any
			if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
				t.Fatal(err)
			}
			if input["model"] != "muse-image" || input["n"] != float64(1) || r.Header.Get("Authorization") != "Bearer fixture-only" {
				t.Fatal("generation contract changed")
			}
			body = []byte(`{"data":[{"url":"https://media.example.test/result.webp?sig=fixture"}],"usage":{"input_tokens":0,"output_tokens":0}}`)
		} else {
			downloads++
			if r.Header.Get("Authorization") != "" || r.Header.Get("Cookie") != "" {
				t.Fatal("media download received API credentials")
			}
			body = data
		}
		return &http.Response{StatusCode: 200, Header: http.Header{}, Body: io.NopCloser(bytes.NewReader(body)), Request: r}, nil
	})}
	gen, err := images.NewGenerator("https://fast.aieyra.cn/v1", "fixture-only", client, inspectGeneratedImage)
	if err != nil {
		t.Fatal(err)
	}
	picture, err := gen(context.Background(), protocol.ImageRequest{Model: "muse-image", Prompt: "synthetic blue cup", Size: "1024x1024"}, images.Hooks{BeforeSubmit: func() error { return nil }, PreserveResponse: func([]byte) error { preserved++; return nil }, Usage: func(protocol.ImageUsage) { t.Error("unknown usage became real zero") }})
	if err != nil || posts != 1 || downloads != 1 || preserved != 1 || !bytes.Equal(picture, data) {
		t.Fatal("download or actual WebP decode failed", posts, downloads, preserved, err)
	}
	m := shellTestManager(t)
	dir := filepath.Join(m.root, "album")
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	item, err := saveGeneratedImage(dir, picture, generatedImage{})
	if err != nil {
		t.Fatal(err)
	}
	if item.MIME != "image/webp" || item.Width != 3 || item.Height != 2 || filepath.Ext(item.Path) != ".webp" {
		t.Fatal("requested framing replaced actual metadata", item)
	}
	stored, err := os.ReadFile(item.Path)
	if err != nil || !bytes.Equal(stored, data) {
		t.Fatal("original bytes changed", err)
	}
	result, attachments := m.viewImage(WithToolImages(context.Background(), true), executionCall("view_image", ImageRequest{Path: item.Path}))
	if !result.OK || result.MIME != "image/webp" || len(attachments) != 1 {
		t.Fatal("cannot inspect generated original", result)
	}
	remaining := imageRequestByteLimit
	wire := readRequestImage(attachments[0], &remaining)
	if !strings.HasPrefix(wire.DataURL, "data:image/webp;base64,") {
		t.Fatal("reference lost actual MIME", wire.Text)
	}
	snapshot, err := m.toolImage(attachments[0].SHA256)
	if err != nil || snapshot["mime"] != "image/webp" {
		t.Fatal("viewer snapshot unavailable", err)
	}
	if _, err := inspectGeneratedImage(data[:len(data)-8]); err == nil {
		t.Fatal("truncated WebP accepted")
	}
	if err := os.WriteFile(attachments[0].Asset, []byte("changed"), 0600); err != nil {
		t.Fatal(err)
	}
	remaining = imageRequestByteLimit
	if readRequestImage(attachments[0], &remaining).DataURL != "" {
		t.Fatal("tampered snapshot reused")
	}
}

// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestImageGenEditMultipartAndImmutableAlbum; TestImageGenUnknownStopsBatchAndKeepsSuccess; TestImageGenCancellationStopsSubmittedRequestWithoutReplay; TestImageGenRejectsInvalidBeforeCharging; TestModelsDiscoveryDoesNotExposeCredentials; TestViewImageContactSheetMappingAndAlpha
// Impact: python -B scripts/code-atlas.py show Core/image_generation_contract_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestImageGenEditMultipartAndImmutableAlbum(t *testing.T) {
	picture := imageGenTestPNG(t)
	reference := filepath.Join(t.TempDir(), "参考图.png")
	_ = os.WriteFile(reference, picture, 0600)
	mask := image.NewNRGBA(image.Rect(0, 0, 16, 12))
	mask.Set(0, 0, color.NRGBA{R: 255, A: 128})
	var buf bytes.Buffer
	_ = png.Encode(&buf, mask)
	maskPath := filepath.Join(t.TempDir(), "mask.png")
	_ = os.WriteFile(maskPath, buf.Bytes(), 0600)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/images/edits" {
			t.Error(r.URL.Path)
		}
		if err := r.ParseMultipartForm(4 << 20); err != nil {
			t.Error(err)
			return
		}
		defer r.MultipartForm.RemoveAll()
		if r.FormValue("model") != "img-model" || r.FormValue("prompt") != "red bicycle" || r.FormValue("quality") != "high" {
			t.Error(r.Form)
		}
		for field, want := range map[string][]byte{"image": picture, "mask": buf.Bytes()} {
			f, _, err := r.FormFile(field)
			if err != nil {
				t.Error(err)
				continue
			}
			got, _ := io.ReadAll(f)
			f.Close()
			if !bytes.Equal(got, want) {
				t.Error("multipart input changed", field)
			}
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"data": []any{map[string]any{"b64_json": base64.StdEncoding.EncodeToString(picture)}}})
	}))
	defer server.Close()
	config := imageGenTestConfig(t, server.URL, true)
	result, err := runImageGen(context.WithValue(context.Background(), imageGenTaskKey{}, "owned-task"), config, rawJSON(map[string]any{"operation": "edit", "prompt": "red bicycle", "images": []string{reference}, "mask": maskPath, "quality": "high"}))
	if err != nil || len(result.Images) != 1 {
		t.Fatalf("%+v %v", result, err)
	}
	image := result.Images[0]
	if image.Operation != "edit" || image.Width != 16 || image.Height != 12 || image.TaskID != "owned-task" || image.SourcePaths[0] != reference {
		t.Fatal(image)
	}
	index, err := readGeneratedIndex(filepath.Join(DataDir(config), "generated-images"))
	if err != nil || len(index.Images) != 1 {
		t.Fatal(index, err)
	}
	original, _ := os.ReadFile(reference)
	if !bytes.Equal(original, picture) {
		t.Fatal("reference overwritten")
	}
}

func TestImageGenUnknownStopsBatchAndKeepsSuccess(t *testing.T) {
	for _, mode := range []string{"http500", "broken200"} {
		t.Run(mode, func(t *testing.T) {
			calls := 0
			picture := imageGenTestPNG(t)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				if calls == 1 {
					_ = json.NewEncoder(w).Encode(map[string]any{"data": []any{map[string]any{"b64_json": base64.StdEncoding.EncodeToString(picture)}}})
					return
				}
				if mode == "http500" {
					w.WriteHeader(500)
				}
				_, _ = w.Write([]byte("{broken"))
			}))
			defer server.Close()
			result, err := runImageGen(context.Background(), imageGenTestConfig(t, server.URL, true), rawJSON(map[string]any{"prompt": "a cat", "count": 4}))
			if err != nil || calls != 2 || !result.Unknown || len(result.Images) != 1 || len(result.Failed) != 1 || result.Failed[0].State != "unknown" {
				t.Fatal(result, err, calls)
			}
			if _, err := os.Stat(result.Paths[0]); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestImageGenCancellationStopsSubmittedRequestWithoutReplay(t *testing.T) {
	started := make(chan struct{}, 1)
	release := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		started <- struct{}{}
		select {
		case <-r.Context().Done():
		case <-release:
		}
	}))
	defer server.Close()
	defer close(release)
	config := imageGenTestConfig(t, server.URL, true)
	raw := rawJSON(map[string]any{"prompt": "cancel this submitted image", "count": 4})
	// Package installation is fixture setup, not provider cancellation latency.
	// Keep real admission enabled for the request below, without charging here.
	if err := admitOfficialToolCall(context.WithValue(context.Background(), officialToolConfigKey{}, config), ToolCall{Function: FunctionCall{Name: "image_gen", Arguments: string(raw)}}); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan imageGenResult, 1)
	finished := make(chan struct{})
	go func() {
		defer close(finished)
		result, _ := runImageGen(ctx, config, raw)
		done <- result
	}()
	defer func() {
		cancel()
		// Join before TempDir cleanup, including an early assertion failure.
		select {
		case <-finished:
		case <-time.After(5 * time.Second):
			t.Error("image generation goroutine did not finish after cancellation")
		}
	}()
	select {
	case <-started:
	case <-time.After(3 * time.Second):
		t.Fatal("image request was not submitted")
	}
	cancel()
	select {
	case result := <-done:
		if !result.Unknown || len(result.Images) != 0 || len(result.Failed) != 1 || result.Failed[0].State != "unknown" {
			t.Fatalf("submitted cancellation lost its uncertain outcome: %+v", result)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("cancel did not release image generation promptly")
	}
	select {
	case <-started:
		t.Fatal("cancelled batch submitted another chargeable request")
	default:
	}
	if _, err := runImageGen(ctx, config, rawJSON(map[string]any{"prompt": "already cancelled"})); err == nil {
		t.Fatal("already cancelled request succeeded")
	}
	select {
	case <-started:
		t.Fatal("already cancelled operation reached provider")
	default:
	}
}

func TestImageGenRejectsInvalidBeforeCharging(t *testing.T) {
	hits := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { hits++ }))
	defer server.Close()
	config := imageGenTestConfig(t, server.URL, true)
	for _, a := range []map[string]any{{"prompt": "cat", "count": 101}, {"prompt": "cat", "profile_id": "foreign"}, {"operation": "edit", "prompt": "cat"}, {"prompt": "cat", "quality": "invalid"}} {
		if _, err := runImageGen(context.Background(), config, rawJSON(a)); err == nil {
			t.Fatal("accepted", a)
		}
	}
	dir := filepath.Join(DataDir(config), "generated-images")
	_ = os.MkdirAll(dir, 0700)
	bad := []byte("{damaged")
	_ = os.WriteFile(filepath.Join(dir, "index.json"), bad, 0600)
	if _, err := runImageGen(context.Background(), config, rawJSON(map[string]any{"prompt": "cat"})); err == nil {
		t.Fatal("corrupt history replaced")
	}
	got, _ := os.ReadFile(filepath.Join(dir, "index.json"))
	if hits != 0 || !bytes.Equal(got, bad) {
		t.Fatal("charged or replaced corrupt index", hits)
	}
}

func TestModelsDiscoveryDoesNotExposeCredentials(t *testing.T) {
	config := imageGenTestConfig(t, "https://provider.invalid/v1", true)
	value, err := discoverModels(config, rawJSON(map[string]any{"category": "image"}))
	if err != nil {
		t.Fatal(err)
	}
	out := string(rawJSON(value))
	if strings.Contains(out, "fake-key-only") || strings.Contains(out, "api_key") || !strings.Contains(out, "provider.invalid") || !strings.Contains(out, "image-model") || !strings.Contains(out, "saved_configuration") {
		t.Fatal(out)
	}
}

func TestViewImageContactSheetMappingAndAlpha(t *testing.T) {
	m := shellTestManager(t)
	source := imageFixture(t, m)
	result, attachments := m.viewImage(WithToolImages(context.Background(), true), executionCall("view_image", ImageRequest{Paths: []string{source, source}, Layout: "row"}))
	if !result.OK || len(attachments) != 1 || result.Layout == nil || len(result.Layout.Tiles) != 2 || result.Layout.Tiles[1].Index != 2 || result.Width > 2048 || result.Height > 2048 {
		t.Fatal(result)
	}
	data, _ := os.ReadFile(attachments[0].Asset)
	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	r, g, b, a := img.At(result.Width/2, result.Height-2).RGBA()
	if r < 55000 || g < 55000 || b < 55000 || a != 65535 {
		t.Fatal("alpha became black", r, g, b, a)
	}
	bad, _ := m.viewImage(WithToolImages(context.Background(), true), executionCall("view_image", ImageRequest{Path: source, Paths: []string{source, source}}))
	if bad.OK {
		t.Fatal("ambiguous inputs accepted")
	}
}

// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: imageGenTestPNG; imageGenTestConfig; TestImageGenRefusesWithoutDefault; TestImageGenUsesDefaultOrAnyAvailablePoolModel; TestImageGenSavesGeneratedImages
// Impact: python -B scripts/code-atlas.py show Core/toolbox_image_test.go
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
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
)

func imageGenTestPNG(t *testing.T) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 16, 12))
	for y := 0; y < 12; y++ {
		for x := 0; x < 16; x++ {
			img.SetRGBA(x, y, color.RGBA{R: uint8(x * 9), G: uint8(y * 9), B: 90, A: 255})
		}
	}
	var out bytes.Buffer
	if err := png.Encode(&out, img); err != nil {
		t.Fatal(err)
	}
	return out.Bytes()
}

func imageGenTestConfig(t *testing.T, base string, enabled bool) string {
	t.Helper()
	config := filepath.Join(t.TempDir(), "config.json")
	s := Defaults()
	s.SetPath(config)
	s.ModelPoolVersion = 1
	s.ProviderConnections = []ProviderConnection{{ID: "local", Provider: "custom", BaseURL: base, APIKey: "fake-key-only", RequestTimeout: 10}}
	s.APIProfiles = []APIProfile{{ID: "image-model", Name: "测试生图", ConnectionID: "local", Model: "img-model", Adapter: "openai", Protocol: ProtocolChat, BaseURL: base}}
	if err := s.Save(); err != nil {
		t.Fatal(err)
	}
	data, _ := os.ReadFile(config)
	var v map[string]any
	_ = json.Unmarshal(data, &v)
	v["image_profiles"] = []any{"image-model"}
	v["image_generation_enabled"] = enabled
	data, _ = json.Marshal(v)
	if err := os.WriteFile(config, data, 0600); err != nil {
		t.Fatal(err)
	}
	return config
}

func TestImageGenRefusesWithoutDefault(t *testing.T) {
	var hits atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { hits.Add(1) }))
	defer server.Close()
	config := imageGenTestConfig(t, server.URL, false)
	if choice := resolveImageGenChoice(config); !choice.Ready {
		t.Fatal("legacy switch must not disable a configured default", choice)
	}
	data, _ := os.ReadFile(config)
	var settings map[string]any
	_ = json.Unmarshal(data, &settings)
	settings["image_profiles"] = []string{}
	data, _ = json.Marshal(settings)
	_ = os.WriteFile(config, data, 0600)
	_, err := runImageGen(context.Background(), config, rawJSON(map[string]any{"prompt": "a cat"}))
	if err == nil || !strings.Contains(err.Error(), "还没有选生图模型") {
		t.Fatalf("unconfigured image_gen must refuse with the reason, got %v", err)
	}
	if hits.Load() != 0 {
		t.Fatal("no request may be sent without a default model")
	}
	if got := resolveImageGenChoice(filepath.Join(t.TempDir(), "missing.json")); got.Ready || got.Reason != "还没有选生图模型" {
		t.Fatalf("missing config: %+v", got)
	}
}

func TestImageGenUsesDefaultOrAnyAvailablePoolModel(t *testing.T) {
	picture := imageGenTestPNG(t)
	var models []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		models = append(models, memString(body["model"]))
		_ = json.NewEncoder(w).Encode(map[string]any{"data": []any{map[string]any{"b64_json": base64.StdEncoding.EncodeToString(picture)}}})
	}))
	defer server.Close()
	config := imageGenTestConfig(t, server.URL, false)
	data, _ := os.ReadFile(config)
	var raw map[string]any
	_ = json.Unmarshal(data, &raw)
	profiles := raw["api_profiles"].([]any)
	other := map[string]any{}
	for k, v := range profiles[0].(map[string]any) {
		other[k] = v
	}
	other["id"] = "other-pool-model"
	other["model"] = "multimodal-other"
	other["kind"] = "chat"
	raw["api_profiles"] = append(profiles, other)
	data, _ = json.Marshal(raw)
	_ = os.WriteFile(config, data, 0600)
	for _, id := range []string{"", "other-pool-model"} {
		if _, err := runImageGen(context.Background(), config, rawJSON(map[string]any{"prompt": "a local fixture", "profile_id": id})); err != nil {
			t.Fatal(err)
		}
	}
	if len(models) != 2 || models[0] != "img-model" || models[1] != "multimodal-other" {
		t.Fatal(models)
	}
	after, _ := os.ReadFile(config)
	if !bytes.Equal(after, data) {
		t.Fatal("override changed default configuration")
	}
	if _, err := runImageGen(context.Background(), config, rawJSON(map[string]any{"prompt": "must not run", "profile_id": "outside-pool"})); err == nil {
		t.Fatal("outside pool accepted")
	}
	other["enabled"] = false
	data, _ = json.Marshal(raw)
	_ = os.WriteFile(config, data, 0600)
	if _, err := runImageGen(context.Background(), config, rawJSON(map[string]any{"prompt": "must not run", "profile_id": "other-pool-model"})); err == nil {
		t.Fatal("disabled model accepted")
	}
	if len(models) != 2 {
		t.Fatal("invalid override submitted a request")
	}
}

func TestImageGenSavesGeneratedImages(t *testing.T) {
	picture := imageGenTestPNG(t)
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		if r.URL.Path != "/images/generations" || body["model"] != "img-model" || body["n"] != float64(1) || body["size"] != "1536x1024" || r.Header.Get("Authorization") != "Bearer fake-key-only" {
			t.Errorf("unexpected image request %s %v", r.URL.Path, body)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"data": []any{map[string]any{"b64_json": base64.StdEncoding.EncodeToString(picture)}}})
	}))
	defer server.Close()
	config := imageGenTestConfig(t, server.URL, true)
	result, err := runImageGen(context.Background(), config, rawJSON(map[string]any{"prompt": "a cat", "count": 4, "size": "1536x1024"}))
	if err != nil {
		t.Fatal(err)
	}
	if requests.Load() != 4 || len(result.Paths) != 4 || result.Model != "测试生图" {
		t.Fatalf("explicit batch of four: requests=%d result=%+v", requests.Load(), result)
	}
	data, err := os.ReadFile(result.Paths[0])
	if err != nil || !bytes.Equal(data, picture) || filepath.Dir(result.Paths[0]) != filepath.Join(filepath.Dir(config), "generated-images") {
		t.Fatalf("saved image mismatch: %v %s", err, result.Paths[0])
	}
	if _, err := runImageGen(context.Background(), config, rawJSON(map[string]any{"prompt": "a cat", "size": "9x9"})); err == nil {
		t.Fatal("unknown size must be refused")
	}
}

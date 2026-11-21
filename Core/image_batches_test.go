// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestImageDurableBatchResumesOnlyUnsentAndDefaultsHigh; TestImageBatchLockAndBoundedConcurrency; TestImageInterruptedBatchNeverReplaysAndPreservesDamagedRecord; TestImagePaidOutputCanRecoverLocallyWithoutChargingAgain
// Impact: python -B scripts/code-atlas.py show Core/image_batches_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestImageDurableBatchResumesOnlyUnsentAndDefaultsHigh(t *testing.T) {
	picture := imageGenTestPNG(t)
	var calls atomic.Int32
	var mu sync.Mutex
	ids := map[string]bool{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := calls.Add(1)
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		if body["quality"] != "high" {
			t.Error("default quality", body["quality"])
		}
		id := r.Header.Get("X-Client-Request-Id")
		mu.Lock()
		if id == "" || ids[id] {
			t.Error("missing/repeated request", id)
		}
		ids[id] = true
		mu.Unlock()
		if n == 2 {
			w.WriteHeader(500)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"data": []any{map[string]string{"b64_json": base64.StdEncoding.EncodeToString(picture)}}})
	}))
	defer server.Close()
	config := imageGenTestConfig(t, server.URL, true)
	args := rawJSON(map[string]any{"action": "create", "request_id": "durable-test", "count": 7, "prompt": "a detailed watercolor landscape"})
	created, err := runImageGen(context.Background(), config, args)
	if err != nil || calls.Load() != 0 || created.Requested != 7 {
		t.Fatal(created, err, calls.Load())
	}
	first, err := runImageGen(context.Background(), config, rawJSON(map[string]any{"action": "run", "batch_id": created.BatchID, "max_items": 3}))
	if err != nil || first.Completed != 1 || !first.Unknown || first.Unsubmitted != 5 {
		t.Fatal(first, err)
	}
	// Read the file through a new call: no in-memory batch object is reused.
	next, err := runImageGen(context.Background(), config, rawJSON(map[string]any{"action": "run", "batch_id": created.BatchID, "max_items": 3}))
	if err != nil || next.Completed != 4 || calls.Load() != 5 || !next.Unknown {
		t.Fatal(next, err, calls.Load())
	}
	replay, err := runImageGen(context.Background(), config, args)
	if err != nil || replay.Completed != 4 || calls.Load() != 5 {
		t.Fatal("create replay charged", replay, err)
	}
	if _, err = runImageGen(context.Background(), config, rawJSON(map[string]any{"request_id": "durable-test", "prompt": "different"})); err == nil {
		t.Fatal("request identity changed")
	}
	if _, err = runImageGen(context.Background(), config, rawJSON(map[string]any{"prompt": "quick", "quality": "low"})); err == nil || calls.Load() != 5 {
		t.Fatal("silent downgrade")
	}
}

func TestImageBatchLockAndBoundedConcurrency(t *testing.T) {
	picture := imageGenTestPNG(t)
	var active, peak, calls atomic.Int32
	started := make(chan struct{}, 10)
	release := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		n := active.Add(1)
		for {
			old := peak.Load()
			if n <= old || peak.CompareAndSwap(old, n) {
				break
			}
		}
		defer active.Add(-1)
		started <- struct{}{}
		<-release
		_ = json.NewEncoder(w).Encode(map[string]any{"data": []any{map[string]string{"b64_json": base64.StdEncoding.EncodeToString(picture)}}})
	}))
	defer server.Close()
	defer close(release)
	config := imageGenTestConfig(t, server.URL, true)
	created, err := runImageGen(context.Background(), config, rawJSON(map[string]any{"action": "create", "prompt": "image", "count": 10}))
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan imageGenResult, 1)
	go func() {
		r, _ := runImageGen(context.Background(), config, rawJSON(map[string]any{"action": "run", "batch_id": created.BatchID, "concurrency": 2, "max_items": 2}))
		done <- r
	}()
	for i := 0; i < 2; i++ {
		select {
		case <-started:
		case <-time.After(5 * time.Second):
			t.Fatal("concurrent requests did not start")
		}
	}
	if _, err := runImageGen(context.Background(), config, rawJSON(map[string]any{"action": "run", "batch_id": created.BatchID})); err == nil {
		t.Fatal("duplicate producer acquired lock")
	}
	status, err := runImageGen(context.Background(), config, rawJSON(map[string]any{"action": "status", "batch_id": created.BatchID}))
	if err != nil || status.State != "running" {
		t.Fatal(status, err)
	}
	release <- struct{}{}
	release <- struct{}{}
	select {
	case result := <-done:
		if result.Completed != 2 || result.Unsubmitted != 8 || calls.Load() != 2 || peak.Load() != 2 {
			t.Fatal(result, calls.Load(), peak.Load())
		}
	case <-time.After(5 * time.Second):
		t.Fatal("batch did not settle")
	}
}

func TestImageInterruptedBatchNeverReplaysAndPreservesDamagedRecord(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1); w.WriteHeader(400) }))
	defer server.Close()
	config := imageGenTestConfig(t, server.URL, true)
	created, err := runImageGen(context.Background(), config, rawJSON(map[string]any{"action": "create", "prompt": "image"}))
	if err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(DataDir(config), "image-batches", created.BatchID+".json")
	b, err := loadImageBatch(file)
	if err != nil {
		t.Fatal(err)
	}
	b.Items[0].State = "in_flight"
	_ = saveImageBatch(file, b)
	status, err := runImageGen(context.Background(), config, rawJSON(map[string]any{"action": "status", "batch_id": created.BatchID}))
	if err != nil || status.State != "unknown" || calls.Load() != 0 {
		t.Fatal("stopped producer still reported running or was replayed", status, err)
	}
	r, _ := runImageGen(context.Background(), config, rawJSON(map[string]any{"action": "run", "batch_id": created.BatchID}))
	if !r.Unknown || calls.Load() != 0 {
		t.Fatal(r, calls.Load())
	}
	_ = os.WriteFile(file, []byte("{damaged"), 0600)
	if _, err = runImageGen(context.Background(), config, rawJSON(map[string]any{"action": "run", "batch_id": created.BatchID})); err == nil {
		t.Fatal("damaged batch accepted")
	}
	data, _ := os.ReadFile(file)
	if string(data) != "{damaged" || calls.Load() != 0 {
		t.Fatal("damaged record overwritten or charged")
	}
}

func TestImagePaidOutputCanRecoverLocallyWithoutChargingAgain(t *testing.T) {
	var config string
	var calls atomic.Int32
	picture := imageGenTestPNG(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		_ = os.WriteFile(filepath.Join(DataDir(config), "generated-images", "index.json"), []byte("{damaged"), 0600)
		_ = json.NewEncoder(w).Encode(map[string]any{"usage": map[string]int{"input_tokens": 12, "output_tokens": 34}, "data": []any{map[string]string{"b64_json": base64.StdEncoding.EncodeToString(picture)}}})
	}))
	defer server.Close()
	config = imageGenTestConfig(t, server.URL, true)
	first, err := runImageGen(context.Background(), config, rawJSON(map[string]any{"prompt": "retain paid original"}))
	if err == nil || len(first.Items) != 1 || first.Items[0].State != "persistence_failed" || calls.Load() != 1 {
		t.Fatal(first, err)
	}
	receipt := filepath.Join(DataDir(config), "image-batches", first.BatchID, first.Items[0].RequestID+".response.json")
	if _, err = os.Stat(receipt); err != nil {
		t.Fatal("paid response lost", err)
	}
	if err = os.Remove(filepath.Join(DataDir(config), "generated-images", "index.json")); err != nil {
		t.Fatal(err)
	}
	recovered, err := runImageGen(context.Background(), config, rawJSON(map[string]any{"action": "recover", "batch_id": first.BatchID}))
	if err != nil || recovered.Completed != 1 || recovered.State != "completed" || calls.Load() != 1 {
		t.Fatal(recovered, err, calls.Load())
	}
	got, err := os.ReadFile(recovered.Paths[0])
	if err != nil || !bytes.Equal(got, picture) {
		t.Fatal("original changed", err)
	}
	if _, err = os.Stat(receipt); !os.IsNotExist(err) {
		t.Fatal("redundant successful base64 retained")
	}
	listed, err := runImageGen(context.Background(), config, rawJSON(map[string]any{"action": "list"}))
	if err != nil || len(listed.Batches) != 1 || listed.Batches[0].Completed != 1 {
		t.Fatal(listed, err)
	}
}

// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestImagePaidURLBatchRecoversWithoutAnotherCharge; retainedImageFixture; TestImageRecoveryAccountsRetainedReceiptBeforeDeletingEvidence; TestImageURLRecoveryHonorsRouteAndEnabledBoundaries; TestImageRecoveryUpdatesOnlyTheOriginalTaskLedger; TestImageLegacyReceiptRecoveryKeepsCreationDigestAndExplicitZeroUsage
// Impact: python -B scripts/code-atlas.py show Core/image_recovery_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestImagePaidURLBatchRecoversWithoutAnotherCharge(t *testing.T) {
	picture := imageGenTestPNG(t)
	posts, downloads := 0, 0
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			posts++
			fmt.Fprintf(w, `{"usage":{"input_tokens":12,"output_tokens":34},"data":[{"url":%q}]}`, server.URL+"/paid-image")
			return
		}
		downloads++
		if downloads == 1 {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		if r.Header.Get("Authorization") != "" {
			t.Error("credentials leaked into image download")
		}
		_, _ = w.Write(picture)
	}))
	defer server.Close()
	config := imageGenTestConfig(t, server.URL, true)
	first, err := runImageGen(context.Background(), config, rawJSON(map[string]any{"prompt": "paid URL fixture"}))
	if err == nil || first.State != "unknown" || posts != 1 || downloads != 1 {
		t.Fatal(first, err, posts, downloads)
	}
	recovered, err := runImageGen(context.Background(), config, rawJSON(map[string]any{"action": "recover", "batch_id": first.BatchID}))
	if err != nil || recovered.State != "completed" || recovered.Completed != 1 || posts != 1 || downloads != 2 || len(recovered.Usage) != 1 || !recovered.Usage[0].Reported || recovered.Usage[0].Input != 12 || recovered.Usage[0].Output != 34 || recovered.Usage[0].SourceID != first.Usage[0].SourceID {
		t.Fatal(recovered, err, posts, downloads)
	}
	got, err := os.ReadFile(recovered.Paths[0])
	if err != nil || !bytes.Equal(got, picture) {
		t.Fatal("recovery changed the paid original", err)
	}
	_, err = runImageGen(context.Background(), config, rawJSON(map[string]any{"action": "recover", "batch_id": first.BatchID}))
	if err != nil || posts != 1 || downloads != 2 {
		t.Fatal("completed recovery was repeated", err, posts, downloads)
	}
}

func retainedImageFixture(t *testing.T, config string, data []byte) (*imageBatch, string) {
	t.Helper()
	created, err := runImageGen(context.Background(), config, rawJSON(map[string]any{"action": "create", "prompt": "retained response fixture"}))
	if err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(PrivatePaths(config).ImageBatches, created.BatchID+".json")
	b, err := loadImageBatch(file)
	if err != nil {
		t.Fatal(err)
	}
	item := &b.Items[0]
	item.State = "unknown"
	item.Usage = &AgentUsage{Kind: "image_gen", Request: 1, SourceID: "batch:" + b.ID + ":" + item.RequestID + ":image:1"}
	if err = saveImageBatch(file, b); err != nil {
		t.Fatal(err)
	}
	receipt := filepath.Join(PrivatePaths(config).ImageBatches, b.ID, item.RequestID+".response.json")
	if err = os.MkdirAll(filepath.Dir(receipt), 0700); err != nil {
		t.Fatal(err)
	}
	if err = os.MkdirAll(PrivatePaths(config).GeneratedImages, 0700); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(receipt, data, 0600); err != nil {
		t.Fatal(err)
	}
	return b, receipt
}

func TestImageRecoveryAccountsRetainedReceiptBeforeDeletingEvidence(t *testing.T) {
	picture := imageGenTestPNG(t)
	config := imageGenTestConfig(t, "https://provider.invalid/v1", true)
	b, receipt := retainedImageFixture(t, config, rawJSON(map[string]any{"usage": map[string]int{"input_tokens": 12, "output_tokens": 34}, "data": []any{map[string]string{"b64_json": base64.StdEncoding.EncodeToString(picture)}}}))
	ledger := map[string]AgentUsage{b.Items[0].Usage.SourceID: *b.Items[0].Usage}
	fail := true
	ctx := context.WithValue(context.Background(), imageUsageWriterKey{}, func(u AgentUsage) error {
		if fail {
			return fmt.Errorf("fixture disk full")
		}
		ledger[u.SourceID] = u
		return nil
	})
	args := rawJSON(map[string]any{"action": "recover", "batch_id": b.ID})
	first, err := runImageGen(ctx, config, args)
	if err != nil || first.State != "accounting_failed" || first.Completed != 1 || first.AccountingError == "" || !first.Usage[0].Reported || first.Usage[0].Input != 12 || first.Usage[0].Output != 34 {
		t.Fatal("paid receipt usage or accounting failure disappeared", first, err)
	}
	if _, err = os.Stat(receipt); err != nil {
		t.Fatal("accounting failure discarded its evidence", err)
	}
	// With no original writer, an old accounting failure must remain visible.
	still, err := runImageGen(context.Background(), config, args)
	if err != nil || still.State != "accounting_failed" || still.AccountingError == "" {
		t.Fatal("missing ledger was reported as repaired", still, err)
	}
	fail = false
	last, err := runImageGen(ctx, config, args)
	if err != nil || last.State != "completed" || last.AccountingError != "" || last.Paths[0] != first.Paths[0] || len(ledger) != 1 || !ledger[b.Items[0].Usage.SourceID].Reported {
		t.Fatal("accounting retry duplicated/lost the original sample", last, ledger, err)
	}
	index, err := readGeneratedIndex(PrivatePaths(config).GeneratedImages)
	if err != nil || len(index.Images) != 1 {
		t.Fatal("accounting recovery re-added an image", index, err)
	}
	if _, err = os.Stat(receipt); !os.IsNotExist(err) {
		t.Fatal("committed receipt retained as unresolved", err)
	}
}

func TestImageURLRecoveryHonorsRouteAndEnabledBoundaries(t *testing.T) {
	for _, mode := range []string{"profile-disabled", "connection-disabled", "route-changed", "model-changed", "cancelled", "corrupt-receipt"} {
		t.Run(mode, func(t *testing.T) {
			requests := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { requests++; t.Error("blocked recovery performed HTTP") }))
			defer server.Close()
			config := imageGenTestConfig(t, server.URL, true)
			raw := rawJSON(map[string]any{"usage": map[string]int{"input_tokens": 0, "output_tokens": 0}, "data": []any{map[string]string{"url": server.URL + "/image"}}})
			if mode == "corrupt-receipt" {
				raw = []byte("{broken")
			}
			b, receipt := retainedImageFixture(t, config, raw)
			if mode != "cancelled" && mode != "corrupt-receipt" {
				data, err := os.ReadFile(config)
				if err != nil {
					t.Fatal(err)
				}
				var settings map[string]any
				if err = json.Unmarshal(data, &settings); err != nil {
					t.Fatal(err)
				}
				profile := settings["api_profiles"].([]any)[0].(map[string]any)
				connection := settings["provider_connections"].([]any)[0].(map[string]any)
				switch mode {
				case "profile-disabled":
					profile["enabled"] = false
				case "connection-disabled":
					connection["enabled"] = false
				case "route-changed":
					profile["base_url"], connection["base_url"] = server.URL+"/different", server.URL+"/different"
				case "model-changed":
					profile["model"] = "different-image-model"
				}
				if err = os.WriteFile(config, rawJSON(settings), 0600); err != nil {
					t.Fatal(err)
				}
			}
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			if mode == "cancelled" {
				cancel()
			}
			r, err := runImageGen(ctx, config, rawJSON(map[string]any{"action": "recover", "batch_id": b.ID}))
			if requests != 0 || r.Completed != 0 || err == nil && r.State == "completed" {
				t.Fatal("blocked recovery reported completion or made HTTP", r, err, requests)
			}
			got, err := os.ReadFile(receipt)
			if err != nil || !bytes.Equal(got, raw) {
				t.Fatal("unresolved evidence was changed", err)
			}
		})
	}
}

func TestImageRecoveryUpdatesOnlyTheOriginalTaskLedger(t *testing.T) {
	m := &AgentManager{dir: t.TempDir(), workspace: &Workspace{host: &WorkspaceHost{mode: HostOS}}, jobs: map[string]*agentJob{}}
	oldID, currentID := workspaceID(), workspaceID()
	unknown := AgentUsage{Kind: "image_gen", SourceID: "batch:paid:original:image:1", Request: 1}
	for _, id := range []string{oldID, currentID} {
		m.jobs[id] = &agentJob{record: AgentRecord{ID: id, Parent: testMatrixOwner, Depth: 1, Generation: 4, State: "completed", Spec: AgentSpec{WorkspaceRole: WorkspaceMatrix}}}
	}
	m.jobs[oldID].record.Usage = []AgentUsage{unknown}
	known := unknown
	known.Reported, known.Input, known.Output = true, 12, 34
	for n := 0; n < 2; n++ {
		if err := m.recoverImageUsage("agent:"+oldID, known); err != nil {
			t.Fatal(err)
		}
	}
	if len(m.jobs[oldID].record.Usage) != 1 || !m.jobs[oldID].record.Usage[0].Reported || len(m.jobs[currentID].record.Usage) != 0 {
		t.Fatal("old charge was appended to a later task")
	}
	if err := m.recoverImageUsage("agent:"+currentID, known); err == nil {
		t.Fatal("wrong task accepted someone else's usage")
	}
	if err := m.recoverImageUsage("", known); err != nil {
		t.Fatal("legacy receipt could not find its unique original sample", err)
	}
	m.jobs[currentID].record.Usage = []AgentUsage{unknown}
	if err := m.recoverImageUsage("", known); err == nil {
		t.Fatal("ambiguous legacy ledger silently chose a task")
	}
	m.dir = filepath.Join(t.TempDir(), "not-a-directory")
	if err := os.WriteFile(m.dir, []byte("retained fixture"), 0600); err != nil {
		t.Fatal(err)
	}
	known.Input = 99
	if err := m.recoverImageUsage("agent:"+oldID, known); err == nil || m.jobs[oldID].record.Usage[0].Input != 12 {
		t.Fatal("failed ledger commit left an uncommitted usage update", err)
	}
}

func TestImageLegacyReceiptRecoveryKeepsCreationDigestAndExplicitZeroUsage(t *testing.T) {
	config := imageGenTestConfig(t, "https://provider.invalid/v1", true)
	b, _ := retainedImageFixture(t, config, rawJSON(map[string]any{"usage": map[string]int{"input_tokens": 0, "output_tokens": 0}, "data": []any{map[string]string{"b64_json": base64.StdEncoding.EncodeToString(imageGenTestPNG(t))}}}))
	file := filepath.Join(PrivatePaths(config).ImageBatches, b.ID+".json")
	b.Routes, b.AccountingOwners = nil, nil // Original schema 1 before origin/owner snapshots.
	if err := saveImageBatch(file, b); err != nil {
		t.Fatal(err)
	}
	replay, err := runImageGen(context.Background(), config, rawJSON(map[string]any{"action": "create", "request_id": b.ID, "prompt": "retained response fixture"}))
	if err != nil || replay.BatchID != b.ID || replay.State != "unknown" {
		t.Fatal("origin snapshots changed the old creation digest", replay, err)
	}
	r, err := runImageGen(context.Background(), config, rawJSON(map[string]any{"action": "recover", "batch_id": b.ID}))
	if err != nil || r.State != "completed" || len(r.Usage) != 1 || !r.Usage[0].Reported || r.Usage[0].Input != 0 || r.Usage[0].Output != 0 {
		t.Fatal("legacy receipt or explicitly reported zero was lost", r, err)
	}
}

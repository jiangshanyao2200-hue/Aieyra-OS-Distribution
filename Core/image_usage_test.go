// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestImageUsagePresenceAndChatCacheIsolation; TestImageBatchCountsUsageAndFailureRecovery; TestImageUsagePersistenceFailureDoesNotResubmit; TestImageUsagePersistsOnceInUnifiedSchedulerMetadata
// Impact: python -B scripts/code-atlas.py show Core/image_usage_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
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

func TestImageUsagePresenceAndChatCacheIsolation(t *testing.T) {
	for _, raw := range []string{"null", `{}`, `{"input_tokens":1}`, `{"output_tokens":2}`, `{"input_tokens":-1,"output_tokens":2}`, `{"input_tokens":1.5,"output_tokens":2}`} {
		if parseImageUsage([]byte(raw)) != nil {
			t.Fatal("invented usage", raw)
		}
	}
	for _, raw := range []string{`{"input_tokens":0,"output_tokens":0}`, `{"prompt_tokens":0,"completion_tokens":0}`} {
		u := parseImageUsage([]byte(raw))
		if u == nil || !u.Reported || u.Input != 0 || u.Output != 0 {
			t.Fatal(raw, u)
		}
	}
	hit := 60
	got := workspaceUsage([]AgentUsage{{Kind: "model", Reported: true, Input: 100, Output: 20, Cached: &hit}, {Kind: "image_gen", Reported: true, Input: 39, Output: 515}, {Kind: "image_gen"}})
	if got["input_tokens"] != 139 || got["output_tokens"] != 535 || got["image_samples"] != 2 || got["image_unknown"] != 1 || got["cache_input_tokens"] != 100 || got["cached_known"] != true || got["complete"] != false {
		t.Fatal(got)
	}
}

func TestImageBatchCountsUsageAndFailureRecovery(t *testing.T) {
	picture := imageGenTestPNG(t)
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if calls == 2 {
			w.WriteHeader(500)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"usage": map[string]int{"input_tokens": 39, "output_tokens": 515}, "data": []any{map[string]string{"b64_json": base64.StdEncoding.EncodeToString(picture)}}})
	}))
	defer server.Close()
	var updates []AgentUsage
	ctx := context.WithValue(context.Background(), toolInvocationKey{}, "inv:call")
	ctx = context.WithValue(ctx, imageUsageWriterKey{}, func(u AgentUsage) error { updates = append(updates, u); return nil })
	result, err := runImageGen(ctx, imageGenTestConfig(t, server.URL, true), rawJSON(map[string]any{"prompt": "pelican", "count": 4}))
	if err != nil || result.State != "unknown" || result.Requested != 4 || result.Submitted != 2 || result.Completed != 1 || result.Unsubmitted != 2 || len(result.Usage) != 2 || len(updates) != 3 || result.Recovery == "" {
		t.Fatal(result, err, updates)
	}
	if updates[0].Reported || !updates[1].Reported || updates[0].SourceID != updates[1].SourceID || updates[2].SourceID == updates[1].SourceID || updates[2].Reported {
		t.Fatal("request identity or unknown usage lost", updates)
	}
	if result.Usage[0].Input != 39 || result.Usage[0].Output != 515 {
		t.Fatal(result.Usage)
	}
}

func TestImageUsagePersistenceFailureDoesNotResubmit(t *testing.T) {
	for _, failAt := range []int{1, 2} {
		t.Run(fmt.Sprint(failAt), func(t *testing.T) {
			calls, writes := 0, 0
			picture := imageGenTestPNG(t)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				_ = json.NewEncoder(w).Encode(map[string]any{"usage": map[string]int{"input_tokens": 39, "output_tokens": 515}, "data": []any{map[string]string{"b64_json": base64.StdEncoding.EncodeToString(picture)}}})
			}))
			defer server.Close()
			ctx := context.WithValue(context.Background(), imageUsageWriterKey{}, func(u AgentUsage) error {
				writes++
				if writes == failAt {
					return fmt.Errorf("disk full")
				}
				return nil
			})
			result, err := runImageGen(ctx, imageGenTestConfig(t, server.URL, true), rawJSON(map[string]any{"prompt": "one batch", "count": 4}))
			if failAt == 1 {
				if calls != 0 || err == nil || result.Submitted != 0 {
					t.Fatal(result, err, calls)
				}
			} else {
				if calls != 1 || err != nil || result.Completed != 1 || result.AccountingError == "" || result.State != "accounting_failed" || !result.Usage[0].Reported {
					t.Fatal(result, err, calls)
				}
			}
		})
	}
}

func TestImageUsagePersistsOnceInUnifiedSchedulerMetadata(t *testing.T) {
	dir := t.TempDir()
	m := &AgentManager{dir: dir, workspace: &Workspace{host: &WorkspaceHost{mode: HostOS}}}
	id := workspaceID()
	job := &agentJob{record: AgentRecord{ID: id, Parent: testMatrixOwner, Depth: 1, Generation: 3, State: "running", Spec: AgentSpec{WorkspaceRole: WorkspaceMatrix}, Usage: []AgentUsage{{Kind: "model", Reported: true, Input: 100}}}}
	unknown := AgentUsage{Kind: "image_gen", SourceID: "inv:call:image:1", Request: 1}
	if err := m.recordImageUsage(job, 3, unknown); err != nil {
		t.Fatal(err)
	}
	known := unknown
	known.Reported = true
	known.Input = 39
	known.Output = 515
	for i := 0; i < 2; i++ {
		if err := m.recordImageUsage(job, 3, known); err != nil {
			t.Fatal(err)
		}
	}
	data, err := os.ReadFile(filepath.Join(dir, id+".json"))
	if err != nil {
		t.Fatal(err)
	}
	var saved AgentRecord
	_ = json.Unmarshal(data, &saved)
	if len(saved.Usage) != 1 || saved.Usage[0].Input != 39 || len(job.record.Usage) != 2 || job.record.Requests != 0 || job.record.AccountedTokens != 0 {
		t.Fatal(saved, job.record)
	}
	if err := m.recordImageUsage(job, 4, unknown); err == nil {
		t.Fatal("stale task accounted")
	}
}

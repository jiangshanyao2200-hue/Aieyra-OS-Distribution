// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestMatrixAgentConcurrencyCancellationAndCompactList; TestMatrixSavedParentCycleRejected; TestMatrixCredentialPatchNeverArchived; TestMatrixCustomManifestIntegrity
// Impact: python -B scripts/code-atlas.py show Core/matrix_faults_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"fmt"
	toolcontract "github.com/aieyra/aieyra-os/tool/contract"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestMatrixAgentConcurrencyCancellationAndCompactList(t *testing.T) {
	var running, peak atomic.Int32
	gate := make(chan struct{})
	var release sync.Once
	defer release.Do(func() { close(gate) })
	m, dir := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
		n := running.Add(1)
		defer running.Add(-1)
		for old := peak.Load(); n > old; old = peak.Load() {
			if peak.CompareAndSwap(old, n) {
				break
			}
		}
		select {
		case <-gate:
			fixtureAnswer(w, "bounded", "DONE", nil)
		case <-r.Context().Done():
		}
	})
	var ids []string
	for i := 0; i < 8; i++ {
		request := "one"
		if i >= 4 {
			request = "two"
		}
		r, err := m.Create(WithAgentRequest(context.Background(), request), testMatrixOwner, AgentSpec{RequestID: fmt.Sprint(i), ModelID: "local-model", Task: "deliver", Prompt: "PRIVATE_SPECIALIST_PROMPT", Workdir: dir})
		if err != nil {
			t.Fatal(err)
		}
		ids = append(ids, r.ID)
	}
	deadline := time.Now().Add(3 * time.Second)
	for peak.Load() < 4 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if peak.Load() != 4 {
		t.Fatal("expected four network slots", peak.Load())
	}
	list, err := m.Call(context.Background(), testMatrixOwner, json.RawMessage(`{"action":"list"}`))
	b, _ := json.Marshal(list)
	if err != nil || strings.Contains(string(b), "PRIVATE_SPECIALIST_PROMPT") || strings.Contains(string(b), "\"turns\"") {
		t.Fatal("list expanded private context", err)
	}
	m.CancelRequest("one")
	release.Do(func() { close(gate) })
	for i, id := range ids {
		r, e := m.Wait(context.Background(), testMatrixOwner, id, 10000)
		if e != nil {
			t.Fatal(e)
		}
		if i < 4 && r.State != "cancelled" || i >= 4 && r.State != "completed" {
			t.Fatal(i, r.State, r.Error)
		}
	}
	if peak.Load() > 4 {
		t.Fatal("network concurrency exceeded", peak.Load())
	}
}

func TestMatrixSavedParentCycleRejected(t *testing.T) {
	m, _ := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) { t.Error("unexpected request") })
	m.Close()
	ids := []string{"11111111111111111111111111111111", "22222222222222222222222222222222"}
	for i, id := range ids {
		if err := WriteMatrixJSON(filepath.Join(m.dir, id+".json"), AgentRecord{ID: id, Parent: ids[1-i], Depth: 2, State: "completed"}); err != nil {
			t.Fatal(err)
		}
	}
	if next, err := NewAgentManager(m.config, testMatrixOwner, nil); err == nil {
		next.Close()
		t.Fatal("cyclic ancestry accepted")
	}
}

func TestMatrixCredentialPatchNeverArchived(t *testing.T) {
	call := ToolCall{ID: "credential", Function: FunctionCall{Name: "toolbox", Arguments: `{"action":"call","name":"settings","arguments":{"action":"connection_update","patch":{"api_key":"fake-nested-private-key"}}}`}}
	clean := archiveToolCall(call)
	if strings.Contains(clean.Function.Arguments, "fake-nested-private-key") || !strings.Contains(clean.Function.Arguments, "credential-sha256") {
		t.Fatal("nested credential leaked")
	}
	if archiveToolCall(clean).Function.Arguments != clean.Function.Arguments {
		t.Fatal("redaction broke stable receipt identity")
	}
}

func TestMatrixCustomManifestIntegrity(t *testing.T) {
	m, _ := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) { t.Error("unexpected request") })
	v := CustomTool{Name: "invalid", Description: "bad", Code: "return args", Schema: map[string]any{"type": "object"}}
	v.ID, _ = toolcontract.CustomDigest(v)
	p, _ := m.toolPath(v.ID)
	if err := os.MkdirAll(filepath.Dir(p), 0700); err != nil {
		t.Fatal(err)
	}
	if err := WriteMatrixJSON(p, v); err != nil {
		t.Fatal(err)
	}
	if _, err := m.customTool(v.ID); err == nil {
		t.Fatal("invalid stored schema accepted")
	}
}

// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestMatrixControlAuthenticationAndRedaction; TestMatrixToolFactoryVersionedInputAndNestedPermissions; mustProjectRoot; TestMatrixEventsPagingRedactionAndPartialTail
// Impact: python -B scripts/code-atlas.py show Core/matrix_control_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestMatrixControlAuthenticationAndRedaction(t *testing.T) {
	m, _ := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) { t.Error("unexpected model request") })
	c, err := NewMatrixControl(m)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	for _, row := range []struct {
		token, origin, body string
		status              int
	}{
		{"", "", `{"action":"describe"}`, 403},
		{c.token, "https://untrusted.example", `{"action":"describe"}`, 403},
		{c.token, "", `{"action":"describe"}`, 200},
		{c.token, "", `{"action":"config:bootstrap"}`, 400},
		{c.token, "", `{"action":"settings","arguments":{"action":"config:bootstrap"}}`, 400},
		{c.token, "", `{"action":"describe"} {}`, 400},
	} {
		req, _ := http.NewRequest("POST", c.address+"/v1/rpc", strings.NewReader(row.body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+row.token)
		if row.origin != "" {
			req.Header.Set("Origin", row.origin)
		}
		response, e := http.DefaultClient.Do(req)
		if e != nil {
			t.Fatal(e)
		}
		b, _ := io.ReadAll(response.Body)
		response.Body.Close()
		if response.StatusCode != row.status {
			t.Fatalf("%s: %d %s", row.body, response.StatusCode, b)
		}
		if strings.Contains(string(b), "fake-key-only") || strings.Contains(string(b), c.token) {
			t.Fatal("credential leaked")
		}
	}
	c.Close()
	if _, err = os.Stat(c.file); !os.IsNotExist(err) {
		t.Fatal("discovery file survived close")
	}
}

func TestMatrixToolFactoryVersionedInputAndNestedPermissions(t *testing.T) {
	m, dir := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) { t.Error("unexpected model request") })
	t.Setenv("AIEYRA_ROOT", mustProjectRoot(t))
	shell, err := NewShellManager(dir, dir+"/tool-shell")
	if err != nil {
		t.Fatal(err)
	}
	defer shell.Close()
	ctx := WithAgentManager(context.Background(), m, testMatrixOwner, shell)
	manifest := map[string]any{"action": "register", "name": "sum", "description": "Sum independent data", "code": "text(args.values.reduce((n,v)=>n+v,0)); text(typeof tools.exec_command);", "capabilities": []string{}, "schema": map[string]any{"type": "object", "additionalProperties": false, "properties": map[string]any{"values": map[string]any{"type": "array", "items": map[string]any{"type": "number"}}}, "required": []string{"values"}}}
	data, _ := json.Marshal(manifest)
	result, err := m.toolFactory(ctx, data)
	if err != nil {
		t.Fatal(err)
	}
	id := result.(map[string]any)["id"].(string)
	state := &ToolboxState{}
	if r := state.Execute(ctx, "", toolboxCall("open", "open", id)); !r.OK {
		t.Fatal(r.Error)
	}
	if !strings.Contains(state.Details(), "values") || strings.Contains(state.Details(), "reduce") {
		t.Fatal("manual loads implementation or omits schema")
	}
	call := toolboxCall("run", "call", id)
	call.Function.Arguments = `{"action":"call","name":"` + id + `","arguments":{"values":[2,3,7]}}`
	r := state.Execute(ctx, "", call)
	if !r.OK {
		t.Fatal(r.Error)
	}
	var execution ExecResult
	if json.Unmarshal(r.Data, &execution) != nil {
		t.Fatal("invalid execution receipt")
	}
	outputs := append([]ExecOutput(nil), execution.Output...)
	for pages := 0; execution.OK && (execution.State == "running" || execution.HasMore) && pages < 8; pages++ {
		delay := 10000
		execution, _ = shell.execution.execute(ctx, executionCall("wait", WaitRequest{CellID: execution.CellID, YieldTimeMS: &delay}), "wait-tool")
		outputs = append(outputs, execution.Output...)
	}
	execution.Output = outputs
	if !execution.OK || execution.State != "completed" || execution.HasMore || !strings.Contains(selectedText(execution), "12") || !strings.Contains(selectedText(execution), "undefined") {
		t.Fatal(execution)
	}
	call.Function.Arguments = `{"action":"call","name":"` + id + `","arguments":{"values":["bad"]}}`
	if state.Execute(ctx, "", call).OK {
		t.Fatal("schema violation executed")
	}
	bad := WithToolPermissions(ctx, []string{"exec"})
	if state.Execute(bad, "", toolboxCall("denied", "open", id)).OK {
		t.Fatal("unassigned version opened")
	}
	manifest["code"] = "return 13"
	data, _ = json.Marshal(manifest)
	second, err := m.toolFactory(ctx, data)
	if err != nil || second.(map[string]any)["id"] == id {
		t.Fatal("mutated implementation reused version", err)
	}
	secondID := second.(map[string]any)["id"].(string)
	state.Execute(ctx, "", toolboxCall("open-return", "open", secondID))
	call.ID = "run-return"
	call.Function.Arguments = `{"action":"call","name":"` + secondID + `","arguments":{"values":[]}}`
	r = state.Execute(ctx, "", call)
	if json.Unmarshal(r.Data, &execution) != nil {
		t.Fatal("missing returned receipt")
	}
	outputs = append([]ExecOutput(nil), execution.Output...)
	for pages := 0; execution.OK && (execution.State == "running" || execution.HasMore) && pages < 8; pages++ {
		delay := 10000
		execution, _ = shell.execution.execute(ctx, executionCall("wait", WaitRequest{CellID: execution.CellID, YieldTimeMS: &delay}), "wait-return")
		outputs = append(outputs, execution.Output...)
	}
	execution.Output = outputs
	if !execution.OK || execution.State != "completed" || execution.HasMore || !strings.Contains(selectedText(execution), "13") {
		t.Fatal("return value lost", execution)
	}
}

func mustProjectRoot(t *testing.T) string {
	t.Helper()
	cwd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	return filepath.Dir(cwd)
}

func TestMatrixEventsPagingRedactionAndPartialTail(t *testing.T) {
	m, dir := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) { t.Error("unexpected request") })
	p := filepath.Join(dir, "events.jsonl")
	first := `{"kind":"message","value":"fake-key-only"}` + "\n"
	second := `{"kind":"tool_progress","value":{"ok":true}}` + "\n"
	if err := os.WriteFile(p, []byte(first+second+`{"kind":`), 0600); err != nil {
		t.Fatal(err)
	}
	v, err := m.events(p, 0, 1)
	if err != nil {
		t.Fatal(err)
	}
	page := v.(map[string]any)
	b, _ := json.Marshal(page)
	if strings.Contains(string(b), "fake-key-only") || page["next_cursor"].(int64) != int64(len(first)) {
		t.Fatal(string(b))
	}
	v, err = m.events(p, page["next_cursor"].(int64), 10)
	if err != nil {
		t.Fatal(err)
	}
	page = v.(map[string]any)
	if len(page["events"].([]json.RawMessage)) != 1 || !page["has_more"].(bool) {
		t.Fatal(page)
	}
	v, err = m.events(p, page["next_cursor"].(int64), 10)
	if err != nil || len(v.(map[string]any)["events"].([]json.RawMessage)) != 0 {
		t.Fatal(v, err)
	}
	if _, err = m.events(p, 3, 1); err == nil {
		t.Fatal("non-boundary cursor accepted")
	}
}

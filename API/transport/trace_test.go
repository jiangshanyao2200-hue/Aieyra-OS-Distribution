// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: API/transport/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestProviderTraceKeepsBodiesButNotHeaders
// Impact: python -B scripts/code-atlas.py show API/transport/trace_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package transport

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestProviderTraceKeepsBodiesButNotHeaders(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("AIEYRA_PROVIDER_TRACE", dir)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, `data: {"ok":true}

`)
	}))
	defer server.Close()
	client := &http.Client{Transport: Trace(http.DefaultTransport)}
	req, _ := http.NewRequest(http.MethodPost, server.URL, strings.NewReader(`{"model":"m"}`))
	req.Header.Set("Authorization", "Bearer secret-key-123456")
	resp, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if body, _ := io.ReadAll(resp.Body); !strings.Contains(string(body), "ok") {
		t.Fatalf("body = %q", body)
	}
	resp.Body.Close()
	files, _ := filepath.Glob(filepath.Join(dir, "*"))
	var all string
	for _, f := range files {
		data, _ := os.ReadFile(f)
		all += filepath.Base(f) + "=" + string(data) + ";"
	}
	if len(files) != 2 || !strings.Contains(all, `{"model":"m"}`) || !strings.Contains(all, `"ok":true`) || strings.Contains(all, "secret-key") {
		t.Fatalf("trace files: %s", all)
	}
}

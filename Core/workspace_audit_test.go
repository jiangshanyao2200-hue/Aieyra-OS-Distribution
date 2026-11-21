// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestWorkspaceDocumentRestoredMetadataAndSizeBoundary; TestMatrixRPCStrictHeaderAndBodyBoundary
// Impact: python -B scripts/code-atlas.py show Core/workspace_audit_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestWorkspaceDocumentRestoredMetadataAndSizeBoundary(t *testing.T) {
	w, _ := testWorkspace(t, func(http.ResponseWriter, *http.Request) { t.Error("unexpected model request") })
	outside := filepath.Join(w.dir, "outside.md")
	if err := os.WriteFile(outside, []byte("private fixture"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(w.dir, "documents"), 0700); err != nil {
		t.Fatal(err)
	}
	w.state.Documents = []WorkspaceDocument{{ID: "../outside", Format: "md"}}
	if _, err := w.readDocument("../outside"); err == nil {
		t.Error("restored traversal metadata exposed a file")
	}
	id := workspaceID()
	w.state.Documents = []WorkspaceDocument{{ID: id, Format: "md"}}
	if err := os.WriteFile(filepath.Join(w.dir, "documents", id+".md"), []byte(strings.Repeat("x", (512<<10)+1)), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := w.readDocument(id); err == nil {
		t.Error("oversized persisted document accepted")
	}
}

func TestMatrixRPCStrictHeaderAndBodyBoundary(t *testing.T) {
	w, _ := testWorkspace(t, func(http.ResponseWriter, *http.Request) { t.Error("unexpected model request") })
	c := &MatrixControl{manager: w.manager, address: "http://127.0.0.1:54321", token: strings.Repeat("a", 64)}
	cases := []struct {
		name, authorization, contentType, body, origin, host string
		status                                               int
	}{
		{"valid", "Bearer " + c.token, "application/json; charset=utf-8", `{"action":"describe"}`, "", "127.0.0.1:54321", 200},
		{"raw token", c.token, "application/json", `{"action":"describe"}`, "", "127.0.0.1:54321", 403},
		{"mime suffix", "Bearer " + c.token, "application/jsonjunk", `{"action":"describe"}`, "", "127.0.0.1:54321", 415},
		{"origin", "Bearer " + c.token, "application/json", `{"action":"describe"}`, "https://untrusted.invalid", "127.0.0.1:54321", 403},
		{"host", "Bearer " + c.token, "application/json", `{"action":"describe"}`, "", "evil.invalid", 403},
		{"trailing", "Bearer " + c.token, "application/json", `{"action":"describe"}{}`, "", "127.0.0.1:54321", 400},
		{"oversized", "Bearer " + c.token, "application/json", `{"action":"` + strings.Repeat("x", 1<<20) + `"}`, "", "127.0.0.1:54321", 400},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest("POST", c.address+"/v1/rpc", strings.NewReader(tc.body))
			req.Host = tc.host
			req.Header.Set("Authorization", tc.authorization)
			req.Header.Set("Content-Type", tc.contentType)
			req.Header.Set("Origin", tc.origin)
			rw := httptest.NewRecorder()
			c.serve(rw, req)
			if rw.Code != tc.status {
				t.Fatalf("status %d, expected %d", rw.Code, tc.status)
			}
		})
	}
}

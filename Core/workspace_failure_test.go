// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestFailureRecordOutlivesOSRuntimeDirectory; TestFailureRecordRetainsActualRequestTelemetry; TestFailureSummaryDistinguishesMissingFinishAndAutomaticLimit
// Impact: python -B scripts/code-atlas.py show Core/workspace_failure_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// The record named in the failure message must survive normal OS exit, which
// removes the per-session runtime directory.
func TestFailureRecordOutlivesOSRuntimeDirectory(t *testing.T) {
	w := baseReportWorkspace(t, HostOS, false)
	text := w.failureReport(AgentRecord{ID: "agent-failure", Generation: 3, State: "failed", Error: "检查点无效"})
	match := regexp.MustCompile(`核验记录：(.+)`).FindStringSubmatch(text)
	if match == nil {
		t.Fatal("failure message names no record", text)
	}
	path := strings.TrimSpace(match[1])
	if strings.HasPrefix(path, w.dir) {
		t.Fatal("record stored in removable runtime directory", path)
	}
	w.releaseOSRuntime()
	if _, err := os.Stat(w.dir); !os.IsNotExist(err) {
		t.Fatal("runtime directory not removed", err)
	}
	data, err := os.ReadFile(path)
	if err != nil || !strings.Contains(string(data), "agent-failure") {
		t.Fatal("failure record lost after exit", path, err)
	}
	if filepath.Dir(path) != filepath.Join(w.reportDirectory(), "failures") {
		t.Fatal("unexpected failure directory", path)
	}
}

func TestFailureRecordRetainsActualRequestTelemetry(t *testing.T) {
	w := baseReportWorkspace(t, HostOS, false)
	r := AgentRecord{ID: "length-failure", Generation: 2, State: "failed", Error: "output limit", TurnRequestBase: 2, Requests: 4, Spec: AgentSpec{ModelID: "fixture"}, Usage: []AgentUsage{{Request: 2, Model: "old"}, {Request: 3, Model: "fixture", OutputLimit: 4096, FinishReason: "length", Reported: true, Input: 100, Output: 4096}, {Request: 4, Model: "fixture", OutputLimit: 8192, FinishReason: "length", Reported: true, Input: 200, Output: 8192}}}
	text := w.failureReport(r)
	match := regexp.MustCompile(`核验记录：(.+)`).FindStringSubmatch(text)
	if match == nil {
		t.Fatal(text)
	}
	data, err := os.ReadFile(strings.TrimSpace(match[1]))
	if err != nil {
		t.Fatal(err)
	}
	var report struct {
		Usage []AgentUsage `json:"usage"`
		Model string       `json:"model_id"`
	}
	if err = json.Unmarshal(data, &report); err != nil {
		t.Fatal(err)
	}
	if report.Model != "fixture" || len(report.Usage) != 2 || report.Usage[1].OutputLimit != 8192 || report.Usage[1].FinishReason != "length" || report.Usage[1].Output != 8192 {
		t.Fatal(report)
	}
}

func TestFailureSummaryDistinguishesMissingFinishAndAutomaticLimit(t *testing.T) {
	w := baseReportWorkspace(t, HostOS, false)
	r := AgentRecord{ID: "unknown-finish", Generation: 1, State: "failed", Error: "request failed", Requests: 1, Usage: []AgentUsage{{Request: 1, Model: "fixture", OutputLimit: 0}}}
	text := w.failureReport(r)
	if !strings.Contains(text, "输出上限：自动") || !strings.Contains(text, "结束原因：未收到") || strings.Contains(text, "0 tokens") {
		t.Fatal(text)
	}
}

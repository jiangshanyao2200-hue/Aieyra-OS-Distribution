// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestMemoryLookupHonorsDisabledService; TestMemoryServicePreservesUnmigratedLegacyDatabase
// Impact: python -B scripts/code-atlas.py show Core/settings_memory_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestMemoryLookupHonorsDisabledService(t *testing.T) {
	config := filepath.Join(t.TempDir(), "config.json")
	if err := os.WriteFile(config, []byte(`{"memory_enabled":false}`), 0600); err != nil {
		t.Fatal(err)
	}
	s := NewSettingsService(config)
	t.Cleanup(s.Close)
	raw, err := s.CallTool(context.Background(), "memory", "lookup-test", rawJSON(memoryRow{"action": "lookup", "query": "anything"}))
	var r memoryRow
	if err != nil || json.Unmarshal(raw, &r) != nil || r["ok"] != false || !strings.Contains(memString(r["error"]), "关闭") || s.memory != nil {
		t.Fatal("disabled memory was opened", string(raw), err)
	}
}

func TestMemoryServicePreservesUnmigratedLegacyDatabase(t *testing.T) {
	for _, suffix := range []string{"", "-wal", "-shm", "-journal"} {
		t.Run(suffix, func(t *testing.T) {
			root := t.TempDir()
			config := filepath.Join(root, "Config", "config.json")
			legacy := filepath.Join(root, "Config", "memory", "eyra.sqlite") + suffix
			if err := os.MkdirAll(filepath.Dir(legacy), 0700); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(config, []byte(`{"memory_enabled":true}`), 0600); err != nil {
				t.Fatal(err)
			}
			bytes := []byte("untouched legacy database fixture")
			if err := os.WriteFile(legacy, bytes, 0600); err != nil {
				t.Fatal(err)
			}
			s := NewSettingsService(config)
			t.Cleanup(s.Close)
			_, err := s.CallTool(context.Background(), "memory", "legacy", rawJSON(memoryRow{"action": "status"}))
			if err == nil || !strings.Contains(err.Error(), "旧记忆") {
				t.Fatal("legacy path was silently bypassed", err)
			}
			got, err := os.ReadFile(legacy)
			if err != nil || string(got) != string(bytes) {
				t.Fatal("legacy changed", err)
			}
			if _, err := os.Stat(filepath.Join(root, "Data", "memory")); !os.IsNotExist(err) {
				t.Fatal("second memory store was created", err)
			}
		})
	}
}

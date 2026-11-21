// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/sessionservice/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: recordFixture; fixtureRecord; TestRecordReplacementPreservesOpenReaderAndRejectsInvalidWrites; TestRecordDirectoryRejectsDamagedSelectedFileWithoutPartialResults; TestRecordRejectsLinksDirectoriesOversizeAndEscapingName
// Impact: python -B scripts/code-atlas.py show Core/sessionservice/records_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package sessionservice

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/aieyra/aieyra-os/CORE/internal/privatefile"
)

type recordFixture struct {
	ID   string `json:"id"`
	Text string `json:"text"`
}

func fixtureRecord(id string) func(recordFixture) error {
	return func(r recordFixture) error {
		if r.ID != id {
			return fmt.Errorf("wrong session")
		}
		return nil
	}
}

func TestRecordReplacementPreservesOpenReaderAndRejectsInvalidWrites(t *testing.T) {
	s := RecordFile{Directory: t.TempDir(), Name: "record.json", MaxBytes: 128}
	first := recordFixture{ID: "one", Text: "原文 🪶"}
	if err := WriteRecord(s, first, fixtureRecord("one")); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(s.Directory, s.Name)
	before, _ := os.ReadFile(path)
	reader, err := privatefile.OpenSnapshot(path)
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	second := recordFixture{ID: "one", Text: "第二轮"}
	if err := WriteRecord(s, second, fixtureRecord("one")); err != nil {
		t.Fatal(err)
	}
	old := make([]byte, len(before))
	if n, err := reader.Read(old); err != nil || n != len(old) || !bytes.Equal(old, before) {
		t.Fatal("open reader lost its snapshot", err)
	}
	current, err := ReadRecord(s, fixtureRecord("one"))
	if err != nil || current != second {
		t.Fatal(current, err)
	}
	before, _ = os.ReadFile(path)
	for _, bad := range []recordFixture{{ID: "other"}, {ID: "one", Text: strings.Repeat("x", 200)}} {
		if err := WriteRecord(s, bad, fixtureRecord("one")); err == nil {
			t.Fatal("invalid record replaced snapshot")
		}
		got, _ := os.ReadFile(path)
		if !bytes.Equal(got, before) {
			t.Fatal("failed write changed snapshot")
		}
	}
}

func TestRecordDirectoryRejectsDamagedSelectedFileWithoutPartialResults(t *testing.T) {
	dir := t.TempDir()
	for name, content := range map[string]string{"a.json": `{"id":"a"}`, "z.json": `{"id":`, "unrelated.txt": "keep"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
	}
	rows, err := LoadRecordDirectory(dir, 128, func(name string) bool { return strings.HasSuffix(name, ".json") }, func(name string, r recordFixture) error { return fixtureRecord(strings.TrimSuffix(name, ".json"))(r) })
	if err == nil || rows != nil {
		t.Fatal("partial damaged directory returned", rows, err)
	}
	if b, _ := os.ReadFile(filepath.Join(dir, "z.json")); string(b) != `{"id":` {
		t.Fatal("damaged original changed")
	}
	if err := os.WriteFile(filepath.Join(dir, "z.json"), []byte(`{"id":"z"}`), 0600); err != nil {
		t.Fatal(err)
	}
	rows, err = LoadRecordDirectory(dir, 128, func(name string) bool { return strings.HasSuffix(name, ".json") }, func(name string, r recordFixture) error { return fixtureRecord(strings.TrimSuffix(name, ".json"))(r) })
	if err != nil || len(rows) != 2 || rows[0].ID != "a" || rows[1].ID != "z" {
		t.Fatal(rows, err)
	}
}

func TestRecordRejectsLinksDirectoriesOversizeAndEscapingName(t *testing.T) {
	dir := t.TempDir()
	outside := filepath.Join(t.TempDir(), "outside.json")
	if err := os.WriteFile(outside, []byte(`{"id":"private"}`), 0600); err != nil {
		t.Fatal(err)
	}
	t.Run("link", func(t *testing.T) {
		if err := os.Symlink(outside, filepath.Join(dir, "link.json")); err != nil {
			t.Skipf("symlink unavailable: %v", err)
		}
		s := RecordFile{Directory: dir, Name: "link.json", MaxBytes: 128}
		if _, err := s.Read(); err == nil {
			t.Fatal("link read")
		}
		if err := s.Write([]byte(`{}`)); err == nil {
			t.Fatal("link replaced")
		}
		if b, _ := os.ReadFile(outside); string(b) != `{"id":"private"}` {
			t.Fatal("outside changed")
		}
	})
	if err := os.Mkdir(filepath.Join(dir, "directory.json"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "large.json"), []byte(strings.Repeat("x", 129)), 0600); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"directory.json", "large.json", "../outside.json"} {
		s := RecordFile{Directory: dir, Name: name, MaxBytes: 128}
		if _, err := s.Read(); err == nil {
			t.Fatalf("accepted %s", name)
		}
		if err := s.Write([]byte(`{}`)); err == nil {
			t.Fatalf("replaced %s", name)
		}
	}
}

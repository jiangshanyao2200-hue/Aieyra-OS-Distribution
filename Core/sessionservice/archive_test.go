// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/sessionservice/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestReplayRepairsOnlyUnterminatedTailAndKeepsRejectedBytes; TestAppendRejectsInvalidRecordWithoutOpeningOrChangingArchive
// Impact: python -B scripts/code-atlas.py show Core/sessionservice/archive_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package sessionservice

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestReplayRepairsOnlyUnterminatedTailAndKeepsRejectedBytes(t *testing.T) {
	for _, tc := range []struct {
		name, input   string
		bad, truncate bool
	}{
		{"valid-no-newline", `{"kind":"meta","value":1}`, false, false},
		{"partial-tail", "{\"kind\":\"meta\",\"value\":1}\n{", false, true},
		{"corrupt-middle", "{\"kind\":\"meta\",\"value\":1}\nBAD\n", true, false},
		{"typed-rejection", `{"kind":"unknown","value":1}`, true, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			file := filepath.Join(t.TempDir(), "archive.jsonl")
			before := []byte(tc.input)
			if err := os.WriteFile(file, before, 0600); err != nil {
				t.Fatal(err)
			}
			out, err := Replay(file, func(r Record) error {
				if r.Kind != "meta" {
					return errors.New("unsupported typed record")
				}
				return nil
			})
			if (err != nil) != tc.bad || out.Truncated != tc.truncate {
				t.Fatal(out, err)
			}
			after, _ := os.ReadFile(file)
			if tc.bad && !bytes.Equal(before, after) {
				t.Fatal("rejected history changed")
			}
			if tc.truncate {
				tail, e := os.ReadFile(file + ".interrupted-tail")
				if e != nil || string(tail) != "{" {
					t.Fatal("partial tail not preserved", e)
				}
			}
			if !tc.bad {
				line, _ := Encode("meta", 2)
				if err := Append(file, line); err != nil {
					t.Fatal(err)
				}
				out, err = Replay(file, func(r Record) error { return nil })
				if err != nil || out.Records != 2 {
					t.Fatal("next append damaged framing", out, err)
				}
			}
		})
	}
}
func TestAppendRejectsInvalidRecordWithoutOpeningOrChangingArchive(t *testing.T) {
	file := filepath.Join(t.TempDir(), "archive.jsonl")
	if err := Append(file, []byte("{")); err == nil {
		t.Fatal("accepted invalid JSON")
	}
	if _, err := os.Stat(file); !os.IsNotExist(err) {
		t.Fatal("invalid append created file")
	}
	data, _ := Encode("meta", 1)
	if err := Append(file, data); err != nil {
		t.Fatal(err)
	}
	before, _ := os.ReadFile(file)
	if err := Append(file, []byte("{")); err == nil {
		t.Fatal("accepted partial record")
	}
	after, _ := os.ReadFile(file)
	if !bytes.Equal(before, after) {
		t.Fatal("invalid append changed archive")
	}
}

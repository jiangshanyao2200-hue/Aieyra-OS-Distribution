package patch

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"github.com/aieyra/aieyra-os/contracts/protocol"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func patchCall(text string) protocol.ToolCall {
	b, _ := json.Marshal(PatchRequest{Patch: text, Description: "核对文件修改"})
	return protocol.ToolCall{ID: "patch", Function: protocol.FunctionCall{Name: "apply_patch", Arguments: string(b)}}
}

func TestPatchOperationSeparatorsPreserveContent(t *testing.T) {
	root := t.TempDir()
	os.WriteFile(filepath.Join(root, "original.txt"), []byte("old\n\n"), 0600)
	patch := "*** Begin Patch\n\n*** Add File: 新 文件.txt\n+first\n+\n+last\n\n\n*** Update File: original.txt\n@@\n-old\n+new\n \n\n*** End Patch"
	r := ExecutePatch(context.Background(), root, filepath.Join(root, "log"), patchCall(patch), "separators")
	if !r.OK {
		t.Fatalf("%+v", r.Error)
	}
	for name, want := range map[string]string{"新 文件.txt": "first\n\nlast\n", "original.txt": "new\n\n"} {
		got, err := os.ReadFile(filepath.Join(root, name))
		if err != nil || string(got) != want {
			t.Fatalf("%s: %q %v", name, got, err)
		}
	}
	bad := "*** Begin Patch\n*** Add File: forbidden.txt\n+first\n\n+last\n*** End Patch"
	r = ExecutePatch(context.Background(), root, filepath.Join(root, "log"), patchCall(bad), "ambiguous")
	if r.OK || r.Error == nil || !strings.Contains(r.Error.Message, "内容空行") {
		t.Fatalf("ambiguous content accepted: %+v", r)
	}
	if _, err := os.Stat(filepath.Join(root, "forbidden.txt")); !os.IsNotExist(err) {
		t.Fatal("rejected patch wrote a file")
	}
}
func TestPatchPreservesTextAndReportsActualLocations(t *testing.T) {
	root := t.TempDir()
	original := []byte("\ufeff开始\r\nvalue = 1\r\n尾行")
	os.WriteFile(filepath.Join(root, "旧 文件.txt"), original, 0644)
	r := ExecutePatch(context.Background(), root, filepath.Join(root, "receipts"), patchCall("*** Begin Patch\n*** Update File: 旧 文件.txt\n*** Move to: 子目录/新 文件.txt\n@@\n 开始\n-value = 1\n+value = 2\n 尾行\n*** Add File: empty.txt\n*** End Patch"), "test")
	if !r.OK || r.State != "applied" || len(r.Files) != 2 {
		t.Fatalf("%+v error=%+v", r, r.Error)
	}
	got, err := os.ReadFile(filepath.Join(root, "子目录", "新 文件.txt"))
	if err != nil || !bytes.Equal(got, []byte("\ufeff开始\r\nvalue = 2\r\n尾行")) {
		t.Fatalf("encoding/newline changed: %q %v", got, err)
	}
	if _, err = os.Stat(filepath.Join(root, "旧 文件.txt")); !os.IsNotExist(err) {
		t.Fatal("move source remains")
	}
	f := r.Files[0]
	if f.Added != 1 || f.Removed != 1 || f.Hunks[0].Lines[1].Text != "value = 1" || f.Hunks[0].Lines[2].New != 2 || !f.NoFinalNewline {
		t.Fatalf("wrong diff %+v", f)
	}
	if strings.Contains(PatchModelOutput(r), "value = 2") {
		t.Fatal("full code unnecessarily sent back to model")
	}
}
func TestPatchPreflightRejectsWholeBatchAndAmbiguity(t *testing.T) {
	for _, test := range []struct{ name, body, code string }{
		{"ambiguous", "*** Update File: a\n@@\n-x\n+y\n", "ambiguous_context"},
		{"missing", "*** Update File: a\n@@\n-missing\n+y\n", "context_not_found"},
		{"overwrite", "*** Add File: a\n+x\n", "file_exists"},
	} {
		t.Run(test.name, func(t *testing.T) {
			root := t.TempDir()
			os.WriteFile(filepath.Join(root, "a"), []byte("x\nx\n"), 0644)
			r := ExecutePatch(context.Background(), root, filepath.Join(root, "log"), patchCall("*** Begin Patch\n*** Add File: must-not-exist\n+hello\n"+test.body+"*** End Patch"), "test")
			if r.OK || r.Error == nil || r.Error.Code != test.code {
				t.Fatalf("%+v", r.Error)
			}
			if _, e := os.Stat(filepath.Join(root, "must-not-exist")); !os.IsNotExist(e) {
				t.Fatal("preflight mutated first file")
			}
			b, _ := os.ReadFile(filepath.Join(root, "a"))
			if string(b) != "x\nx\n" {
				t.Fatal("failed patch changed original")
			}
		})
	}
}
func TestPatchMultipleHunksAnchorsWhitespaceAndEOF(t *testing.T) {
	root := t.TempDir()
	os.WriteFile(filepath.Join(root, "a"), []byte("one\nx\ntwo\nx  \nend\n"), 0644)
	r := ExecutePatch(context.Background(), root, filepath.Join(root, "log"), patchCall("*** Begin Patch\n*** Update File: a\n@@\n one\n-x\n+first\n two\n@@ two\n-x\n+second\n end\n@@\n+last\n\\ No newline at end of file\n*** End of File\n*** End Patch"), "multi")
	if !r.OK {
		t.Fatalf("%+v", r.Error)
	}
	b, _ := os.ReadFile(filepath.Join(root, "a"))
	if string(b) != "one\nfirst\ntwo\nsecond\nend\nlast" {
		t.Fatalf("%q", b)
	}
	if r.Files[0].Hunks[1].Lines[0].Text != "x  " || r.Files[0].Hunks[1].Match != "trailing_whitespace" {
		t.Fatal("diff does not show actual old bytes")
	}
}
func TestPatchRollbackProtectsExternalEdits(t *testing.T) {
	for _, external := range []bool{false, true} {
		t.Run(map[bool]string{false: "rollback", true: "external"}[external], func(t *testing.T) {
			root := t.TempDir()
			for _, name := range []string{"a", "b"} {
				os.WriteFile(filepath.Join(root, name), []byte("old\n"), 0644)
			}
			ops, _ := parsePatch("*** Begin Patch\n*** Update File: a\n@@\n-old\n+new\n*** Update File: b\n@@\n-old\n+new\n*** End Patch")
			p, err := preparePatch(root, ops)
			if err != nil {
				t.Fatal(err)
			}
			writes := 0
			r := commitPatch(context.Background(), p, filepath.Join(root, "log"), "rollback", "", func(path string, b []byte, keep bool, mode os.FileMode) error {
				writes++
				if writes == 2 {
					if external {
						os.WriteFile(filepath.Join(root, "a"), []byte("someone else's edit\n"), 0644)
					}
					return errors.New("injected write failure")
				}
				return patchWrite(path, b, keep, mode)
			})
			want, state := "old\n", "rolled_back"
			if external {
				want, state = "someone else's edit\n", "partial"
			}
			b, _ := os.ReadFile(filepath.Join(root, "a"))
			if string(b) != want || r.OK || r.State != state || r.RecoveryPath == "" {
				t.Fatalf("state=%s bytes=%q", r.State, b)
			}
			if _, err = os.Stat(r.RecoveryPath); err != nil {
				t.Fatal("recovery missing")
			}
		})
	}
}
func TestPatchDetectsConcurrentModificationBeforeAnyWrite(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "a")
	os.WriteFile(path, []byte("old\n"), 0644)
	ops, _ := parsePatch("*** Begin Patch\n*** Update File: a\n@@\n-old\n+new\n*** End Patch")
	p, err := preparePatch(root, ops)
	if err != nil {
		t.Fatal(err)
	}
	os.WriteFile(path, []byte("external\n"), 0644)
	r := commitPatch(context.Background(), p, filepath.Join(root, "log"), "conflict", "", nil)
	if r.OK || r.State != "rejected" {
		t.Fatal(r)
	}
	b, _ := os.ReadFile(path)
	if string(b) != "external\n" {
		t.Fatal("overwrote external edit")
	}
}

func TestPatchAnchorOnlyInsertionAndMatchingBound(t *testing.T) {
	root := t.TempDir()
	os.WriteFile(filepath.Join(root, "a"), []byte("unique anchor\ntail\n"), 0644)
	r := ExecutePatch(context.Background(), root, filepath.Join(root, "log"), patchCall("*** Begin Patch\n*** Update File: a\n@@ unique anchor\n+inserted\n*** End Patch"), "insert")
	if !r.OK {
		t.Fatalf("%+v", r.Error)
	}
	b, _ := os.ReadFile(filepath.Join(root, "a"))
	if string(b) != "unique anchor\ninserted\ntail\n" {
		t.Fatalf("%q", b)
	}
	source := make([]patchTextLine, 100000)
	for i := range source {
		source[i] = patchTextLine{"repeat", "\n"}
	}
	pattern := make([]string, 10000)
	for i := range pattern {
		pattern[i] = "repeat"
	}
	pattern[len(pattern)-1] = "missing"
	if got := patchContextPositions(source, pattern, 0, false, false); len(got) != 0 {
		t.Fatal("false context match")
	}
}

func BenchmarkPatchRepeatedContext(b *testing.B) {
	source := make([]patchTextLine, 100000)
	for i := range source {
		source[i] = patchTextLine{"repeat", "\n"}
	}
	pattern := make([]string, 10000)
	for i := range pattern {
		pattern[i] = "repeat"
	}
	pattern[len(pattern)-1] = "missing"
	for b.Loop() {
		patchContextPositions(source, pattern, 0, false, false)
	}
}

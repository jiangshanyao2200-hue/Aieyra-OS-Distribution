package patch_test

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/aieyra/aieyra-os/contracts/protocol"
	patch "github.com/aieyra/aieyra-os/tool/base/official/apply_patch"
	patchtext "github.com/aieyra/aieyra-os/tool/base/official/apply_patch/presentation/text"
)

func TestExecutedReceiptRemainsReadableWithoutRepeatingTheWrite(t *testing.T) {
	root := t.TempDir()
	input := "*** Begin Patch\n*** Add File: 文件.txt\n+真实结果 👩‍💻\n*** End Patch"
	args, _ := json.Marshal(patch.PatchRequest{Patch: input})
	call := protocol.ToolCall{ID: "fixture", Function: protocol.FunctionCall{Name: "apply_patch", Arguments: string(args)}}
	r := patch.ExecutePatch(context.Background(), root, filepath.Join(root, "receipts"), call, "fixture:once")
	if !r.OK {
		t.Fatal(r)
	}
	raw, _ := json.Marshal(r)
	view, ok := patchtext.Preview(raw, nil)
	if !ok || !strings.Contains(view, "+ 真实结果 👩‍💻") || !strings.Contains(view, "文件.txt") {
		t.Fatal("execution result lost in text projection", view)
	}
	if strings.Contains(patch.PatchModelOutput(r), "真实结果") {
		t.Fatal("full diff leaked into the concise model receipt")
	}
	if err := os.WriteFile(filepath.Join(root, "文件.txt"), []byte("用户后续编辑"), 0600); err != nil {
		t.Fatal(err)
	}
	// Rendering a saved receipt cannot rewrite a later user edit.
	if next, ok := patchtext.Preview(raw, nil); !ok || next != view {
		t.Fatal("saved receipt presentation changed")
	}
	data, err := os.ReadFile(filepath.Join(root, "文件.txt"))
	if err != nil || string(data) != "用户后续编辑" {
		t.Fatal("presentation touched the user's file", err)
	}
}

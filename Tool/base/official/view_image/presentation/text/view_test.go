package text

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
)

func TestPreviewPreservesEntireReceipt(t *testing.T) {
	raw := json.RawMessage(`{"image_id":"snapshot","mime":"image/jpeg","width":100,"height":60,"paths":["alpha.png","blue.png"],"layout":{"tiles":[{"index":1,"path":"alpha.png"}]},"observation":"detail","future":{"receipt":"keep"}}`)
	before := append([]byte(nil), raw...)
	got, ok := Preview(raw)
	if !ok || !bytes.Equal(raw, before) {
		t.Fatalf("preview mutated or rejected: %s", got)
	}
	for _, want := range []string{"2 张拼图", "alpha.png", "blue.png", `"index": 1`, `"observation": "detail"`, `"receipt": "keep"`} {
		if !strings.Contains(got, want) {
			t.Fatalf("missing %s in %s", want, got)
		}
	}
	for _, bad := range []string{`{}`, `{"image_id":"snapshot"}`, `null`, `invalid`} {
		if _, ok := Preview(json.RawMessage(bad)); ok {
			t.Fatalf("recognized %s", bad)
		}
	}
}

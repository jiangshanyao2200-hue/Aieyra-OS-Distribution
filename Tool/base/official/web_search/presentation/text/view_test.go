package text

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
)

func TestPreviewRetainsExactSourcesAndUnknownFields(t *testing.T) {
	raw := json.RawMessage(`{"query":"source","state":"completed","provider":"fixture","searches":[{"results":[{"title":"Example","url":"https://example.invalid/long?q=1#part"}]}],"fallback_reason":"native_search_unsupported","future":{"keep":"unchanged"}}`)
	before := append([]byte(nil), raw...)
	got, ok := Preview(raw)
	for _, want := range []string{"https://example.invalid/long?q=1#part", "native_search_unsupported", `"keep": "unchanged"`} {
		if !ok || !strings.Contains(got, want) || !bytes.Equal(raw, before) {
			t.Fatal(got)
		}
	}
	if _, ok = Preview(json.RawMessage(`{"state":"completed","query":"unknown tool"}`)); ok {
		t.Fatal("recognized unrelated tool")
	}
}

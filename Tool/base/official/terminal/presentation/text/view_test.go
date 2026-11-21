package text

import (
	"strings"
	"testing"
)

func TestReceiptKeepsUncertainExitInputAcknowledgementAndUnknownFields(t *testing.T) {
	raw := []byte(`{"session_id":9,"state":"cancelled","exit_code":null,"output":"最后🙂","output_bytes":8,"next_offset":8,"input_state":"unknown","private_output":true,"new_field":{"record":42}}`)
	got, ok := Preview(raw)
	if !ok {
		t.Fatal("not recognized")
	}
	for _, part := range []string{"最后🙂", `"exit_code": null`, `"input_state": "unknown"`, `"private_output": true`, `"record": 42`, `"next_offset": 8`} {
		if !strings.Contains(got, part) {
			t.Fatal("lost", part, got)
		}
	}
	if _, ok = Preview([]byte(`{"state":"completed","output":"ordinary"}`)); ok {
		t.Fatal("non-terminal receipt claimed")
	}
	if _, ok = Preview([]byte(`{"state":"rejected","output_bytes":0,"next_offset":0,"error":{"code":"invalid_arguments"}}`)); !ok {
		t.Fatal("pre-execution error lost")
	}
}

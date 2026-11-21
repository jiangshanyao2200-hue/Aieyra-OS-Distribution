package text

import (
	"bytes"
	"encoding/json"
	"fmt"
)

// Preview retains the complete receipt, including input acknowledgements,
// byte cursors, uncertain exit states and future fields. Plain output alone
// cannot establish that a command succeeded or even exited.
func Preview(raw json.RawMessage) (string, bool) {
	var receipt struct {
		SessionID   int    `json:"session_id"`
		State       string `json:"state"`
		OutputBytes *int64 `json:"output_bytes"`
		NextOffset  *int64 `json:"next_offset"`
	}
	if json.Unmarshal(raw, &receipt) != nil || receipt.State == "" || receipt.OutputBytes == nil || receipt.NextOffset == nil {
		return "", false
	}
	var full bytes.Buffer
	if json.Indent(&full, raw, "", "  ") != nil {
		return "", false
	}
	return fmt.Sprintf("终端 %d · %s\n%s", receipt.SessionID, receipt.State, full.String()), true
}

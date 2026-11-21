package text

import (
	"bytes"
	"encoding/json"
)

// Preview keeps the complete safe receipt, including failures and unknowns.
func Preview(raw json.RawMessage) (string, bool) {
	var result struct {
		Kind string `json:"kind"`
	}
	if json.Unmarshal(raw, &result) != nil || result.Kind != "video_gen" {
		return "", false
	}
	var output bytes.Buffer
	if json.Indent(&output, raw, "", "  ") != nil {
		return "", false
	}
	return output.String(), true
}

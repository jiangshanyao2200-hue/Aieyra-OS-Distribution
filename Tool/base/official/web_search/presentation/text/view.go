package text

import (
	"bytes"
	"encoding/json"
	"fmt"
	"github.com/aieyra/aieyra-os/tool/base/official/web_search/contract"
	"strings"
)

func Preview(raw json.RawMessage) (string, bool) {
	var r contract.Result
	if json.Unmarshal(raw, &r) != nil || r.Query == "" || r.State == "" || (r.Provider == "" && r.Searches == nil && r.Error == nil) {
		return "", false
	}
	var text strings.Builder
	fmt.Fprintf(&text, "%s · %s\n", r.Query, r.State)
	for _, round := range r.Searches {
		for _, hit := range round.Results {
			fmt.Fprintf(&text, "%s\n%s\n", hit.Title, hit.URL)
		}
	}
	var full bytes.Buffer
	if json.Indent(&full, raw, "", "  ") != nil {
		return "", false
	}
	text.WriteString(full.String())
	return text.String(), true
}

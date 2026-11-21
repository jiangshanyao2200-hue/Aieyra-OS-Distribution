package text

import (
	"bytes"
	"encoding/json"
	"fmt"
	"github.com/aieyra/aieyra-os/tool/base/official/view_image/contract"
	"strings"
)

func Summary(r contract.Result) string {
	source := r.Path
	if len(r.Paths) > 0 {
		source = fmt.Sprintf("%d 张拼图：%s", len(r.Paths), strings.Join(r.Paths, "；"))
	}
	summary := fmt.Sprintf("%s\n%d × %d · %s\n%s", source, r.Width, r.Height, r.MIME, r.ImageID)
	if r.Observation != "" {
		summary += "\n" + strings.Join([]string{r.ObservationSource, r.ObservationModel, r.ObservationLanguage}, " ") + "\n" + r.Observation
		if r.Limitation != "" {
			summary += "\n" + r.Limitation
		}
	}
	return summary
}

// Preview recognizes stored image receipts and retains all raw fields.
func Preview(raw json.RawMessage) (string, bool) {
	var r contract.Result
	if json.Unmarshal(raw, &r) != nil || r.ImageID == "" || r.MIME == "" || r.Width <= 0 || r.Height <= 0 {
		return "", false
	}
	var full bytes.Buffer
	if json.Indent(&full, raw, "", "  ") != nil {
		return "", false
	}
	return Summary(r) + "\n" + full.String(), true
}

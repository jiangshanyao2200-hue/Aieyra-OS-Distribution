// Package text renders actual patch receipts for CLI and text fallbacks.
package text

import (
	"bytes"
	"encoding/json"
	"fmt"
	"github.com/aieyra/aieyra-os/tool/base/official/apply_patch/contract"
	"strings"
)

// Preview returns false for other tools. errorText preserves the host's generic error formatting.
func Preview(raw json.RawMessage, errorText func(json.RawMessage) string) (string, bool) {
	var p struct {
		State        string
		Files        json.RawMessage
		Error        json.RawMessage
		Omitted      int `json:"omitted_lines"`
		OmittedFiles int `json:"omitted_files"`
	}
	if json.Unmarshal(raw, &p) != nil {
		return "", false
	}
	var files []contract.PatchFile
	patch := json.Unmarshal(p.Files, &files) == nil && len(files) > 0
	for _, f := range files {
		patch = patch && f.Path != "" && f.Operation != ""
	}
	if patch {
		var lines []string
		if p.State != "" {
			lines = append(lines, "状态："+p.State)
		}
		for _, f := range files {
			op := map[string]string{"add": "新建", "update": "修改", "delete": "删除"}[f.Operation]
			if op == "" {
				op = f.Operation
			}
			path := f.Path
			if f.NewPath != "" {
				path += " → " + f.NewPath
			}
			lines = append(lines, fmt.Sprintf("%s · %s +%d / -%d", path, op, f.Added, f.Removed))
			for _, h := range f.Hunks {
				if h.Context != "" {
					lines = append(lines, "@@ "+h.Context)
				}
				for _, l := range h.Lines {
					prefix := "  "
					switch l.Kind {
					case "add":
						prefix = "+ "
					case "remove", "delete":
						prefix = "- "
					}
					lines = append(lines, prefix+l.Text)
				}
			}
		}
		if p.Omitted > 0 || p.OmittedFiles > 0 {
			lines = append(lines, fmt.Sprintf("… 预览省略 %d 行、%d 个文件；完整内容保留在收据", p.Omitted, p.OmittedFiles))
		}
		if len(p.Error) > 0 && string(p.Error) != "null" {
			detail := string(p.Error)
			if errorText != nil {
				detail = errorText(p.Error)
			} else {
				var pretty bytes.Buffer
				if json.Indent(&pretty, p.Error, "", "  ") == nil {
					detail = pretty.String()
				}
			}
			lines = append(lines, "错误："+detail)
		}
		return strings.Join(lines, "\n"), true
	}
	return "", false
}

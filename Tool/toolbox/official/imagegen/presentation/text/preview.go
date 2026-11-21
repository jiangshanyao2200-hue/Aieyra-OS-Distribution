// Package text supplies a readable image receipt followed by its complete fields.
package text

import (
	"bytes"
	"encoding/json"
	"fmt"
	"github.com/aieyra/aieyra-os/tool/toolbox/official/imagegen/contract"
	"strings"
)

func Preview(raw json.RawMessage) (string, bool) {
	var fields struct {
		Requested, Submitted, Completed *int
		Images                          json.RawMessage
		Operation, BatchID              string
	}
	if json.Unmarshal(raw, &fields) != nil || fields.Requested == nil || fields.Submitted == nil || fields.Completed == nil || fields.Images == nil {
		return "", false
	}
	var result contract.Result
	if json.Unmarshal(raw, &result) != nil || (result.BatchID == "" && result.Operation != "generate" && result.Operation != "edit") {
		return "", false
	}
	lines := []string{fmt.Sprintf("图片：%d / %d 张完成；%d 张未提交", result.Completed, result.Requested, result.Unsubmitted), "状态：" + result.State}
	if result.Unknown {
		lines = append(lines, "结果待核对，请勿重复提交")
	}
	if result.AccountingError != "" {
		lines = append(lines, "用量保存待核对："+result.AccountingError)
	}
	if result.Recovery != "" {
		lines = append(lines, result.Recovery)
	}
	var full bytes.Buffer
	if json.Indent(&full, raw, "", "  ") == nil {
		lines = append(lines, full.String())
	} else {
		lines = append(lines, string(raw))
	}
	return strings.Join(lines, "\n"), true
}

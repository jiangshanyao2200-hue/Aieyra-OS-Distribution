// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: legacyFileRequest; legacyFileLine; legacyFileMatch; LegacyFileResult; IsLegacyFileTool; LegacyFilePreview; Display; legacyFileDefault
// Impact: python -B scripts/code-atlas.py show Core/legacy_file_history.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

// 仅解码 0.1.19 的历史结果；不注册工具，也不读取或搜索文件。
import (
	"encoding/json"
	"fmt"
	"strings"
)

type legacyFileRequest struct {
	Path        string   `json:"path"`
	Description string   `json:"description,omitempty"`
	StartLine   int      `json:"start_line,omitempty"`
	MaxLines    int      `json:"max_lines,omitempty"`
	Pattern     string   `json:"pattern,omitempty"`
	Globs       []string `json:"globs,omitempty"`
}

type legacyFileLine struct {
	Line   int    `json:"line"`
	Column int    `json:"column"`
	Text   string `json:"text"`
}

type legacyFileMatch struct {
	Path          string `json:"path"`
	Line          int    `json:"line"`
	Text          string `json:"text"`
	Context       bool   `json:"context,omitempty"`
	TextTruncated bool   `json:"text_truncated,omitempty"`
}

type LegacyFileResult struct {
	OK                bool              `json:"ok"`
	Tool              string            `json:"tool"`
	State             string            `json:"state"`
	Path              string            `json:"path"`
	Description       string            `json:"description,omitempty"`
	Revision          string            `json:"revision,omitempty"`
	Encoding          string            `json:"encoding,omitempty"`
	Lines             []legacyFileLine  `json:"lines,omitempty"`
	Files             []string          `json:"files,omitempty"`
	Matches           []legacyFileMatch `json:"matches,omitempty"`
	NextLine          int               `json:"next_line,omitempty"`
	NextColumn        int               `json:"next_column,omitempty"`
	NextOffset        int               `json:"next_offset,omitempty"`
	HasMore           bool              `json:"has_more"`
	EOF               bool              `json:"eof,omitempty"`
	Summary           string            `json:"summary,omitempty"`
	Detail            string            `json:"detail,omitempty"`
	OutputTokenBudget int               `json:"output_token_budget"`
	BudgetReduced     bool              `json:"budget_reduced,omitempty"`
	Error             *ShellError       `json:"error,omitempty"`
}

func IsLegacyFileTool(name string) bool {
	return name == "read_file" || name == "list_files" || name == "search_text"
}

func LegacyFilePreview(call ToolCall) LegacyFileResult {
	var req legacyFileRequest
	_ = json.Unmarshal([]byte(call.Function.Arguments), &req)
	r := LegacyFileResult{Tool: call.Function.Name, Path: req.Path, Description: req.Description, State: "queued"}
	if r.Path == "" {
		r.Path = "."
	}
	r.Detail = r.Path
	switch call.Function.Name {
	case "read_file":
		r.Detail += fmt.Sprintf(" · 从第 %d 行，最多 %d 行", max(1, req.StartLine), legacyFileDefault(req.MaxLines, 200))
	case "search_text":
		r.Detail += " · “" + req.Pattern + "”"
	}
	if len(req.Globs) > 0 {
		r.Detail += " · " + strings.Join(req.Globs, ", ")
	}
	return r
}

// 只用于沿用既有工具过程、历史和查看器；没有伪造 Shell 命令、session_id 或退出码。
func (r LegacyFileResult) Display() ShellResult {
	var b strings.Builder
	for _, line := range r.Lines {
		fmt.Fprintf(&b, "%d:%d  %s\n", line.Line, line.Column, line.Text)
	}
	for _, path := range r.Files {
		fmt.Fprintln(&b, path)
	}
	for _, match := range r.Matches {
		mark := ":"
		if match.Context {
			mark = "-"
		}
		fmt.Fprintf(&b, "%s%s%d  %s", match.Path, mark, match.Line, match.Text)
		if match.TextTruncated {
			b.WriteString(" …（长行预览，完整内容可继续读取）")
		}
		b.WriteByte('\n')
	}
	if r.HasMore {
		if r.Tool == "read_file" {
			fmt.Fprintf(&b, "尚有内容 · 从 %d 行 %d 列续读\n", r.NextLine, r.NextColumn)
		} else {
			fmt.Fprintf(&b, "尚有结果 · 从第 %d 条续查\n", r.NextOffset+1)
		}
	}
	return ShellResult{OK: r.OK, State: r.State, Description: r.Description, Output: b.String(), Error: r.Error, File: &r}
}

func legacyFileDefault(n, fallback int) int {
	if n == 0 {
		return fallback
	}
	return n
}

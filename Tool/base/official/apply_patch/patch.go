package patch

// 补丁协议与供应商无关；只接受可唯一定位的上下文，不用数字行号猜测写入位置。
import (
	"bytes"
	"context"
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"github.com/aieyra/aieyra-os/contracts/protocol"
	"github.com/aieyra/aieyra-os/tool/base/official/apply_patch/contract"
	"io"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"
)

const patchMaxBytes = 4 << 20
const patchFileLimit = 8 << 20

type PatchRequest = contract.PatchRequest
type PatchError = contract.PatchError
type PatchLine = contract.PatchLine
type PatchHunk = contract.PatchHunk
type PatchFile = contract.PatchFile
type PatchResult = contract.PatchResult

type patchOp struct {
	kind, path, dest string
	hunks            []patchInputHunk
	add              []patchInputLine
}
type patchInputHunk struct {
	label string
	lines []patchInputLine
	eof   bool
}
type patchInputLine struct {
	kind      byte
	text      string
	noNewline bool
}
type patchTextLine struct{ text, end string }
type patchPrepared struct {
	paths []patchImage
	files []PatchFile
}
type patchImage struct {
	Path   string      `json:"path"`
	Before []byte      `json:"before,omitempty"`
	After  []byte      `json:"after,omitempty"`
	Exists bool        `json:"exists"`
	Keep   bool        `json:"keep"`
	Mode   os.FileMode `json:"mode"`
}

func patchFailure(code, message string) PatchResult {
	return PatchResult{State: "rejected", Error: &PatchError{Code: code, Message: message}}
}
func patchHash(b []byte) string { sum := sha256.Sum256(b); return hex.EncodeToString(sum[:]) }

//go:embed manual.txt
var patchManual string

func PatchToolDefinition() protocol.ToolDefinition {
	return protocol.ToolDefinition{Type: "function", Name: "apply_patch", Description: strings.TrimSpace(patchManual), Parameters: protocol.SchemaObject(map[string]any{"patch": map[string]any{"type": "string", "description": "Complete *** Begin Patch ... *** End Patch text; do not wrap in a shell command."}, "workdir": protocol.SchemaString(), "description": protocol.SchemaString()}, "patch")}

}

func parsePatch(text string) ([]patchOp, error) {
	if len(text) > patchMaxBytes || !utf8.ValidString(text) || strings.ContainsRune(text, 0) {
		return nil, &PatchError{Code: "invalid_patch", Message: "补丁须为无 NUL 的 UTF-8 文本，最多 4 MiB"}
	}
	text = strings.TrimSpace(strings.TrimPrefix(text, "\ufeff"))
	if strings.HasPrefix(text, "```diff\n") || strings.HasPrefix(text, "```patch\n") || strings.HasPrefix(text, "```\n") {
		a := strings.IndexByte(text, '\n')
		if strings.HasSuffix(text, "\n```") {
			text = text[a+1 : len(text)-4]
		}
	}
	lines := strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n")
	fail := func(n int, s string) ([]patchOp, error) {
		return nil, &PatchError{Code: "invalid_patch", Message: fmt.Sprintf("补丁第 %d 行：%s", n+1, s)}
	}
	if len(lines) < 3 || lines[0] != "*** Begin Patch" || lines[len(lines)-1] != "*** End Patch" {
		return fail(0, "需要完整的 *** Begin Patch / *** End Patch")
	}
	var ops []patchOp
	for i := 1; i < len(lines)-1; {
		if lines[i] == "" {
			i++
			continue
		}
		op := patchOp{}
		for _, kind := range []string{"Add", "Update", "Delete"} {
			if strings.HasPrefix(lines[i], "*** "+kind+" File: ") {
				op.kind = strings.ToLower(kind)
				op.path = strings.TrimSpace(strings.TrimPrefix(lines[i], "*** "+kind+" File: "))
			}
		}
		if op.kind == "" || op.path == "" {
			return fail(i, "需要 Add/Update/Delete File 与文件路径")
		}
		i++
		if i < len(lines)-1 && strings.HasPrefix(lines[i], "*** Move to: ") {
			if op.kind != "update" {
				return fail(i, "Move to 只能跟在 Update File 后")
			}
			op.dest = strings.TrimSpace(strings.TrimPrefix(lines[i], "*** Move to: "))
			if op.dest == "" {
				return fail(i, "移动目标不能为空")
			}
			i++
		}
		for i < len(lines)-1 && !strings.HasPrefix(lines[i], "*** Add File: ") && !strings.HasPrefix(lines[i], "*** Update File: ") && !strings.HasPrefix(lines[i], "*** Delete File: ") {
			// 裸空行只在操作边界具有明确的分隔语义；带空格的上下文行不能吞掉。
			if lines[i] == "" {
				next := i
				for next < len(lines)-1 && lines[next] == "" {
					next++
				}
				if next == len(lines)-1 || strings.HasPrefix(lines[next], "*** Add File: ") || strings.HasPrefix(lines[next], "*** Update File: ") || strings.HasPrefix(lines[next], "*** Delete File: ") {
					i = next
					break
				}
				if op.kind == "add" {
					return fail(i, "Add File 的内容空行请写为 +；裸空行只允许分隔文件操作")
				}
			}
			if op.kind == "delete" {
				return fail(i, "Delete File 不需要正文")
			}
			if op.kind == "update" && strings.HasPrefix(lines[i], "@@") {
				op.hunks = append(op.hunks, patchInputHunk{label: strings.TrimSpace(strings.TrimPrefix(lines[i], "@@"))})
				i++
				continue
			}
			if lines[i] == "*** End of File" {
				if op.kind != "update" || len(op.hunks) == 0 {
					return fail(i, "End of File 必须跟在 hunk 后")
				}
				op.hunks[len(op.hunks)-1].eof = true
				i++
				continue
			}
			var target *[]patchInputLine
			if op.kind == "add" {
				target = &op.add
			} else {
				if len(op.hunks) == 0 {
					op.hunks = append(op.hunks, patchInputHunk{})
				}
				target = &op.hunks[len(op.hunks)-1].lines
			}
			if lines[i] == "\\ No newline at end of file" {
				if len(*target) == 0 {
					return fail(i, "无末尾换行标记前缺少代码行")
				}
				(*target)[len(*target)-1].noNewline = true
				i++
				continue
			}
			line := lines[i]
			if line == "" {
				line = " "
			}
			if line[0] != '+' && (op.kind == "add" || line[0] != '-' && line[0] != ' ') {
				return fail(i, "代码行需要空格、+ 或 - 前缀")
			}
			*target = append(*target, patchInputLine{kind: line[0], text: line[1:]})
			i++
		}
		if op.kind == "update" && len(op.hunks) == 0 && op.dest == "" {
			return fail(i, "Update File 没有修改内容")
		}
		ops = append(ops, op)
		if len(ops) > 256 {
			return fail(i, "一次补丁最多修改 256 个文件")
		}
	}
	if len(ops) == 0 {
		return fail(1, "补丁为空")
	}
	return ops, nil
}

func splitPatchText(b []byte) ([]patchTextLine, string, bool) {
	bom := bytes.HasPrefix(b, []byte{0xef, 0xbb, 0xbf})
	if bom {
		b = b[3:]
	}
	eol := "\n"
	if bytes.Count(b, []byte("\r\n"))*2 > bytes.Count(b, []byte("\n")) {
		eol = "\r\n"
	}
	var lines []patchTextLine
	for len(b) > 0 {
		i := bytes.IndexByte(b, '\n')
		if i < 0 {
			lines = append(lines, patchTextLine{string(b), ""})
			break
		}
		end := "\n"
		text := b[:i]
		if len(text) > 0 && text[len(text)-1] == '\r' {
			text = text[:len(text)-1]
			end = "\r\n"
		}
		lines = append(lines, patchTextLine{string(text), end})
		b = b[i+1:]
	}
	return lines, eol, bom
}
func joinPatchText(lines []patchTextLine, bom bool) []byte {
	var b strings.Builder
	if bom {
		b.WriteString("\ufeff")
	}
	for _, line := range lines {
		b.WriteString(line.text)
		b.WriteString(line.end)
	}
	return []byte(b.String())
}

func applyPatchHunks(before []byte, op patchOp) ([]byte, []PatchHunk, error) {
	source, eol, bom := splitPatchText(before)
	var out []patchTextLine
	var result []PatchHunk
	cursor := 0
	for hn, h := range op.hunks {
		var expected []string
		for _, l := range h.lines {
			if l.kind != '+' {
				expected = append(expected, l.text)
			}
		}
		begin := cursor
		anchor := -1
		// 完整的上下文锚点可以缩小范围；普通函数标签仅作为说明，不假定是代码。
		if h.label != "" && !strings.HasPrefix(h.label, "-") {
			matches := []int{}
			for n := cursor; n < len(source); n++ {
				if source[n].text == h.label {
					matches = append(matches, n)
				}
			}
			if len(matches) == 1 {
				begin = matches[0]
				anchor = begin
			}
		}
		positions := []int{}
		matchKind := "exact"
		find := func(trim bool) { positions = patchContextPositions(source, expected, begin, h.eof, trim) }

		if len(expected) == 0 {
			if len(source) == 0 {
				positions = []int{0}
			} else if h.eof {
				positions = []int{len(source)}
			} else if anchor >= 0 {
				positions = []int{anchor + 1}
			}
		} else {
			find(false)
			if len(positions) == 0 {
				matchKind = "trailing_whitespace"
				find(true)
			}
		}
		if len(positions) != 1 {
			code, msg := "context_not_found", "上下文已变化或未找到，请重读文件后提交完整、唯一的上下文"
			if len(positions) > 1 {
				code, msg = "ambiguous_context", "上下文重复，请增加前后代码或唯一 @@ 锚点，未猜测写入位置"
			}
			actual := []string{}
			for n := cursor; n < min(len(source), cursor+6); n++ {
				actual = append(actual, source[n].text)
			}
			return nil, nil, &PatchError{Code: code, Message: fmt.Sprintf("%s，文件 %s，片段 %d", msg, op.path, hn+1), Path: op.path, Hunk: hn + 1, Expected: expected[:min(6, len(expected))], Actual: actual}
		}
		pos := positions[0]
		out = append(out, source[cursor:pos]...)
		receipt := PatchHunk{Context: h.label, OldStart: pos + 1, NewStart: len(out) + 1, Match: matchKind}
		old, newLine := pos, len(out)+1
		for _, l := range h.lines {
			switch l.kind {
			case ' ':
				receipt.Lines = append(receipt.Lines, PatchLine{Kind: "context", Text: source[old].text, Old: old + 1, New: newLine})
				out = append(out, source[old])
				old++
				newLine++
			case '-':
				receipt.Lines = append(receipt.Lines, PatchLine{Kind: "remove", Text: source[old].text, Old: old + 1})
				old++
			case '+':
				receipt.Lines = append(receipt.Lines, PatchLine{Kind: "add", Text: l.text, New: newLine})
				end := eol
				if l.noNewline {
					end = ""
				}
				out = append(out, patchTextLine{l.text, end})
				newLine++
			}
		}
		cursor = old
		result = append(result, receipt)
	}
	out = append(out, source[cursor:]...)
	// 未显式指定时保留原文件的末尾换行习惯；新插入的中间行仍须有分隔符。
	noFinal := len(source) > 0 && source[len(source)-1].end == ""
	for i := range out {
		if i < len(out)-1 && out[i].end == "" {
			out[i].end = eol
		}
	}
	if noFinal && len(out) > 0 {
		out[len(out)-1].end = ""
	}
	return joinPatchText(out, bom), result, nil
}

func patchPath(root, path string) (string, error) {
	if strings.ContainsAny(path, "\x00\r\n") {
		return "", fmt.Errorf("文件路径包含控制字符")
	}
	if !filepath.IsAbs(path) {
		path = filepath.Join(root, path)
	}
	absolute, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	// 拒绝经符号链接/重解析点写入；让模型明确指定真实路径，避免改到不可见的目标。
	for p := absolute; ; p = filepath.Dir(p) {
		info, e := os.Lstat(p)
		if e == nil && info.Mode()&os.ModeSymlink != 0 {
			return "", fmt.Errorf("路径经过符号链接，请使用真实路径：%s", p)
		}
		if e != nil && !os.IsNotExist(e) {
			return "", e
		}
		if filepath.Dir(p) == p {
			break
		}
	}
	return absolute, nil
}
func readPatchFile(path string) ([]byte, os.FileMode, bool, error) {
	info, err := os.Lstat(path)
	if os.IsNotExist(err) {
		return nil, 0644, false, nil
	}
	if err != nil {
		return nil, 0, false, err
	}
	if !info.Mode().IsRegular() || info.Size() > patchFileLimit {
		return nil, 0, false, fmt.Errorf("只编辑最多 8 MiB 的普通 UTF-8 文件：%s", path)
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, 0, false, err
	}
	if !utf8.Valid(b) || bytes.IndexByte(b, 0) >= 0 {
		return nil, 0, false, fmt.Errorf("文件不是 UTF-8 文本：%s", path)
	}
	return b, info.Mode().Perm(), true, nil
}
func preparePatch(root string, ops []patchOp) (patchPrepared, error) {
	p := patchPrepared{}
	seen := map[string]bool{}
	size := 0
	for _, op := range ops {
		path, err := patchPath(root, op.path)
		if err != nil {
			return p, err
		}
		dest := path
		if op.dest != "" {
			dest, err = patchPath(root, op.dest)
			if err != nil {
				return p, err
			}
		}
		for _, name := range []string{path, dest} {
			key := strings.ToLower(name)
			if name == dest && dest == path {
				continue
			}
			if seen[key] {
				return p, fmt.Errorf("同一批次重复修改路径：%s；请合并该文件的 hunks", name)
			}
			seen[key] = true
		}
		if dest == path {
			key := strings.ToLower(path)
			if seen[key] {
				return p, fmt.Errorf("重复文件：%s", path)
			}
			seen[key] = true
		}
		before, mode, exists, err := readPatchFile(path)
		if err != nil {
			return p, err
		}
		if op.kind == "add" && exists {
			return p, &PatchError{Code: "file_exists", Path: op.path, Message: "Add File 的目标已存在，请读取后使用 Update File"}
		}
		if op.kind != "add" && !exists {
			return p, &PatchError{Code: "file_missing", Path: op.path, Message: "目标文件不存在，请核对 workdir 和路径"}
		}
		f := PatchFile{Path: op.path, NewPath: op.dest, Operation: op.kind, BeforeHash: patchHash(before)}
		var after []byte
		switch op.kind {
		case "add":
			h := PatchHunk{OldStart: 0, NewStart: 1}
			lines := []patchTextLine{}
			for n, l := range op.add {
				end := "\n"
				if l.noNewline {
					if n < len(op.add)-1 {
						return p, fmt.Errorf("无末尾换行标记只可用于最后一行")
					}
					end = ""
				}
				lines = append(lines, patchTextLine{l.text, end})
				h.Lines = append(h.Lines, PatchLine{Kind: "add", Text: l.text, New: n + 1})
			}
			after = joinPatchText(lines, false)
			f.Hunks = []PatchHunk{h}
		case "delete":
			source, _, _ := splitPatchText(before)
			h := PatchHunk{OldStart: 1}
			for n, l := range source {
				h.Lines = append(h.Lines, PatchLine{Kind: "remove", Text: l.text, Old: n + 1})
			}
			f.Hunks = []PatchHunk{h}
		case "update":
			after, f.Hunks, err = applyPatchHunks(before, op)
			if err != nil {
				return p, err
			}
			if dest != path {
				f.Operation = "move"
			}
		}
		if len(after) > patchFileLimit {
			return p, fmt.Errorf("编辑后文件超过 8 MiB：%s", path)
		}
		for _, h := range f.Hunks {
			for _, l := range h.Lines {
				if l.Kind == "add" {
					f.Added++
				}
				if l.Kind == "remove" {
					f.Removed++
				}
			}
		}
		f.AfterHash = patchHash(after)
		f.NoFinalNewline = len(after) > 0 && !bytes.HasSuffix(after, []byte("\n"))
		if op.kind == "update" && dest == path && bytes.Equal(before, after) {
			f.Operation = "unchanged"
			f.Added = 0
			f.Removed = 0
			f.Hunks = nil
		}
		p.files = append(p.files, f)
		if dest != path {
			_, _, targetExists, e := readPatchFile(dest)
			if e != nil {
				return p, e
			}
			if targetExists {
				return p, &PatchError{Code: "file_exists", Path: op.dest, Message: "移动目标已存在，未覆盖"}
			}
			p.paths = append(p.paths, patchImage{Path: dest, After: after, Keep: true, Mode: mode})
			p.paths = append(p.paths, patchImage{Path: path, Before: before, Exists: true, Mode: mode})
		} else if f.Operation != "unchanged" {
			p.paths = append(p.paths, patchImage{Path: path, Before: before, After: after, Exists: exists, Keep: op.kind != "delete", Mode: mode})
		}
		size += len(before) + len(after)
		if size > 64<<20 {
			return p, fmt.Errorf("单批文件内容超过 64 MiB，请拆分补丁")
		}
	}
	return p, nil
}

func ExecutePatch(ctx context.Context, root, recoveryDir string, call protocol.ToolCall, key string) PatchResult {
	return ExecutePatchWithPaths(ctx, root, recoveryDir, call, key, nil)
}

// The host resolves migrated work directories without changing the original
// call, patch text, journal identity or historical receipts.
func ExecutePatchWithPaths(ctx context.Context, root, recoveryDir string, call protocol.ToolCall, key string, relocate func(string) string) PatchResult {
	var req PatchRequest
	if len(call.Function.Arguments) > 8<<20 {
		return patchFailure("invalid_arguments", "补丁参数过大")
	}
	decoder := json.NewDecoder(strings.NewReader(call.Function.Arguments))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&req); err != nil {
		return patchFailure("invalid_arguments", err.Error())
	}
	if decoder.Decode(new(any)) != io.EOF {
		return patchFailure("invalid_arguments", "参数含额外 JSON")
	}
	if req.Workdir != "" {
		root = req.Workdir
	}
	if relocate != nil {
		root = relocate(root)
	}
	if root == "" {
		root, _ = os.Getwd()
	}
	ops, err := parsePatch(req.Patch)
	if err != nil {
		return patchErrorResult(err)
	}
	p, err := preparePatch(root, ops)
	if err != nil {
		return patchErrorResult(err)
	}
	if ctx.Err() != nil {
		return patchFailure("cancelled", "调用已停止，补丁未写入")
	}
	return commitPatch(ctx, p, recoveryDir, key, req.Description, nil)
}
func patchErrorResult(err error) PatchResult {
	if pe, ok := err.(*PatchError); ok {
		return PatchResult{State: "rejected", Error: pe}
	}
	return patchFailure("preflight_failed", err.Error())
}

// 模型收到简洁收据；完整差异保存在领域收据中供恢复与查看器使用。
func PatchModelOutput(r PatchResult) string {
	summary := r
	summary.Files = append([]PatchFile(nil), r.Files...)
	for i := range summary.Files {
		f := &summary.Files[i]
		f.Hunks = append([]PatchHunk(nil), f.Hunks...)
		for j := range f.Hunks {
			f.Hunks[j].Lines = nil
		}
	}
	b, _ := json.Marshal(summary)
	return string(b)
}

// KMP 按行匹配，重复代码的大文件也保持线性扫描；两处匹配已足够判定歧义。
func patchContextPositions(source []patchTextLine, expected []string, begin int, eof, trim bool) []int {
	normalize := func(s string) string {
		if trim {
			return strings.TrimRight(s, " \t")
		}
		return s
	}
	pattern := make([]string, len(expected))
	for i, s := range expected {
		pattern[i] = normalize(s)
	}
	if len(pattern) == 0 {
		return nil
	}
	if eof {
		n := len(source) - len(pattern)
		if n < begin {
			return nil
		}
		for i, s := range pattern {
			if normalize(source[n+i].text) != s {
				return nil
			}
		}
		return []int{n}
	}
	prefix := make([]int, len(pattern))
	for i, j := 1, 0; i < len(pattern); i++ {
		for j > 0 && pattern[i] != pattern[j] {
			j = prefix[j-1]
		}
		if pattern[i] == pattern[j] {
			j++
		}
		prefix[i] = j
	}
	var found []int
	for i, j := begin, 0; i < len(source); i++ {
		s := normalize(source[i].text)
		for j > 0 && s != pattern[j] {
			j = prefix[j-1]
		}
		if s == pattern[j] {
			j++
		}
		if j == len(pattern) {
			found = append(found, i-j+1)
			if len(found) == 2 {
				return found
			}
			j = prefix[j-1]
		}
	}
	return found
}

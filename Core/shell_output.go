// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: CleanShellText; Write; boundedShellText; readShellRange; restoreShellOutput; completeShellPrefix; completeShellSuffix; snapshot; read
// Impact: python -B scripts/code-atlas.py show Core/shell_output.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"fmt"
	"io"
	"os"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/charmbracelet/x/ansi"
)

// 原始输出只写日志；控制序列不得进入模型文本和主界面的终端控制通道。
func CleanShellText(s string) string {
	s = ansi.Strip(strings.ToValidUTF8(s, "�"))
	s = strings.ReplaceAll(strings.ReplaceAll(s, "\r\n", "\n"), "\r", "\n")
	return strings.Map(func(r rune) rune {
		if r == '\n' || r == '\t' {
			return r
		}
		if unicode.IsControl(r) || unicode.Is(unicode.Cf, r) {
			return -1
		}
		return r
	}, s)
}

func (j *shellJob) Write(p []byte) (int, error) {
	j.mu.Lock()
	defer j.mu.Unlock()
	n := len(p)
	// An explicit private input permanently closes this session's output capture.
	// PTYs and target programs can echo or transform secrets across arbitrary
	// chunks, so string replacement or briefly disabling echo is insufficient.
	if j.result.PrivateOutput {
		return n, nil
	}
	j.result.OutputBytes += int64(n)
	if n > 0 {
		j.displayTailValid = false
	}
	if n >= shellTailLimit {
		j.tail = append(j.tail[:0], p[n-shellTailLimit:]...)
	} else {
		if len(j.tail)+n > shellTailLimit {
			drop := len(j.tail) + n - shellTailLimit
			copy(j.tail, j.tail[drop:])
			j.tail = j.tail[:len(j.tail)-drop]
		}
		j.tail = append(j.tail, p...)
	}
	j.manager.quotaMu.Lock()
	allowed := min(int64(n), shellLogLimit-j.result.LoggedBytes, shellSessionLimit-j.manager.logBytes)
	if allowed > 0 && j.log != nil {
		j.manager.logBytes += allowed
	}
	j.manager.quotaMu.Unlock()
	if allowed > 0 && j.log != nil {
		written, err := j.log.Write(p[:allowed])
		j.result.LoggedBytes += int64(written)
		if int64(written) != allowed {
			j.manager.quotaMu.Lock()
			j.manager.logBytes -= allowed - int64(written)
			j.manager.quotaMu.Unlock()
		}
		if err != nil || written != n {
			j.result.LogIncomplete = true
		}
	} else {
		j.result.LogIncomplete = true
	}
	select {
	case j.changed <- struct{}{}:
	default:
	}
	// 配额与磁盘错误不能阻塞 stdout/stderr，否则子进程会被填满的管道卡住。
	return n, nil
}

func boundedShellText(s string, tokens int) string {
	s = CleanShellText(s)
	// 以非 ASCII 字符一 token、ASCII 三字节一 token 的保守近似预算；不冒充供应商 tokenizer。
	budget := tokens * 3
	if len(s) <= budget {
		return s
	}
	end := budget
	for end > 0 && !utf8.RuneStart(s[end]) {
		end--
	}
	return s[:end]
}

func readShellRange(path string, offset int64, size int) ([]byte, error) {
	st, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if !st.Mode().IsRegular() {
		return nil, fmt.Errorf("shell log is not a regular file")
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	b := make([]byte, size)
	n, err := f.ReadAt(b, offset)
	if err == io.EOF {
		err = nil
	}
	return b[:n], err
}

// Running output may reach the log long before the next metadata commit.
// Recover only saved bytes, with a bounded tail; the final output and process
// outcome remain unknown. Private capture never expands past its saved fence.
func restoreShellOutput(r *ShellResult) ([]byte, int64) {
	r.LogIncomplete = true
	knownOutput := max(r.OutputBytes, r.LoggedBytes)
	st, err := os.Lstat(r.OutputRef)
	if err != nil || !st.Mode().IsRegular() {
		r.LoggedBytes = 0
		return nil, 0
	}
	stored := st.Size()
	f, err := os.Open(r.OutputRef)
	if err != nil {
		r.LoggedBytes = 0
		return nil, stored
	}
	defer f.Close()
	readable := stored
	if r.PrivateOutput {
		readable = min(readable, max(int64(0), r.LoggedBytes))
	}
	r.LoggedBytes = readable
	r.OutputBytes = max(knownOutput, readable)
	length := int(min(readable, int64(shellTailLimit)))
	tail := make([]byte, length)
	n, _ := f.ReadAt(tail, readable-int64(length))
	return completeShellSuffix(tail[:n]), stored
}

func completeShellPrefix(b []byte) []byte {
	if len(b) == 0 {
		return b
	}
	start := len(b) - 1
	for start > 0 && !utf8.RuneStart(b[start]) {
		start--
	}
	if !utf8.FullRune(b[start:]) {
		return b[:start]
	}
	return b
}

func completeShellSuffix(b []byte) []byte {
	for len(b) > 0 && !utf8.RuneStart(b[0]) {
		b = b[1:]
	}
	return b
}

func (j *shellJob) snapshot(tokens int, advance bool) ShellResult {
	j.mu.Lock()
	defer j.mu.Unlock()
	r := j.result
	if r.State == "running" {
		r.DurationMS = timeSinceMS(r.StartedAt)
	}
	r.OutputTokenBudget = tokens
	start := int64(0)
	if advance {
		start = j.cursor
	}
	available := max(int64(0), r.LoggedBytes-start)
	budget := max(1, tokens*3-160)
	var output string
	if available > int64(budget) {
		first := budget / 4
		last := budget - first
		head, e1 := readShellRange(r.OutputRef, start, first)
		tail, e2 := readShellRange(r.OutputRef, r.LoggedBytes-int64(last), last)
		if e1 != nil || e2 != nil {
			r.LogIncomplete = true
		}
		// The summary may omit bytes, but its two retained ranges must end
		// and begin on complete UTF-8 characters. Keep the recovery offsets
		// tied to those actual ranges in the unchanged stdout log.
		head, tail = completeShellPrefix(head), completeShellSuffix(tail)
		output = string(head) + fmt.Sprintf("\n… omitted bytes %d–%d; use read_shell_output(session_id=%d, offset=%d) …\n", start+int64(len(head)), r.LoggedBytes-int64(len(tail)), r.SessionID, start+int64(len(head))) + string(tail)
		r.Truncated = true
	} else if available > 0 {
		b, err := readShellRange(r.OutputRef, start, int(available))
		if err != nil {
			r.LogIncomplete = true
		}
		output = string(b)
	}
	if r.LogIncomplete && r.OutputBytes > r.LoggedBytes && r.OutputBytes > start {
		tail := completeShellSuffix(j.tail[max(0, len(j.tail)-budget/2):])
		output = output + "\n… log storage incomplete; latest captured output …\n" + string(tail)
		r.Truncated = true
	}
	r.Output = boundedShellText(output, tokens)
	r.NextOffset = r.LoggedBytes
	if advance {
		j.cursor = r.OutputBytes
	}
	return r
}

func (m *ShellManager) read(req ShellRead) ShellResult {
	tokens, err := shellTokens(req.MaxOutputTokens)
	if err != nil {
		return shellFailure("invalid_arguments", err.Error())
	}
	j := m.job(req.SessionID)
	if j == nil {
		return shellFailure("session_missing", "session_id 不存在")
	}
	j.mu.Lock()
	r := j.result
	j.mu.Unlock()
	if req.Offset < 0 || req.Offset > r.LoggedBytes {
		return shellFailure("invalid_offset", fmt.Sprintf("offset 应在 0–%d 已保存字节之间", r.LoggedBytes))
	}
	length := int(min(r.LoggedBytes-req.Offset, int64(tokens*3)))
	b, err := readShellRange(r.OutputRef, req.Offset, length)
	if err != nil {
		return shellFailure("log_unavailable", err.Error())
	}
	// 连续分页不能把一个中文字符/字素的 UTF-8 字节拆成两页乱码。
	if len(b) > 0 && req.Offset+int64(len(b)) < r.LoggedBytes {
		start := len(b) - 1
		for start > 0 && !utf8.RuneStart(b[start]) {
			start--
		}
		if !utf8.FullRune(b[start:]) {
			b = b[:start]
		}
		if len(b) == 0 {
			return shellFailure("output_budget_too_small", "当前字节处的字符无法放入输出预算，请提高 max_output_tokens")
		}
	}
	r.Output = boundedShellText(string(b), tokens)
	r.OutputTokenBudget = tokens
	r.NextOffset = req.Offset + int64(len(b))
	r.Truncated = r.NextOffset < r.LoggedBytes || r.LogIncomplete
	return r
}

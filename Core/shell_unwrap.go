// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: unwrapSelfShell; leadingWord; quotedScript; backtickEscape
// Impact: python -B scripts/code-atlas.py show Core/shell_unwrap.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"strconv"
	"strings"

	"github.com/aieyra/aieyra-os/CORE/platform"
)

// 模型常在 PowerShell 里再套一层自己：& 'C:/example/PowerShell/pwsh.exe' -NoProfile -Command "$p='a'; … { '['+$_+']' }"。
// 外层先把双引号里的 $p、$_ 展开成空，内层拿到的脚本已经坏了（AIDEBUG 真实 DeepSeek 任务实测 ParserError）。
// 与当前 Shell 同一种 PowerShell、整条命令就是这一次调用、参数只有 -NoLogo/-NoProfile/-NonInteractive 和 -Command、
// 脚本是一个完整的引号串时，拆掉外壳，在当前 Shell 里直接运行其中的脚本；其他写法原样运行。
func unwrapSelfShell(shell, cmd string) (string, bool) {
	outer := platform.ShellWordName(shell)
	if outer != "pwsh" && outer != "powershell" {
		return "", false
	}
	s := strings.TrimSpace(cmd)
	if strings.HasPrefix(s, "&") {
		s = strings.TrimLeft(s[1:], " \t")
	}
	exe, rest, ok := leadingWord(s)
	if !ok || platform.ShellWordName(exe) != outer {
		return "", false
	}
	for {
		rest = strings.TrimLeft(rest, " \t")
		flag, after, _ := strings.Cut(rest, " ")
		switch strings.ToLower(flag) {
		case "-nologo", "-noprofile", "-nop", "-noninteractive", "-noni":
			rest = after
			continue
		case "-command", "-c":
			script, ok := quotedScript(strings.TrimSpace(after))
			if !ok || strings.ContainsRune(script, 0) {
				return "", false
			}
			return script, true
		}
		return "", false
	}
}

// 命令开头的可执行文件：单引号、双引号或到空白为止。
func leadingWord(s string) (string, string, bool) {
	if s == "" {
		return "", "", false
	}
	if q := s[0]; q == '\'' || q == '"' {
		end := strings.IndexByte(s[1:], q)
		if end < 0 {
			return "", "", false
		}
		return s[1 : end+1], s[end+2:], true
	}
	end := strings.IndexAny(s, " \t")
	if end < 0 {
		return "", "", false
	}
	return s[:end], s[end:], true
}

// 整段必须是一个引号串。单引号串里只认连写两个单引号这一种转义；双引号还原外层本该做的转义（`" "" `$ `n …），
// 但不展开 $变量——那正是模型想交给内层的东西。
func quotedScript(s string) (string, bool) {
	if len(s) < 2 {
		return "", false
	}
	var b strings.Builder
	switch s[0] {
	case '\'':
		for i := 1; i < len(s); i++ {
			if s[i] != '\'' {
				b.WriteByte(s[i])
				continue
			}
			if i+1 < len(s) && s[i+1] == '\'' {
				b.WriteByte('\'')
				i++
				continue
			}
			if i == len(s)-1 && strings.TrimSpace(b.String()) != "" {
				return b.String(), true
			}
			return "", false
		}
	case '"':
		runes := []rune(s)
		for i := 1; i < len(runes); i++ {
			switch r := runes[i]; r {
			case '`':
				if i+1 >= len(runes) {
					return "", false
				}
				i++
				if runes[i] == 'u' && i+1 < len(runes) && runes[i+1] == '{' {
					if end := strings.IndexRune(string(runes[i+2:]), '}'); end > 0 {
						if code, err := strconv.ParseUint(string(runes[i+2:i+2+end]), 16, 32); err == nil {
							b.WriteRune(rune(code))
							i += 2 + end
							continue
						}
					}
				}
				b.WriteRune(backtickEscape(runes[i]))
			case '"':
				if i+1 < len(runes) && runes[i+1] == '"' {
					b.WriteRune('"')
					i++
					continue
				}
				if i == len(runes)-1 && strings.TrimSpace(b.String()) != "" {
					return b.String(), true
				}
				return "", false
			default:
				b.WriteRune(r)
			}
		}
	}
	return "", false
}

func backtickEscape(r rune) rune {
	switch r {
	case '0':
		return 0
	case 'a':
		return '\a'
	case 'b':
		return '\b'
	case 'e':
		return 0x1b
	case 'f':
		return '\f'
	case 'n':
		return '\n'
	case 'r':
		return '\r'
	case 't':
		return '\t'
	case 'v':
		return '\v'
	}
	return r
}

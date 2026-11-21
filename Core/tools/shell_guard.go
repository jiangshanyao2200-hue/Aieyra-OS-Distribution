// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: shellVariable; rawDisk; CatastrophicCommand; CatastrophicCommandWithEnv; inspectCatastrophic; expandShellPath; guardPath; dangerousDeleteTarget; shellStatements
// Impact: python -B scripts/code-atlas.py show Core/tools/shell_guard.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package tools

// 这是明确灾难目标的误操作保护，不是通用脚本沙箱。未识别的正常命令直接放行。
import (
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/aieyra/aieyra-os/CORE/platform"
)

var shellVariable = regexp.MustCompile(`\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$(?:env:)?([A-Za-z_][A-Za-z0-9_]*)|%([A-Za-z_][A-Za-z0-9_]*)%`)
var rawDisk = regexp.MustCompile(`(?i)^(?:/dev/(?:sd[a-z]|hd[a-z]|vd[a-z]|nvme[0-9]+n[0-9]+|r?disk[0-9]+)(?:p?[0-9]+)?|//[.?]/physicaldrive[0-9]+)$`)

func CatastrophicCommand(command, cwd, workspace string) string {
	return inspectCatastrophic(command, cwd, workspace, map[string]string{}, 0)
}

// CatastrophicCommandWithEnv checks the prepared execution environment.
func CatastrophicCommandWithEnv(command, cwd, workspace string, vars map[string]string) string {
	return inspectCatastrophic(command, cwd, workspace, vars, 0)
}

func inspectCatastrophic(command, cwd, workspace string, vars map[string]string, depth int) string {
	if depth > 6 {
		return ""
	}
	compact := strings.Join(strings.Fields(command), "")
	if strings.Contains(compact, ":(){:|:&};:") {
		return "拒绝明确的无限进程自复制命令"
	}
	for _, words := range shellStatements(command) {
		if len(words) == 0 {
			continue
		}
		for len(words) > 0 {
			k, v, ok := strings.Cut(words[0], "=")
			if !ok || strings.HasPrefix(k, "-") || strings.ContainsAny(k, "/\\ ") {
				break
			}
			vars[strings.ToLower(strings.TrimPrefix(k, "$"))] = expandShellPath(v, vars)
			words = words[1:]
		}
		if len(words) == 0 {
			continue
		}
		name := platform.ShellWordName(words[0])
		dry := false
		for _, arg := range words[1:] {
			switch strings.ToLower(arg) {
			case "-whatif", "--help", "/?", "-?":
				dry = true
			}
		}
		if dry {
			continue
		}
		for len(words) > 1 {
			if name == "env" || name == "sudo" || name == "command" || name == "exec" || name == "nohup" || name == "call" || name == "busybox" {
				words = words[1:]
			} else if k, v, ok := strings.Cut(words[0], "="); ok && !strings.ContainsAny(k, "/\\ ") {
				vars[strings.ToLower(strings.TrimPrefix(k, "$"))] = expandShellPath(v, vars)
				words = words[1:]
			} else {
				break
			}
			name = platform.ShellWordName(words[0])
		}
		if (name == "cd" || name == "set-location" || name == "sl" || name == "pushd") && len(words) > 1 {
			target := expandShellPath(words[len(words)-1], vars)
			if !strings.ContainsAny(target, "$%") {
				if !filepath.IsAbs(target) {
					target = filepath.Join(cwd, target)
				}
				cwd = filepath.Clean(target)
			}
			continue
		}
		if name == "wsl" {
			for i, word := range words[1:] {
				if word == "--exec" || word == "-e" || word == "--" {
					if reason := inspectCatastrophic(strings.Join(words[i+2:], " "), cwd, workspace, vars, depth+1); reason != "" {
						return reason
					}
					break
				}
			}
		}
		if name == "bash" || name == "sh" || name == "zsh" || name == "pwsh" || name == "powershell" || name == "cmd" {
			for i, w := range words[1:] {
				if (strings.EqualFold(w, "-c") || strings.EqualFold(w, "-lc") || strings.EqualFold(w, "-command") || strings.EqualFold(w, "/c")) && i+2 < len(words) {
					if reason := inspectCatastrophic(strings.Join(words[i+2:], " "), cwd, workspace, vars, depth+1); reason != "" {
						return reason
					}
				}
			}
		}
		if name == "format-volume" || name == "clear-disk" || name == "initialize-disk" || name == "mkfs" || strings.HasPrefix(name, "mkfs.") {
			return "拒绝格式化或重建磁盘/文件系统的命令"
		}
		if name == "format" && len(words) > 1 && regexp.MustCompile(`(?i)^[a-z]:/?$`).MatchString(strings.ReplaceAll(words[1], "\\", "/")) {
			return "拒绝格式化磁盘分区的命令"
		}
		if name == "diskpart" && strings.Contains(strings.ToLower(command), "clean") {
			return "拒绝清空磁盘分区表的命令"
		}
		if name == "dd" || name == "shred" || name == "wipefs" {
			for _, w := range words[1:] {
				w = expandShellPath(strings.TrimPrefix(w, "of="), vars)
				if rawDisk.MatchString(strings.ReplaceAll(w, "\\", "/")) {
					return "拒绝覆盖原始磁盘或分区设备"
				}
			}
		}
		if name != "rm" && name != "rmdir" && name != "rd" && name != "del" && name != "erase" && name != "remove-item" && name != "ri" {
			continue
		}
		for _, arg := range words[1:] {
			lower := strings.ToLower(arg)
			if strings.HasPrefix(arg, "-") || lower == "/s" || lower == "/q" || lower == "/f" || lower == "/a" {
				continue
			}
			for _, target := range strings.Split(arg, ",") {
				target = expandShellPath(target, vars)
				if strings.ContainsAny(target, "$%") {
					continue
				}
				if dangerousDeleteTarget(target, cwd, workspace) {
					return "拒绝递归/批量删除受保护的大范围目标：" + target
				}
			}
		}
	}
	return ""
}

func expandShellPath(s string, vars map[string]string) string {
	s = strings.Trim(s, "\"'")
	if s == "~" || strings.HasPrefix(s, "~/") || strings.HasPrefix(s, "~\\") {
		if h, e := os.UserHomeDir(); e == nil {
			s = h + s[1:]
		}
	}
	return shellVariable.ReplaceAllStringFunc(s, func(match string) string {
		parts := shellVariable.FindStringSubmatch(match)
		key := ""
		for _, p := range parts[1:] {
			if p != "" {
				key = p
				break
			}
		}
		if v, ok := vars[strings.ToLower(key)]; ok {
			return v
		}
		if v, ok := os.LookupEnv(key); ok {
			return v
		}
		if strings.EqualFold(key, "HOME") || strings.EqualFold(key, "USERPROFILE") {
			h, _ := os.UserHomeDir()
			return h
		}
		return match
	})
}

func guardPath(p, cwd string) string {
	p = strings.ReplaceAll(p, "\\", "/")
	if p == "" {
		return ""
	}
	if !strings.HasPrefix(p, "/") && !(len(p) >= 2 && p[1] == ':') {
		p = strings.ReplaceAll(cwd, "\\", "/") + "/" + p
	}
	return strings.ToLower(strings.TrimSuffix(path.Clean(p), "/"))
}

func dangerousDeleteTarget(target, cwd, workspace string) bool {
	if target == "" {
		return false
	}
	// 只把覆盖整个目录的通配符当作父目录；*.tmp、*/build 这类定向清理不能误拦。
	wild := strings.IndexAny(target, "*?[")
	if wild >= 0 {
		pattern := strings.ReplaceAll(target[wild:], "\\", "/")
		for _, part := range strings.Split(strings.Trim(pattern, "/"), "/") {
			if part != "*" && part != "**" && part != "*.*" {
				return false
			}
		}
		target = target[:wild]
		if target != "" && !strings.HasSuffix(target, "/") && !strings.HasSuffix(target, "\\") {
			return false
		}
	}
	if target == "" {
		target = "."
	}
	native := target
	if !filepath.IsAbs(native) {
		native = filepath.Join(cwd, native)
	}
	if resolved, err := filepath.EvalSymlinks(native); err == nil {
		target = resolved
	}
	p := guardPath(target, cwd)
	if p == "" || p == "." || p == "/" || len(p) == 2 && p[1] == ':' {
		return true
	}
	if regexp.MustCompile(`^/mnt/[a-z]$`).MatchString(p) {
		return true
	}
	h, _ := os.UserHomeDir()
	protected := []string{workspace, h, "/etc", "/usr", "/bin", "/sbin", "/boot", "/var", "/home", "/users", "C:/Windows", "C:/Users", "C:/Program Files", "C:/Program Files (x86)", os.Getenv("SystemRoot"), os.Getenv("USERPROFILE")}
	for _, base := range protected {
		if base == "" {
			continue
		}
		b := guardPath(base, cwd)
		if p == b || strings.HasPrefix(b, p+"/") {
			return true
		}
	}
	return false
}

// 只分割真正位于引号外的命令边界，echo "rm -rf /" 不能被当成删除执行。
func shellStatements(command string) [][]string {
	var out [][]string
	var words []string
	var word strings.Builder
	var quote rune
	flushWord := func() {
		if word.Len() > 0 {
			words = append(words, word.String())
			word.Reset()
		}
	}
	flushStatement := func() {
		flushWord()
		if len(words) > 0 {
			out = append(out, words)
			words = nil
		}
	}
	for _, r := range command {
		if quote != 0 {
			if r == quote {
				quote = 0
			} else {
				word.WriteRune(r)
			}
			continue
		}
		switch r {
		case '\'', '"':
			quote = r
		case ';', '\n', '|', '&':
			flushStatement()
		case ' ', '\t', '\r':
			flushWord()
		default:
			word.WriteRune(r)
		}
	}
	flushStatement()
	return out
}

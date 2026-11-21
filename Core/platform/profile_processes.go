// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/platform/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: profileProcess; ActiveProfileProcesses; splitProfileCommand; matchingProfileProcesses
// Impact: python -B scripts/code-atlas.py show Core/platform/profile_processes.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package platform

import (
	"path/filepath"
	"runtime"
	"strings"
	"unicode"
)

type profileProcess struct {
	PID                 int
	Executable, Command string
}

// ActiveProfileProcesses catches older hosts which predate profile ownership
// records. Only process IDs are returned; command lines never enter receipts.
func ActiveProfileProcesses(app, config, data string) ([]int, error) {
	rows, err := profileProcesses()
	if err != nil {
		return nil, err
	}
	return matchingProfileProcesses(rows, app, config, data), nil
}

// splitProfileCommand extracts option boundaries, preserving spaces inside
// quoted Windows paths. Only an absolute, exact config option proves that an
// installed process chose another profile; ambiguous input stays conservative.
func splitProfileCommand(command string) []string {
	var args []string
	var word strings.Builder
	var quote rune
	for _, r := range command {
		if r == '"' || r == '\'' {
			if quote == 0 {
				quote = r
				continue
			}
			if quote == r {
				quote = 0
				continue
			}
		}
		if quote == 0 && unicode.IsSpace(r) {
			if word.Len() > 0 {
				args = append(args, word.String())
				word.Reset()
			}
			continue
		}
		word.WriteRune(r)
	}
	if quote != 0 {
		return nil
	}
	if word.Len() > 0 {
		args = append(args, word.String())
	}
	return args
}
func matchingProfileProcesses(rows []profileProcess, app, config, data string) []int {
	clean := func(s string) string {
		s = strings.ReplaceAll(s, "\\", "/")
		if runtime.GOOS == "windows" {
			s = strings.ToLower(s)
		}
		return s
	}
	app, config, data = clean(app), clean(config), clean(data)
	defaultConfig := config == clean(filepath.Join(app, "Config", "config.json")) || config == clean(filepath.Join(app, "config.json"))
	var out []int
	for _, p := range rows {
		exe, command := clean(p.Executable), clean(p.Command)
		if strings.Contains(command, config) || strings.Contains(command, data+"/") || strings.Contains(command, "\""+data+"\"") || strings.HasSuffix(command, " "+data) {
			out = append(out, p.PID)
			continue
		}
		alternate := false
		args := splitProfileCommand(p.Command)
		for i, arg := range args {
			value := ""
			if (arg == "-config" || arg == "--config") && i+1 < len(args) {
				value = args[i+1]
			}
			if strings.HasPrefix(arg, "--config=") {
				value = strings.TrimPrefix(arg, "--config=")
			}
			if strings.HasPrefix(arg, "-config=") {
				value = strings.TrimPrefix(arg, "-config=")
			}
			if filepath.IsAbs(value) && clean(filepath.Clean(value)) != config {
				alternate = true
			}
		}
		if defaultConfig && (strings.HasPrefix(exe, app+"/") || strings.Contains(command, app+"/")) && !alternate {
			out = append(out, p.PID)
		}
	}
	return out
}

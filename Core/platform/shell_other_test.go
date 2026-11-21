// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/platform/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestPTYTerminalEnvironment
// Impact: python -B scripts/code-atlas.py show Core/platform/shell_other_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

//go:build !windows

package platform

import (
	"bytes"
	"strings"
	"testing"
)

func TestPTYTerminalEnvironment(t *testing.T) {
	t.Setenv("TERM", "vt100")
	for _, tc := range []struct {
		name string
		env  []string
		want string
	}{
		{"inherited", nil, "vt100"},
		{"explicit", []string{"TERM=screen-256color"}, "screen-256color"},
		{"missing", []string{}, "xterm-256color"},
		{"empty", []string{"TERM="}, "xterm-256color"},
		{"dumb", []string{"TERM=dumb"}, "xterm-256color"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var output bytes.Buffer
			p, err := StartShellProcess(ProcessRequest{
				Shell: "/bin/sh", Args: []string{"-c", "printf '%s' \"$TERM\""},
				Environment: tc.env, TTY: true,
			}, &output)
			if err != nil {
				t.Fatal(err)
			}
			defer p.Close()
			code, err := p.Wait()
			if err != nil || code != 0 {
				t.Fatalf("wait: code=%d err=%v", code, err)
			}
			if got := strings.TrimSpace(output.String()); got != tc.want {
				t.Fatalf("TERM = %q, want %q", got, tc.want)
			}
		})
	}
}

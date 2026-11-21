// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestTerminalStreamVTUTF8AndCredentialBoundaries; recordingTerminalProcess; Write; Wait; Stop; Close; value; TestTerminalSequencedKeysBeyondFormLimitAndNoReplay; TestTerminalNativePTYResizeAndInput
// Impact: python -B scripts/code-atlas.py show Core/workspace_terminal_screen_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
	"unicode/utf8"
)

func TestTerminalStreamVTUTF8AndCredentialBoundaries(t *testing.T) {
	m := shellTestManager(t)
	file := filepath.Join(m.dir, "stream.log")
	f, err := os.Create(file)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	j := &shellJob{manager: m, log: f, changed: make(chan struct{}, 1), cursor: 17, result: ShellResult{OK: true, TTY: true, State: "running", OutputRef: file}}
	write := func(s string) {
		t.Helper()
		if _, err := j.Write([]byte(s)); err != nil {
			t.Fatal(err)
		}
	}
	write("\x1b[2J\x1b[H中文\r覆写")
	r := j.terminalRead(0)
	if r.TerminalOutput != "\x1b[2J\x1b[H中文\r覆写" || j.cursor != 17 {
		t.Fatal("VT stream or model cursor changed", r)
	}
	start := r.NextOffset
	write(string([]byte("字")[:2]))
	if r = j.terminalRead(start); r.TerminalOutput != "" || r.NextOffset != start {
		t.Fatal("partial UTF-8 escaped", r)
	}
	write(string([]byte("字")[2:]))
	if r = j.terminalRead(start); r.TerminalOutput != "字" || !utf8.ValidString(r.TerminalOutput) {
		t.Fatal(r)
	}
	start = r.NextOffset
	secret := "synthetic-credential-abcdefgh"
	write("prompt:" + secret[:12])
	r = j.terminalRead(start, secret)
	if r.TerminalOutput != "prompt:" {
		t.Fatal("live credential prefix escaped", r)
	}
	write(secret[12:] + "!")
	r = j.terminalRead(r.NextOffset, secret)
	if r.TerminalOutput != strings.Repeat("*", len(secret))+"!" {
		t.Fatal("split credential escaped", r)
	}
	if r = j.terminalRead(r.NextOffset-10, secret); r.TerminalOutput != strings.Repeat("*", 9)+"!" {
		t.Fatal("mid-secret cursor escaped", r)
	}
	start = r.NextOffset
	write(strings.Repeat("z", 32760) + secret + "尾")
	r = j.terminalRead(start, secret)
	next := j.terminalRead(r.NextOffset, secret)
	if got := r.TerminalOutput + next.TerminalOutput; got != strings.Repeat("z", 32760)+strings.Repeat("*", len(secret))+"尾" {
		t.Fatal("page-boundary redaction failed")
	}
	start = next.NextOffset
	write(secret[:7])
	j.result.State = "exited"
	if r = j.terminalRead(start, secret); r.TerminalOutput != "*******" || r.NextOffset != j.result.LoggedBytes {
		t.Fatal("ended prefix or cursor incorrect", r)
	}
}

type recordingTerminalProcess struct {
	mu   sync.Mutex
	text strings.Builder
	fail bool
}

func (p *recordingTerminalProcess) Write(b []byte) (int, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.text.Write(b)
	if p.fail {
		return 0, fmt.Errorf("synthetic write failure")
	}
	return len(b), nil
}
func (p *recordingTerminalProcess) Wait() (int, error) { return 0, nil }
func (p *recordingTerminalProcess) Stop() error        { return nil }
func (p *recordingTerminalProcess) Close()             {}
func (p *recordingTerminalProcess) value() string {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.text.String()
}

func TestTerminalSequencedKeysBeyondFormLimitAndNoReplay(t *testing.T) {
	m := shellTestManager(t)
	p := &recordingTerminalProcess{}
	j := &shellJob{manager: m, process: p, result: ShellResult{OK: true, TTY: true, SessionID: 777, Generation: 1, State: "running"}}
	var request workspaceTerminalRequest
	for i := 1; i <= 135; i++ {
		request = workspaceTerminalRequest{RequestID: fmt.Sprint("key-", i), Chars: "x", InputClient: "synthetic-terminal-client", InputSequence: i}
		if r := j.userInput(context.Background(), request); r.InputState != "pending" {
			t.Fatal(i, r)
		}
		if r := waitTerminalInput(t, j); r.InputState != "written" {
			t.Fatal(i, r)
		}
	}
	if r := j.userInput(context.Background(), request); r.InputState != "written" {
		t.Fatal(r)
	}
	request.InputSequence = 134
	if r := j.userInput(context.Background(), request); r.Error == nil || r.Error.Code != "already_submitted" {
		t.Fatal(r)
	}
	request.InputSequence = 137
	request.RequestID = "skipped"
	if r := j.userInput(context.Background(), request); r.Error == nil || r.Error.Code != "input_sequence_changed" {
		t.Fatal(r)
	}
	if p.value() != strings.Repeat("x", 135) {
		t.Fatal("duplicate or skipped key was sent")
	}
	p.mu.Lock()
	p.fail = true
	p.mu.Unlock()
	request.InputSequence = 136
	request.RequestID = "failed"
	j.userInput(context.Background(), request)
	if r := waitTerminalInput(t, j); r.InputState != "failed" {
		t.Fatal(r)
	}
	if r := j.userInput(context.Background(), request); r.InputState != "failed" {
		t.Fatal(r)
	}
	if p.value() != strings.Repeat("x", 136) {
		t.Fatal("failed key was retried")
	}
}

func TestTerminalNativePTYResizeAndInput(t *testing.T) {
	m := shellTestManager(t)
	command := shellTestCommand(t, "terminal_size")
	zero := 0
	command.TTY = true
	command.YieldTimeMS = &zero
	r := m.start(context.Background(), command)
	if !r.OK || r.State != "running" {
		t.Fatal(r)
	}
	j := m.job(r.SessionID)
	if r = j.resize(83, 19); !r.OK || r.Columns != 83 || r.Rows != 19 {
		t.Fatal(r)
	}
	if r = j.resize(0, 19); r.Error == nil || r.Error.Code != "invalid_size" {
		t.Fatal(r)
	}
	j.userInput(context.Background(), workspaceTerminalRequest{RequestID: "resized-input", Chars: "after-resize", PressEnter: true})
	if r = waitTerminalInput(t, j); r.InputState != "written" {
		t.Fatal(r)
	}
	deadline := time.Now().Add(5 * time.Second)
	for {
		r = j.terminalRead(0)
		if strings.Contains(CleanShellText(r.TerminalOutput), "SIZE=83x19 ERROR=<nil>") {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("resized PTY did not accept input", r)
		}
		time.Sleep(10 * time.Millisecond)
	}
	j.stop("cancelled")
	awaitTerminalExit(t, j)
	if r = j.resize(90, 20); r.Error == nil || r.Error.Code != "not_running_pty" {
		t.Fatal(r)
	}
}

// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/platform/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: DefaultShell; DesktopDirectory; nativeShellProcess; StartShellProcess; Write; Stop; Wait; Close; Resize
// Impact: python -B scripts/code-atlas.py show Core/platform/shell_other.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

//go:build !windows

package platform

import (
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/creack/pty"
)

func DefaultShell() (string, error) {
	for _, name := range []string{"bash", "sh"} {
		if p, e := exec.LookPath(name); e == nil {
			return p, nil
		}
	}
	return "", fmt.Errorf("未找到 bash 或 sh")
}

func DesktopDirectory() string { return "" }

type nativeShellProcess struct {
	cmd      *exec.Cmd
	input    io.WriteCloser
	output   io.ReadCloser
	drained  chan struct{}
	once     sync.Once
	terminal *os.File
}

func StartShellProcess(req ProcessRequest, output io.Writer) (Process, error) {
	cmd := exec.Command(req.Shell, req.Args...)
	cmd.Dir = req.Workdir
	cmd.Env = req.Environment
	if req.TTY {
		// Preserve an explicit terminal choice. GUI hosts with no usable TERM
		// default to the capabilities provided by the terminal renderer.
		environment := cmd.Env
		if environment == nil {
			environment = os.Environ()
		}
		term := ""
		for _, value := range environment {
			if strings.HasPrefix(value, "TERM=") {
				term = strings.TrimPrefix(value, "TERM=")
			}
		}
		if term == "" || term == "dumb" {
			cmd.Env = make([]string, 0, len(environment)+1)
			for _, value := range environment {
				if !strings.HasPrefix(value, "TERM=") {
					cmd.Env = append(cmd.Env, value)
				}
			}
			cmd.Env = append(cmd.Env, "TERM=xterm-256color")
		}
		terminal, err := pty.StartWithSize(cmd, &pty.Winsize{Cols: 120, Rows: 30})
		if err != nil {
			return nil, err
		}
		p := &nativeShellProcess{cmd: cmd, input: terminal, output: terminal, terminal: terminal, drained: make(chan struct{})}
		go func() { io.Copy(output, terminal); close(p.drained) }()
		return p, nil
	}
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	in, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	r, w, err := os.Pipe()
	if err != nil {
		in.Close()
		return nil, err
	}
	cmd.Stdout = w
	cmd.Stderr = w
	if err = cmd.Start(); err != nil {
		in.Close()
		r.Close()
		w.Close()
		return nil, err
	}
	w.Close()
	p := &nativeShellProcess{cmd: cmd, input: in, output: r, drained: make(chan struct{})}
	go func() { io.Copy(output, r); close(p.drained) }()
	return p, nil
}
func (p *nativeShellProcess) Write(b []byte) (int, error) { return p.input.Write(b) }
func (p *nativeShellProcess) Stop() error                 { return syscall.Kill(-p.cmd.Process.Pid, syscall.SIGKILL) }
func (p *nativeShellProcess) Wait() (int, error) {
	err := p.cmd.Wait()
	_ = p.Stop()
	select {
	case <-p.drained:
	case <-time.After(2 * time.Second):
		p.output.Close()
		<-p.drained
	}
	var exit *exec.ExitError
	if errors.As(err, &exit) {
		err = nil
	}
	return p.cmd.ProcessState.ExitCode(), err
}
func (p *nativeShellProcess) Close() { p.once.Do(func() { p.input.Close(); p.output.Close() }) }

func (p *nativeShellProcess) Resize(columns, rows int) error {
	if p.terminal == nil {
		return fmt.Errorf("process has no PTY")
	}
	return pty.Setsize(p.terminal, &pty.Winsize{Cols: uint16(columns), Rows: uint16(rows)})
}

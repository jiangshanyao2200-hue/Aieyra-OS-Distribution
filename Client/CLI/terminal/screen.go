// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/CLI/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: screen; Run; Dump; newProgram; write; Init; View; Update; pollSize; close
// Impact: python -B scripts/code-atlas.py show Client/CLI/terminal/screen.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package terminal

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"time"

	"github.com/aieyra/aieyra-os/contracts/protocol"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/x/ansi"
	"github.com/charmbracelet/x/term"
)

// Main-buffer rows are erased individually; ED2 can archive a duplicate frame.

type screen struct {
	model                       *model
	out                         io.Writer
	in                          io.Reader
	last                        string
	width, height               int
	lastRows                    []string
	pending, reset, closed      bool
	err                         error
	terminal                    *os.File
	restoreInput, restoreOutput func()
	inputDriver                 terminalInput
	drawnAt                     time.Time
	caretBelow                  int
	caretRight                  int
	liveTop                     int
	started                     bool
	liveRows                    []flowRow
}

// Run leaves scripts untouched. Only an interactive terminal gets the rich UI;
// TERM=dumb and --plain remain usable in basic shells and automation.
func Run(ctx context.Context, opts protocol.TerminalOptions) (bool, error) {
	in, inOK := opts.Input.(*os.File)
	out, outOK := opts.Output.(*os.File)
	if !inOK || !outOK || !term.IsTerminal(in.Fd()) || !term.IsTerminal(out.Fd()) || os.Getenv("TERM") == "dumb" {
		return false, nil
	}
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	m := newModel(ctx, opts)
	p, s := newProgram(m, opts.Input, opts.Output, tea.WithContext(ctx))
	defer s.close()
	_, err := p.Run()
	closeErr := s.close()
	if errors.Is(err, tea.ErrProgramKilled) && ctx.Err() != nil {
		err = nil
	}
	if err != nil {
		return true, err
	}
	return true, closeErr
}

// Dump renders the current terminal layout without starting a core or reading history.
func Dump(out io.Writer, version, modelName string, width, height int) {
	m := newModel(context.Background(), protocol.TerminalOptions{Version: version})
	m.width, m.height = max(1, min(2000, width)), max(1, min(1000, height))
	m.snapshot.Model = modelName
	m.layout()
	fmt.Fprintln(out, ansi.Strip(m.View()))
}
func newProgram(m *model, in io.Reader, out io.Writer, options ...tea.ProgramOption) (*tea.Program, *screen) {
	s := &screen{model: m, in: in, out: out}
	m.screen = s
	options = append(options, tea.WithoutRenderer(), tea.WithInput(programInput(in)), tea.WithOutput(out), tea.WithFilter(func(_ tea.Model, msg tea.Msg) tea.Msg {
		if _, ok := msg.(tea.QuitMsg); ok {
			s.close()
		}
		return msg
	}))
	return tea.NewProgram(s, options...), s
}
func (s *screen) write(text string) {
	if s.err == nil {
		_, s.err = io.WriteString(s.out, text)
	}
}
func (s *screen) Init() tea.Cmd {
	if out, ok := s.out.(*os.File); ok && term.IsTerminal(out.Fd()) {
		s.terminal = out
		if in, ok := s.in.(*os.File); ok && term.IsTerminal(in.Fd()) {
			state, err := term.MakeRaw(in.Fd())
			if err != nil {
				s.err = err
				return tea.Quit
			}
			s.restoreInput = func() { _ = term.Restore(in.Fd(), state) }
		}
		restore, err := enableScreenOutput(out)
		if err != nil {
			s.err = err
			return tea.Quit
		}
		s.restoreOutput = restore
		s.pollSize()
	}
	driver, err := newTerminalInput(s.in)
	if err != nil {
		s.err = err
		return tea.Quit
	}
	s.inputDriver = driver
	s.start()
	s.draw()
	if driver != nil {
		return tea.Batch(s.model.Init(), driver.read)
	}
	return s.model.Init()
}
func (s *screen) View() string { return "" }
func (s *screen) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	if batch, ok := msg.(terminalInputMsg); ok {
		if batch.err != nil {
			s.err = batch.err
			return s, tea.Quit
		}
		var cmds []tea.Cmd
		for _, event := range batch.events {
			_, cmd := s.Update(event)
			cmds = append(cmds, cmd)
		}
		cmds = append(cmds, s.inputDriver.read)
		return s, tea.Batch(cmds...)
	}
	if _, ok := msg.(pulseMsg); ok {
		s.pollSize()
	}
	if size, ok := msg.(tea.WindowSizeMsg); ok && s.terminal != nil {
		size.Width, size.Height = viewportSize(size.Width, size.Height)
		msg = size
	}
	_, cmd := s.model.Update(msg)
	if key, ok := msg.(tea.KeyMsg); ok && key.Type == tea.KeyCtrlEnd {
		s.returnToLive()
	}
	s.draw()
	if s.err != nil {
		return s, tea.Quit
	}
	return s, cmd
}
func (s *screen) pollSize() {
	if s.terminal == nil {
		return
	}
	w, h, err := term.GetSize(s.terminal.Fd())
	if err == nil && w > 0 && h > 0 {
		w, h = viewportSize(w, h)
		if w != s.model.width || h != s.model.height {
			s.model.Update(tea.WindowSizeMsg{Width: w, Height: h})
		}
	}
}
func (s *screen) close() error {
	if s.closed {
		return s.err
	}
	s.closed = true
	s.model.resetReceipt()
	if s.inputDriver != nil {
		s.inputDriver.close()
	}
	// Always restore modes, including failed writes and context cancellation.
	if s.model.api != nil && s.model.api.cancel != nil {
		s.model.api.cancel()
	}
	s.finishHistory()
	finish := ansi.ResetStyle + "\x1b[?7h\x1b[?2026l\x1b[?2004l" + ansi.ShowCursor
	_, err := io.WriteString(s.out, finish)
	if s.restoreInput != nil {
		s.restoreInput()
	}
	if s.restoreOutput != nil {
		s.restoreOutput()
	}
	if s.err != nil {
		return fmt.Errorf("终端读写失败: %w", s.err)
	}
	return err
}

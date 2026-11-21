// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/CLI/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: programInput; windowsInput; vtInputReader; newTerminalInput; read; close; terminalKeyTypes; terminalKey
// Impact: python -B scripts/code-atlas.py show Client/CLI/terminal/input_windows.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

//go:build windows

package terminal

import (
	"context"
	"io"
	"os"
	"sync"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	input "github.com/charmbracelet/ultraviolet"
	"github.com/charmbracelet/x/term"
	"github.com/muesli/cancelreader"
	"golang.org/x/sys/windows"
)

// Bubble Tea 1's native reader discards VT paste boundaries and reads UTF-16
// halves as separate runes. Keep its proven model/textarea and use the newer
// upstream event decoder for Windows consoles only.
func programInput(in io.Reader) io.Reader {
	if f, ok := in.(*os.File); ok && f.Fd() == os.Stdin.Fd() && term.IsTerminal(f.Fd()) {
		return nil
	}
	return in
}

type windowsInput struct {
	reader cancelreader.CancelReader
	events chan input.Event
	done   chan struct{}
	err    error
	cancel context.CancelFunc
	once   sync.Once
}

// Go's console Read uses ReadConsoleW and decodes UTF-16 without code pages.
// Hide the upstream record reader so VT combining characters remain intact.
type vtInputReader struct{ io.Reader }

func newTerminalInput(in io.Reader) (terminalInput, error) {
	if programInput(in) != nil {
		return nil, nil
	}
	r, err := input.NewCancelReader(in)
	if err != nil {
		return nil, err
	}
	// Native text selection stays available; no mouse event capture.
	f := in.(*os.File)
	var mode uint32
	if windows.GetConsoleMode(windows.Handle(f.Fd()), &mode) == nil {
		_ = windows.SetConsoleMode(windows.Handle(f.Fd()), mode|windows.ENABLE_QUICK_EDIT_MODE|windows.ENABLE_VIRTUAL_TERMINAL_INPUT)
	}
	ctx, cancel := context.WithCancel(context.Background())
	d := &windowsInput{reader: r, events: make(chan input.Event, 256), done: make(chan struct{}), cancel: cancel}
	decoder := input.NewTerminalReader(vtInputReader{in}, os.Getenv("TERM"))
	go func() {
		d.err = decoder.StreamEvents(ctx, d.events)
		close(d.events)
		close(d.done)
	}()
	return d, nil
}

func (d *windowsInput) read() tea.Msg {
	for event := range d.events {
		switch e := event.(type) {
		case input.PasteEvent:
			return terminalInputMsg{events: []tea.Msg{tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune(e.Content), Paste: true}}}
		case input.KeyPressEvent:
			if msg, ok := terminalKey(input.Key(e)); ok {
				return terminalInputMsg{events: []tea.Msg{msg}}
			}
		case input.WindowSizeEvent:
			return terminalInputMsg{events: []tea.Msg{tea.WindowSizeMsg{Width: e.Width, Height: e.Height}}}
		}
	}
	if d.err != nil {
		return terminalInputMsg{err: d.err}
	}
	return tea.Quit()
}

func (d *windowsInput) close() {
	d.once.Do(func() {
		d.cancel()
		d.reader.Cancel()
		// The upstream parser flushes events when canceled. Drain them so its
		// shutdown cannot wait for a UI loop which has already quit.
		tick := time.NewTicker(10 * time.Millisecond)
		defer tick.Stop()
		waiting := true
		for waiting {
			select {
			case <-d.events:
			case <-tick.C:
				// Cover cancellation just before ReadConsoleW enters its wait.
				d.reader.Cancel()
			case <-d.done:
				waiting = false
			}
		}
		_ = d.reader.Close()
	})
}

var terminalKeyTypes = func() map[string]tea.KeyType {
	m := map[string]tea.KeyType{}
	for k := tea.KeyF20; k <= tea.KeyRunes; k++ {
		m[k.String()] = k
	}
	for k := tea.KeyType(0); k <= tea.KeyType(127); k++ {
		if s := k.String(); s != "" {
			m[s] = k
		}
	}
	return m
}()

func terminalKey(k input.Key) (tea.KeyMsg, bool) {
	alt := k.Mod&input.ModAlt != 0
	if k.Code > 0 && k.Code < 32 && k.Mod&^input.ModAlt == 0 {
		return tea.KeyMsg{Type: tea.KeyType(k.Code), Alt: alt}, true
	}
	if k.Text != "" {
		return tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune(k.Text)}, true
	}
	k.Mod &^= input.ModAlt | input.ModCapsLock | input.ModNumLock | input.ModScrollLock
	if typ, ok := terminalKeyTypes[k.String()]; ok {
		return tea.KeyMsg{Type: typ, Alt: alt}, true
	}
	if k.Code >= 32 && k.Code < input.KeyExtended && k.Mod == 0 {
		return tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{k.Code}, Alt: alt}, true
	}
	return tea.KeyMsg{}, false
}

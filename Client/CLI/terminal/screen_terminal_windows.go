// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/CLI/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: enableScreenOutput; nativeBrowsing; rememberLiveTop; returnToLive
// Impact: python -B scripts/code-atlas.py show Client/CLI/terminal/screen_terminal_windows.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Presentation extracted from the original Core/ui; no legacy executor.
//go:build windows

package terminal

import (
	"golang.org/x/sys/windows"
	"os"
	"unsafe"
)

func enableScreenOutput(out *os.File) (func(), error) {
	h := windows.Handle(out.Fd())
	var mode uint32
	if err := windows.GetConsoleMode(h, &mode); err != nil {
		return nil, err
	}
	// The classic host can ignore DECAWM for bottom-right writes. Every row is
	// already cell-wrapped, so disable its implicit wrap as well as VT DECAWM.
	if err := windows.SetConsoleMode(h, (mode|windows.ENABLE_VIRTUAL_TERMINAL_PROCESSING)&^windows.ENABLE_WRAP_AT_EOL_OUTPUT); err != nil {
		return nil, err
	}
	return func() { windows.SetConsoleMode(h, mode) }, nil
}

// Classic-console scrolling moves the viewport itself. Pause painting above
// the live area so cursor addressing cannot overwrite historical output.
func (s *screen) nativeBrowsing() bool {
	if s.terminal == nil || !s.started {
		return false
	}
	var info windows.ConsoleScreenBufferInfo
	if windows.GetConsoleScreenBufferInfo(windows.Handle(s.terminal.Fd()), &info) != nil {
		return false
	}
	return int(info.Window.Top) < s.liveTop
}
func (s *screen) rememberLiveTop() {
	if s.terminal == nil {
		return
	}
	var info windows.ConsoleScreenBufferInfo
	if windows.GetConsoleScreenBufferInfo(windows.Handle(s.terminal.Fd()), &info) == nil {
		s.liveTop = int(info.Window.Top)
	}
}
func (s *screen) returnToLive() {
	if s.terminal == nil || !s.started {
		return
	}
	var info windows.ConsoleScreenBufferInfo
	h := windows.Handle(s.terminal.Fd())
	if windows.GetConsoleScreenBufferInfo(h, &info) != nil {
		return
	}
	rect := info.Window
	height := rect.Bottom - rect.Top
	rect.Top = int16(min(s.liveTop, int(info.Size.Y)-int(height)-1))
	rect.Bottom = rect.Top + height
	windows.NewLazySystemDLL("kernel32.dll").NewProc("SetConsoleWindowInfo").Call(uintptr(h), 1, uintptr(unsafe.Pointer(&rect)))
	s.last = ""
	s.reset = true
}

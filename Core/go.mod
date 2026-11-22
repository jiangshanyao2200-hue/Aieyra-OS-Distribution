module github.com/aieyra/aieyra-os/CORE

require github.com/aieyra/aieyra-os/halo v0.0.0
require github.com/aieyra/aieyra-os/internal-link v0.0.0

replace github.com/aieyra/aieyra-os/halo => ../Halo
replace github.com/aieyra/aieyra-os/internal-link => ../InternalLink

go 1.26.8

require (
	github.com/charmbracelet/bubbles v1.0.0 // indirect
	github.com/charmbracelet/bubbletea v1.3.10 // indirect
	github.com/charmbracelet/lipgloss v1.1.0 // indirect
	github.com/charmbracelet/x/ansi v0.11.8
	github.com/rivo/uniseg v0.4.7 // indirect
)

require (
	github.com/charmbracelet/ultraviolet v0.0.0-20260929091141-666ce5eec9fc // indirect
	modernc.org/sqlite v1.44.3
)

require (
	github.com/charmbracelet/x/termios v0.1.1 // indirect
	github.com/charmbracelet/x/windows v0.2.2 // indirect
	github.com/dustin/go-humanize v1.0.1 // indirect
	github.com/google/uuid v1.6.0 // indirect
	github.com/klauspost/compress v1.18.7
	github.com/ncruces/go-strftime v1.0.0 // indirect
	github.com/remyoudompheng/bigfft v0.0.0-20230129092748-24d4a6f8daec // indirect
	golang.org/x/exp v0.0.0-20251023183803-a4bb9ffd2546 // indirect
	golang.org/x/image v0.47.0 // indirect
	golang.org/x/sync v0.24.0 // indirect
	modernc.org/libc v1.67.6 // indirect
	modernc.org/mathutil v1.7.1 // indirect
	modernc.org/memory v1.11.0 // indirect
)

require (
	github.com/atotto/clipboard v0.1.4 // indirect
	github.com/aymanbagabas/go-osc52/v2 v2.0.1 // indirect
	github.com/charmbracelet/colorprofile v0.4.3 // indirect
	github.com/charmbracelet/x/cellbuf v0.0.15 // indirect
	github.com/charmbracelet/x/term v0.2.2
	github.com/clipperhouse/displaywidth v0.11.0 // indirect
	github.com/clipperhouse/uax29/v2 v2.7.0 // indirect
	github.com/creack/pty v1.1.24
	github.com/erikgeiser/coninput v0.0.0-20211004153227-1c3628e74d0f // indirect
	github.com/lucasb-eyer/go-colorful v1.4.1 // indirect
	github.com/mattn/go-isatty v0.0.20 // indirect
	github.com/mattn/go-localereader v0.0.1 // indirect
	github.com/mattn/go-runewidth v0.0.30 // indirect
	github.com/muesli/ansi v0.0.0-20230316100256-276c6243b2f6 // indirect
	github.com/muesli/cancelreader v0.2.2 // indirect
	github.com/muesli/termenv v0.16.0 // indirect
	github.com/xo/terminfo v1.0.0 // indirect
	golang.org/x/sys v0.49.0
	golang.org/x/text v0.43.0 // indirect
)

require github.com/aieyra/aieyra-os/program v0.0.0

replace github.com/aieyra/aieyra-os/program => ../Program

require github.com/aieyra/aieyra-os/contracts v0.0.0

replace github.com/aieyra/aieyra-os/contracts => ../Contracts

require github.com/aieyra/aieyra-os/theme v0.0.0

replace github.com/aieyra/aieyra-os/theme => ../Theme

require github.com/aieyra/aieyra-os/api v0.0.0

replace github.com/aieyra/aieyra-os/api => ../API

require github.com/aieyra/aieyra-os/client v0.0.0

replace github.com/aieyra/aieyra-os/client => ../Client

require github.com/aieyra/aieyra-os/tool v0.0.0

replace github.com/aieyra/aieyra-os/tool => ../Tool

require github.com/aieyra/aieyra-os/agent v0.0.0

replace github.com/aieyra/aieyra-os/agent => ../Agent

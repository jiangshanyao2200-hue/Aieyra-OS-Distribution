// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/CLI/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: viewportSize; consoleWindowSize
// Impact: python -B scripts/code-atlas.py show Client/CLI/terminal/winsize_windows.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Presentation extracted from the original Core/ui; no legacy executor.
//go:build windows

package terminal

import (
	"golang.org/x/sys/windows"
)

// viewportSize 把 WindowSizeMsg 的尺寸换算成真正的可视窗口尺寸。
//
// 为什么需要：Windows 下 bubbletea 从 Console API 的
// WINDOW_BUFFER_SIZE_EVENT 取尺寸，那是屏幕**缓冲区**的尺寸（dwSize），
// 不是可视窗口。conhost 的缓冲区动辄几百上千行，直接拿来布局的话，
// 锚点会被送到几千行之外的虚空里——界面当场混乱且永不自愈。
// Windows Terminal 里两者一致，走这里只是多一次确认，不改变行为。
//
// 拿不到控制台时（管道/重定向/测试）回退到消息自带的值。
// 最后再过一道 sanity clamp：再大的可视窗口也有物理上限，
// 超出的一定是误报，钳住比让锚点飞出去好。
func viewportSize(msgW, msgH int) (int, int) {
	w, h := msgW, msgH
	if cw, ch, ok := consoleWindowSize(); ok {
		w, h = cw, ch
	}
	if w < 1 {
		w = 1
	}
	if w > 2000 {
		w = 2000
	}
	if h < 1 {
		h = 1
	}
	if h > 1000 {
		h = 1000
	}
	return w, h
}

// consoleWindowSize 读控制台可视窗口（srWindow），不是缓冲区。
func consoleWindowSize() (int, int, bool) {
	h, err := windows.GetStdHandle(windows.STD_OUTPUT_HANDLE)
	if err != nil {
		return 0, 0, false
	}
	var info windows.ConsoleScreenBufferInfo
	if err := windows.GetConsoleScreenBufferInfo(h, &info); err != nil {
		return 0, 0, false
	}
	w := int(info.Window.Right-info.Window.Left) + 1
	ht := int(info.Window.Bottom-info.Window.Top) + 1
	if w < 1 || ht < 1 {
		return 0, 0, false
	}
	return w, ht, true
}

// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/CLI/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: TestWindowsNativeScrollback; TestNativeScrollHelper
// Impact: python -B scripts/code-atlas.py show Client/CLI/terminal/screen_scroll_windows_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

//go:build windows

package terminal

// 原生滚动条测试使用隐藏的独占子控制台，不读写用户控制台。
import (
	"context"
	"fmt"
	"github.com/aieyra/aieyra-os/contracts/protocol"
	"golang.org/x/sys/windows"
	"io"
	"os"
	"os/exec"
	"strings"
	"syscall"
	"testing"
	"unsafe"
)

func TestWindowsNativeScrollback(t *testing.T) {
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(exe, "-test.run=^TestNativeScrollHelper$", "-test.v")
	cmd.Env = append(os.Environ(), "AIEYRA_PRIVATE_CONSOLE_TEST=1")
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: windows.CREATE_NEW_CONSOLE, HideWindow: true}
	if data, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("独占控制台测试失败：%v\n%s", err, data)
	} else {
		t.Log(strings.TrimSpace(string(data)))
	}
}

func TestNativeScrollHelper(t *testing.T) {
	if os.Getenv("AIEYRA_PRIVATE_CONSOLE_TEST") != "1" {
		t.Skip("仅由隐藏的独占测试控制台运行")
	}
	kernel := windows.NewLazySystemDLL("kernel32.dll")
	call := func(name string, args ...uintptr) uintptr {
		t.Helper()
		result, _, err := kernel.NewProc(name).Call(args...)
		if result == 0 || result == ^uintptr(0) {
			t.Fatalf("%s: %v", name, err)
		}
		return result
	}
	h := windows.Handle(call("CreateConsoleScreenBuffer", windows.GENERIC_READ|windows.GENERIC_WRITE, windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE, 0, 1, 0))
	out := os.NewFile(uintptr(h), "private-test-console")
	defer out.Close()
	setWindow := func(rect windows.SmallRect) {
		t.Helper()
		ok, _, err := kernel.NewProc("SetConsoleWindowInfo").Call(uintptr(h), 1, uintptr(unsafe.Pointer(&rect)))
		if ok == 0 {
			t.Fatal(err)
		}
	}
	rect := windows.SmallRect{Right: 9, Bottom: 9}
	setWindow(rect)
	call("SetConsoleScreenBufferSize", uintptr(h), uintptr(uint32(80)|uint32(400)<<16))
	rect = windows.SmallRect{Right: 79, Bottom: 23}
	setWindow(rect)
	call("SetConsoleOutputCP", 65001)
	restore, err := enableScreenOutput(out)
	if err != nil {
		t.Fatal(err)
	}
	defer restore()
	info := func() windows.ConsoleScreenBufferInfo {
		t.Helper()
		var n windows.ConsoleScreenBufferInfo
		if err := windows.GetConsoleScreenBufferInfo(h, &n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	read := func() string {
		t.Helper()
		n := info()
		buf := make([]uint16, int(n.Size.X)*int(n.Size.Y))
		var count uint32
		// 指针必须在 syscall 调用表达式内转换；经 uintptr 包装器转发会失去
		// Go 对栈移动/对象存活的保护，重复采样时偶发读到错误的 count。
		ok, _, err := kernel.NewProc("ReadConsoleOutputCharacterW").Call(uintptr(h), uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf)), 0, uintptr(unsafe.Pointer(&count)))
		if ok == 0 {
			t.Fatal(err)
		}
		return windows.UTF16ToString(buf[:count])
	}
	io.WriteString(out, "SHELL-BEFORE\r\n")
	c := newModel(context.Background(), protocol.TerminalOptions{})
	c.width, c.height = 80, 24
	c.layout()
	c.taskStarted = true
	s := &screen{model: c, out: out, terminal: out}
	c.screen = s
	c.beginDisplay("NATIVE_USER")
	c.liveID = "long"
	for i := 0; i < 120; i++ {
		c.liveText += fmt.Sprintf("LIVE%03d 原生完整正文\n", i)
	}
	c.shownText = c.liveText
	s.draw()
	if s.err != nil {
		t.Fatal(s.err)
	}
	contents := read()
	t.Logf("native main buffer size=%+v viewport=%+v", info().Size, info().Window)
	for _, token := range []string{"SHELL-BEFORE", "NATIVE_USER", "LIVE000", "LIVE060", "LIVE119"} {
		if strings.Count(contents, token) != 1 {
			t.Fatalf("native history lost/duplicated %s", token)
		}
	}
	if n := info(); n.Window.Top < 60 || n.Size.Y <= n.Window.Bottom-n.Window.Top+1 {
		t.Fatalf("no native scrollbar range: %+v", n)
	}
	c.snapshot.Busy = true
	for i := 0; i < 160; i++ {
		c.frame = i
		c.notice = fmt.Sprintf("ANIM%03d", i)
		s.draw()
	}
	contents = read()
	if strings.Count(contents, "ANIM") != 1 || strings.Count(contents, "LIVE000") != 1 || strings.Count(contents, "LIVE119") != 1 {
		t.Fatal("native animation polluted history")
	}
	// Move the real console viewport to historical output, as its scrollbar does.
	browse := info().Window
	browse.Top = 0
	browse.Bottom = 23
	setWindow(browse)
	before := read()
	c.notice = "MUST_NOT_OVERWRITE_HISTORY"
	s.draw()
	if !s.nativeBrowsing() || read() != before || info().Window.Top != 0 {
		t.Fatal("native scrolling overwrote history or forced the live tail")
	}
	s.returnToLive()
	s.draw()
	if s.nativeBrowsing() || !strings.Contains(read(), "MUST_NOT_OVERWRITE_HISTORY") {
		t.Fatal("return to native live tail failed")
	}
	c.snapshot.Busy = false
	if err := s.close(); err != nil {
		t.Fatal(err)
	}
	contents = read()
	if !strings.Contains(contents, "SHELL-BEFORE") || strings.Contains(contents, "MUST_NOT_OVERWRITE_HISTORY") {
		t.Fatal("exit lost shell or retained footer")
	}
	for i := 0; i < 120; i++ {
		token := fmt.Sprintf("LIVE%03d", i)
		if strings.Count(contents, token) != 1 {
			t.Fatalf("exit history %s: %d", token, strings.Count(contents, token))
		}
	}
	t.Log("主缓冲区120行头/中/尾和原shell保留；原生窗口上滚可读、动画不覆写，返回最新和退出不重复正文")
}

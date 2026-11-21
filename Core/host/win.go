// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/host/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: ConfigDirName; ElectronDir; findElectron; isSafeElectronName; LaunchConfigGUI; EnsureConsoleUTF8; AttachParentConsole; EnsureChatConsole; ReportStartupError; handleUsable; PrepareTerminalConsole
// Impact: python -B scripts/code-atlas.py show Core/host/win.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

//go:build windows

// 本文件放 Windows 平台专有的两件小事：
//
//  1. 把配置中心交给 Electron 启动。Go 这边不再自带图形配置界面，
//     Aieyra Config.exe 的角色是「拉起来并立刻退场」。
//  2. 让以 -H=windowsgui 子系统编译出来的 exe 在命令行里依然能打印输出。
//
// 之所以要 windowsgui：面向用户的配置中心是双击启动的，控制台子系统会先闪一个
// 黑框再被 Electron 的窗口取代。改为 windowsgui 后双击完全不出现黑框，
// 而命令行用法靠 AttachParentConsole 接管调用者的控制台来保住输出。
package host

import (
	"fmt"
	"golang.org/x/sys/windows"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"unsafe"
)

// ConfigDirName 是仓库根目录下 Electron 配置中心的目录名。
const ConfigDirName = "Client/Desktop"

// ElectronDir 返回 Electron 配置中心所在目录。
//
// 以「本可执行文件所在目录」为基准而不是当前工作目录：这样把整个仓库目录
// 挪到任何位置、或者从别的目录用绝对路径启动，都依然找得到配置中心。
func ElectronDir() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(filepath.Dir(exe), ConfigDirName)
	st, err := os.Stat(dir)
	if err != nil || !st.IsDir() {
		return "", fmt.Errorf("找不到配置中心目录：%s\n"+
			"请确认 Aieyra Config.exe 与 %s 目录在同一层。", dir, ConfigDirName)
	}
	return dir, nil
}

// findElectron 在配置中心目录里定位 Electron 运行时。
//
// 优先用 electron 包自己记录的 path.txt，再退回约定路径，最后才是 PATH 上的全局
// 安装。找不到时返回的错误要能直接指导用户修复——这条路径错了，用户看到的现象
// 就是「双击了但什么都没发生」。
func findElectron(cfgDir string) (string, error) {
	modDir := filepath.Join(cfgDir, "node_modules", "electron")

	var cands []string
	// path.txt 是 electron 包自己记录的二进制相对路径，优先照它找。
	// 但它是包内文本文件、不可信：必须做白名单校验，否则
	// name=../../evil.exe 会经 Join 转义出 dist 目录导致任意执行（F5）。
	if b, err := os.ReadFile(filepath.Join(modDir, "path.txt")); err == nil {
		if name := strings.TrimSpace(string(b)); isSafeElectronName(name) {
			cands = append(cands, filepath.Join(modDir, "dist", name))
		}
	}
	cands = append(cands, filepath.Join(modDir, "dist", "electron.exe"))
	// PATH 全局兜底放在最后：它可被劫持，只作最后手段。
	if p, err := exec.LookPath("electron.exe"); err == nil {
		cands = append(cands, p)
	}

	for _, c := range cands {
		if st, err := os.Stat(c); err == nil && !st.IsDir() {
			return c, nil
		}
	}
	return "", fmt.Errorf("未找到 Electron 运行时。\n"+
		"请在 %s 目录下执行：node tools/ensure-electron.cjs", cfgDir)
}

// isSafeElectronName 校验 path.txt 里读到的相对文件名。
// 只允许纯文件名（字母数字._-），拒绝绝对路径、.. 与任何分隔符。
func isSafeElectronName(name string) bool {
	if name == "" || len(name) > 64 {
		return false
	}
	if filepath.IsAbs(name) {
		return false
	}
	if strings.ContainsAny(name, `/\:`) || strings.Contains(name, "..") {
		return false
	}
	for _, r := range name {
		if !(r >= 'A' && r <= 'Z' || r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r == '.' || r == '_' || r == '-') {
			return false
		}
	}
	return strings.HasSuffix(strings.ToLower(name), ".exe")
}

// LaunchConfigGUI 启动 Electron 配置中心后立刻返回，不等待它退出。
//
// configPath 为空表示用默认配置文件位置；非空时透传给 Electron 的 --config。
// 配置中心是独立的桌面程序，本进程退出不会影响它。
func LaunchConfigGUI(configPath string) error {
	cfgDir, err := ElectronDir()
	if err != nil {
		return err
	}
	electron, err := findElectron(cfgDir)
	if err != nil {
		return err
	}

	// 透传的 --config 先做存在性校验：否则 Electron 侧报错难定位，
	// 用户看到的只是“双击了但什么都没发生”。
	if configPath != "" {
		if abs, aerr := filepath.Abs(configPath); aerr == nil {
			configPath = abs
		}
		if _, serr := os.Stat(configPath); serr != nil {
			return fmt.Errorf("指定的配置文件不存在：%s", configPath)
		}
	}

	args := []string{"--use-env-proxy", cfgDir}
	if configPath != "" {
		args = append(args, "--config", configPath)
	}

	cmd := exec.Command(electron, args...)
	cmd.Dir = cfgDir
	// CREATE_NEW_PROCESS_GROUP：让配置中心彻底独立于本进程所在的进程组，
	// 启动器退出不会连带结束它。
	//
	// 这里刻意不设 HideWindow：它会给子进程的 STARTUPINFO 带上
	// wShowWindow=SW_HIDE，而 Windows 会把这个值用在该进程**第一个**
	// ShowWindow 调用上，结果是 Electron 的窗口被创建成隐藏的——
	// 进程在跑、窗口存在，用户却什么都看不到。
	// 启动器本身已是 windowsgui 子系统、没有控制台要藏，无需这个标志。
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: 0x00000200}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("启动配置中心失败：%w", err)
	}
	return nil
}

// EnsureConsoleUTF8 把控制台输出代码页切到 UTF-8。
//
// 程序输出的是 UTF-8（中文 + 制表符），而中文 Windows 控制台默认是 GBK：
// conhost 下不切就是满屏乱码。WT 自身是 Unicode 原生，不受影响。
// 管道/文件重定向走不到 conhost，调这个 API 要么无操作要么失败——
// 失败就静静返回，绝不挡启动。两个 exe 的入口都要在打印任何东西之前调它。
func EnsureConsoleUTF8() {
	const cpUTF8 = 65001
	kernel32 := syscall.NewLazyDLL("kernel32.dll")
	setCP := kernel32.NewProc("SetConsoleOutputCP")
	r, _, _ := setCP.Call(uintptr(cpUTF8))
	_ = r
}

// AttachParentConsole 让 windowsgui 子系统的 exe 在命令行里也能正常打印。
//
// 附着控制台不代表替换标准流。父进程传入的管道或文件重定向必须原样保留，否则结果会被写到
// 控制台窗口，调用方（脚本、CI）从管道里什么都读不到。
//
// 双击启动时既没有可用句柄、也没有父控制台，函数直接返回，不会闪出黑框。
func AttachParentConsole() {
	outOK, errOK := handleUsable(os.Stdout), handleUsable(os.Stderr)

	const attachParentProcess = ^uintptr(0) // (DWORD)-1
	kernel32 := syscall.NewLazyDLL("kernel32.dll")
	if r, _, _ := kernel32.NewProc("AttachConsole").Call(attachParentProcess); r == 0 {
		return
	}
	if outOK && errOK {
		return // 附着控制台与保留管道是两回事；已有重定向绝不重绑。
	}
	// 接管成功后要重新打开 CONOUT$：进程启动时这些句柄还指向无效值，
	// 不重开的话 fmt 的输出会被丢掉。
	// GetConsoleMode requires read access, including for an output handle.
	// A write-only handle can print but makes the shared TUI look redirected.
	f, err := os.OpenFile("CONOUT$", os.O_RDWR, 0)
	if err != nil {
		return
	}
	if !outOK {
		os.Stdout = f
	}
	if !errOK {
		os.Stderr = f
	}
}

// GUI 入口不先创建空窗口；只有真正走直接 TUI 且没有宿主时才分配控制台。
func EnsureChatConsole() error {
	kernel := syscall.NewLazyDLL("kernel32.dll")
	if cp, _, _ := kernel.NewProc("GetConsoleCP").Call(); cp != 0 {
		return nil
	}
	AttachParentConsole()
	if cp, _, _ := kernel.NewProc("GetConsoleCP").Call(); cp == 0 {
		if ok, _, err := kernel.NewProc("AllocConsole").Call(); ok == 0 {
			return fmt.Errorf("无法连接终端控制台：%w", err)
		}
	}
	EnsureConsoleUTF8()
	return nil
}

// 双击时没有 stderr，启动故障仍须可见；命令行/重定向继续输出原有错误流。
func ReportStartupError(err error) {
	if handleUsable(os.Stderr) {
		fmt.Fprintln(os.Stderr, "错误：", err)
		return
	}
	// 界面故障优先使用同一套产品对话框；运行时本身缺失时才保留系统级最后退路。
	if dir, e := ElectronDir(); e == nil {
		runtime := filepath.Join(dir, "node_modules", "electron", "dist", "electron.exe")
		script := filepath.Join(dir, "src", "startup-error.cjs")
		if _, e = os.Stat(runtime); e == nil {
			if _, e = os.Stat(script); e == nil {
				cmd := exec.Command(runtime, script)
				for _, value := range os.Environ() {
					if !strings.HasPrefix(value, "ELECTRON_RUN_AS_NODE=") && !strings.HasPrefix(value, "AIEYRA_STARTUP_ERROR=") {
						cmd.Env = append(cmd.Env, value)
					}
				}
				cmd.Env = append(cmd.Env, "AIEYRA_STARTUP_ERROR=启动失败："+err.Error())
				if cmd.Run() == nil {
					return
				}
			}
		}
	}
	message, _ := syscall.UTF16PtrFromString("启动失败：" + err.Error())
	title, _ := syscall.UTF16PtrFromString("Aieyra OS")
	syscall.NewLazyDLL("user32.dll").NewProc("MessageBoxW").Call(0, uintptr(unsafe.Pointer(message)), uintptr(unsafe.Pointer(title)), 0x10)
}

// handleUsable 判断一个标准流句柄是否真的能写。
//
// 以 windowsgui 子系统启动、又没有父控制台时，GetStdHandle 返回的是无效句柄，
// 对它的 Stat 会报错——这正是「需要接管控制台」的信号。
func handleUsable(f *os.File) bool {
	if f == nil {
		return false
	}
	_, err := f.Stat()
	return err == nil
}

// Repair missing GUI-subsystem handles without replacing pipes or file redirects.
func PrepareTerminalConsole() (func(), error) {
	noop := func() {}
	if handleUsable(os.Stdin) && handleUsable(os.Stdout) {
		return noop, nil
	}
	kernel := syscall.NewLazyDLL("kernel32.dll")
	if cp, _, _ := kernel.NewProc("GetConsoleCP").Call(); cp == 0 && (handleUsable(os.Stdin) || handleUsable(os.Stdout)) {
		return noop, fmt.Errorf("终端标准流不完整；请同时提供输入和输出")
	}
	if err := EnsureChatConsole(); err != nil {
		return noop, err
	}
	var restore []func()
	cleanup := func() {
		for i := len(restore) - 1; i >= 0; i-- {
			restore[i]()
		}
	}
	for _, stream := range []struct {
		file **os.File
		id   uint32
		name string
	}{{&os.Stdin, windows.STD_INPUT_HANDLE, "CONIN$"}, {&os.Stdout, windows.STD_OUTPUT_HANDLE, "CONOUT$"}, {&os.Stderr, windows.STD_ERROR_HANDLE, "CONOUT$"}} {
		if handleUsable(*stream.file) {
			continue
		}
		f, err := os.OpenFile(stream.name, os.O_RDWR, 0)
		if err != nil {
			cleanup()
			return noop, err
		}
		old, oldHandle := *stream.file, windows.Handle(0)
		oldHandle, _ = windows.GetStdHandle(stream.id)
		if err := windows.SetStdHandle(stream.id, windows.Handle(f.Fd())); err != nil {
			f.Close()
			cleanup()
			return noop, err
		}
		*stream.file = f
		restore = append(restore, func() {
			_ = windows.SetStdHandle(stream.id, oldHandle)
			*stream.file = old
			_ = f.Close()
		})
	}
	return cleanup, nil
}

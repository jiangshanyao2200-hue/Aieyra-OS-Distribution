// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/platform/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: DefaultShell; DesktopDirectory; windowsShellProcess; StartShellProcess; conPTYBridge; Write; Stop; Wait; Resize; Close; shellName
// Impact: python -B scripts/code-atlas.py show Core/platform/shell_windows.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

//go:build windows

package platform

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path"
	"sort"
	"strings"
	"sync"
	"syscall"
	"time"
	"unicode/utf16"
	"unsafe"

	"golang.org/x/sys/windows"
)

func DefaultShell() (string, error) {
	for _, name := range []string{"pwsh.exe", `C:\Program Files\PowerShell\7\pwsh.exe`, `C:\Program Files (x86)\PowerShell\7\pwsh.exe`, "powershell.exe", "cmd.exe"} {
		if p, e := exec.LookPath(name); e == nil {
			return p, nil
		}
	}
	return "", fmt.Errorf("未找到 PowerShell 或 cmd")
}

func DesktopDirectory() string {
	directory, err := windows.KnownFolderPath(windows.FOLDERID_Desktop, windows.KF_FLAG_DEFAULT)
	if err != nil {
		return ""
	}
	return directory
}

type windowsShellProcess struct {
	process, job, console windows.Handle
	input, output         *os.File
	drained               chan struct{}
	closeOnce             sync.Once
}

func StartShellProcess(req ProcessRequest, output io.Writer) (Process, error) {
	p := &windowsShellProcess{drained: make(chan struct{})}
	job, err := windows.CreateJobObject(nil, nil)
	if err != nil {
		return nil, err
	}
	p.job = job
	limits := windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION{}
	limits.BasicLimitInformation.LimitFlags = windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
	if _, err = windows.SetInformationJobObject(job, windows.JobObjectExtendedLimitInformation, uintptr(unsafe.Pointer(&limits)), uint32(unsafe.Sizeof(limits))); err != nil {
		p.Close()
		return nil, err
	}
	var ir, iw, or, ow windows.Handle
	security := &windows.SecurityAttributes{Length: uint32(unsafe.Sizeof(windows.SecurityAttributes{})), InheritHandle: 1}
	if err = windows.CreatePipe(&ir, &iw, security, 0); err != nil {
		p.Close()
		return nil, err
	}
	if err = windows.CreatePipe(&or, &ow, security, 0); err != nil {
		windows.CloseHandle(ir)
		windows.CloseHandle(iw)
		p.Close()
		return nil, err
	}
	defer windows.CloseHandle(ir)
	defer windows.CloseHandle(ow)
	p.input = os.NewFile(uintptr(iw), "shell-stdin")
	p.output = os.NewFile(uintptr(or), "shell-stdout")
	if err = windows.SetHandleInformation(iw, windows.HANDLE_FLAG_INHERIT, 0); err != nil {
		p.Close()
		return nil, err
	}
	if err = windows.SetHandleInformation(or, windows.HANDLE_FLAG_INHERIT, 0); err != nil {
		p.Close()
		return nil, err
	}
	attributeCount := uint32(1)
	if req.TTY {
		attributeCount = 2
	}
	attrs, err := windows.NewProcThreadAttributeList(attributeCount)
	if err != nil {
		p.Close()
		return nil, err
	}
	defer attrs.Delete()
	si := windows.StartupInfoEx{ProcThreadAttributeList: attrs.List()}
	si.Cb = uint32(unsafe.Sizeof(si))
	flags := uint32(windows.EXTENDED_STARTUPINFO_PRESENT | windows.CREATE_UNICODE_ENVIRONMENT | windows.CREATE_SUSPENDED)
	inherit := true
	si.Flags = windows.STARTF_USESTDHANDLES
	si.StdInput, si.StdOutput, si.StdErr = ir, ow, ow
	handles := []windows.Handle{ir, ow}
	if err = attrs.Update(windows.PROC_THREAD_ATTRIBUTE_HANDLE_LIST, unsafe.Pointer(&handles[0]), uintptr(len(handles))*unsafe.Sizeof(handles[0])); err != nil {
		p.Close()
		return nil, err
	}
	if req.TTY {
		if err = windows.CreatePseudoConsole(windows.Coord{X: 120, Y: 30}, ir, ow, 0, &p.console); err != nil {
			p.Close()
			return nil, fmt.Errorf("无法创建交互终端：%w", err)
		}
		update := windows.NewLazySystemDLL("kernel32.dll").NewProc("UpdateProcThreadAttribute")
		ok, _, e := update.Call(uintptr(unsafe.Pointer(attrs.List())), 0, windows.PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE, uintptr(p.console), unsafe.Sizeof(p.console), 0, 0)
		if ok == 0 {
			p.Close()
			return nil, e
		}
	} else {
		flags |= windows.CREATE_NO_WINDOW
	}
	args := append([]string{req.Shell}, req.Args...)
	if req.TTY {
		// 重定向父进程下，ConPTY 的控制台与继承的标准句柄可能不同。
		// 在隐藏控制台内部重绑标准句柄后才运行真正的命令，原生子程序也能正确读写。
		bridge, e := DefaultShell()
		if e != nil || (ShellWordName(bridge) != "pwsh" && ShellWordName(bridge) != "powershell") {
			p.Close()
			return nil, fmt.Errorf("交互终端需要 PowerShell 的控制台桥接")
		}
		payload, _ := json.Marshal(map[string]any{"shell": req.Shell, "args": req.Args})
		script := conPTYBridge + "\n$r=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('" + base64.StdEncoding.EncodeToString(payload) + "')) | ConvertFrom-Json; $a=@($r.args); & $r.shell @a; exit $LASTEXITCODE"
		args = []string{bridge, "-NoLogo", "-NoProfile", "-Command", script}
	}
	for i, a := range args {
		args[i] = syscall.EscapeArg(a)
	}
	line := strings.Join(args, " ")
	if !req.TTY && ShellWordName(req.Shell) == "cmd" {
		line = syscall.EscapeArg(req.Shell) + ` /d /s /c "` + req.Command + `"`
	}
	cmd, err := windows.UTF16PtrFromString(line)
	if err != nil {
		p.Close()
		return nil, err
	}
	cwd, err := windows.UTF16PtrFromString(req.Workdir)
	if err != nil {
		p.Close()
		return nil, err
	}
	env := req.Environment
	sort.Slice(env, func(i, j int) bool { return strings.ToUpper(env[i]) < strings.ToUpper(env[j]) })
	block := utf16.Encode([]rune(strings.Join(env, "\x00") + "\x00\x00"))
	var pi windows.ProcessInformation
	if err = windows.CreateProcess(nil, cmd, nil, nil, inherit, flags, &block[0], cwd, &si.StartupInfo, &pi); err != nil {
		p.Close()
		return nil, err
	}
	p.process = pi.Process
	defer windows.CloseHandle(pi.Thread)
	// 创建时挂起，先加入 Job 再运行，消除子进程抢先逃出生命周期的窗口。
	if err = windows.AssignProcessToJobObject(job, pi.Process); err != nil {
		windows.TerminateProcess(pi.Process, 1)
		p.Close()
		return nil, err
	}
	go func() { io.Copy(output, p.output); close(p.drained) }()
	if _, err = windows.ResumeThread(pi.Thread); err != nil {
		p.Stop()
		p.Close()
		return nil, err
	}
	return p, nil
}

const conPTYBridge = `Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class AieyraShellConsole {
 [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateFile(string name,uint access,uint share,IntPtr security,uint creation,uint flags,IntPtr template);
 [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetStdHandle(int id,IntPtr handle);
 [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetHandleInformation(IntPtr handle,uint mask,uint flags);
 public static void Connect() {
  IntPtr input=CreateFile("CONIN$",0xC0000000,3,IntPtr.Zero,3,0,IntPtr.Zero);
  IntPtr output=CreateFile("CONOUT$",0xC0000000,3,IntPtr.Zero,3,0,IntPtr.Zero);
  if(input.ToInt64()==-1 || output.ToInt64()==-1) throw new System.ComponentModel.Win32Exception();
  SetHandleInformation(input,1,1); SetHandleInformation(output,1,1);
  if(!SetStdHandle(-10,input)||!SetStdHandle(-11,output)||!SetStdHandle(-12,output)) throw new System.ComponentModel.Win32Exception();
 }
}
'@
[AieyraShellConsole]::Connect()
[Console]::InputEncoding=[Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$o=[IO.StreamWriter]::new([Console]::OpenStandardOutput(),[Text.UTF8Encoding]::new($false));$o.AutoFlush=$true;[Console]::SetOut($o)
$e=[IO.StreamWriter]::new([Console]::OpenStandardError(),[Text.UTF8Encoding]::new($false));$e.AutoFlush=$true;[Console]::SetError($e)
[Console]::SetIn([IO.StreamReader]::new([Console]::OpenStandardInput(),[Text.UTF8Encoding]::new($false)))`

func (p *windowsShellProcess) Write(b []byte) (int, error) { return p.input.Write(b) }
func (p *windowsShellProcess) Stop() error                 { return windows.TerminateJobObject(p.job, 1) }
func (p *windowsShellProcess) Wait() (int, error) {
	_, err := windows.WaitForSingleObject(p.process, windows.INFINITE)
	var code uint32
	if err == nil {
		err = windows.GetExitCodeProcess(p.process, &code)
	}
	// 父命令结束后不遗留脱管的子进程；持续服务应让顶层命令保持运行。
	_ = windows.TerminateJobObject(p.job, code)
	if p.console != 0 {
		windows.ClosePseudoConsole(p.console)
		p.console = 0
	}
	select {
	case <-p.drained:
	case <-time.After(2 * time.Second):
		p.output.Close()
		<-p.drained
	}
	return int(code), err
}
func (p *windowsShellProcess) Resize(columns, rows int) error {
	if p.console == 0 {
		return fmt.Errorf("process has no PTY")
	}
	return windows.ResizePseudoConsole(p.console, windows.Coord{X: int16(columns), Y: int16(rows)})
}

func (p *windowsShellProcess) Close() {
	p.closeOnce.Do(func() {
		if p.job != 0 {
			windows.CloseHandle(p.job)
		}
		if p.console != 0 {
			windows.ClosePseudoConsole(p.console)
		}
		if p.input != nil {
			p.input.Close()
		}
		if p.output != nil {
			p.output.Close()
		}
		if p.process != 0 {
			windows.CloseHandle(p.process)
		}
	})
}

func shellName(s string) string {
	return strings.ToLower(strings.TrimSuffix(path.Base(strings.ReplaceAll(s, "\\", "/")), ".exe"))
}

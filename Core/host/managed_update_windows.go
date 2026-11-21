// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/host/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: hideUpdateProcess; rejectUpdateHardlink; waitUpdateParent
// Impact: python -B scripts/code-atlas.py show Core/host/managed_update_windows.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

//go:build windows

package host

import (
	"fmt"
	"golang.org/x/sys/windows"
	"os/exec"
	"syscall"
	"time"
)

func hideUpdateProcess(command *exec.Cmd) {
	command.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
}
func rejectUpdateHardlink(file string) error {
	p, err := windows.UTF16PtrFromString(file)
	if err != nil {
		return err
	}
	h, err := windows.CreateFile(p, 0, windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE, nil, windows.OPEN_EXISTING, windows.FILE_ATTRIBUTE_NORMAL, 0)
	if err != nil {
		return err
	}
	defer windows.CloseHandle(h)
	var info windows.ByHandleFileInformation
	if err = windows.GetFileInformationByHandle(h, &info); err != nil {
		return err
	}
	if info.NumberOfLinks > 1 {
		return fmt.Errorf("hard links are not update targets")
	}
	return nil
}
func waitUpdateParent(pid int) (func(time.Duration) error, func(), error) {
	if pid <= 0 {
		return nil, nil, fmt.Errorf("invalid parent")
	}
	handle, err := windows.OpenProcess(windows.SYNCHRONIZE, false, uint32(pid))
	if err != nil {
		return nil, nil, err
	}
	return func(timeout time.Duration) error {
		value, err := windows.WaitForSingleObject(handle, uint32(timeout/time.Millisecond))
		if err != nil {
			return err
		}
		if value != windows.WAIT_OBJECT_0 {
			return fmt.Errorf("parent did not exit")
		}
		return nil
	}, func() { _ = windows.CloseHandle(handle) }, nil
}

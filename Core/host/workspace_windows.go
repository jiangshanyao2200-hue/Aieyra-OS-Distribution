// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/host/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: hideWorkspaceProcess; ownWorkspaceLifetime
// Impact: python -B scripts/code-atlas.py show Core/host/workspace_windows.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

//go:build windows

package host

import (
	"os"
	"os/exec"
	"unsafe"

	"golang.org/x/sys/windows"
)

func hideWorkspaceProcess(command *exec.Cmd) {
	// Chromium cannot create a nested Windows lowbox. Only the OS-confirmed
	// AppContainer uses the existing kernel sandbox for the whole process tree.
	const tokenIsAppContainer = 29
	var container, returned uint32
	err := windows.GetTokenInformation(windows.GetCurrentProcessToken(), tokenIsAppContainer,
		(*byte)(unsafe.Pointer(&container)), 4, &returned)
	if err == nil && container != 0 {
		command.Args = append([]string{command.Args[0], "--no-sandbox"}, command.Args[1:]...)
		command.Stdin, command.Stdout = os.Stdin, os.Stdout
		if os.Getenv("AIEYRA_WORKSPACE_OFFSCREEN") == "1" {
			command.Env = append(command.Env, "AIEYRA_WORKSPACE_OFFSCREEN=1")
		}
	}
}

// Assign the Core itself before it can spawn Electron, so there is no window
// between child creation and job assignment. Windows closes this non-inherited
// handle on abrupt Core termination and kills all descendants, even if the
// desktop failed before loading its parent-lease watchdog.
func ownWorkspaceLifetime() (func(), error) {
	job, err := windows.CreateJobObject(nil, nil)
	if err != nil {
		return nil, err
	}
	var limits windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION
	limits.BasicLimitInformation.LimitFlags = windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
	if _, err = windows.SetInformationJobObject(job, windows.JobObjectExtendedLimitInformation, uintptr(unsafe.Pointer(&limits)), uint32(unsafe.Sizeof(limits))); err != nil {
		windows.CloseHandle(job)
		return nil, err
	}
	if err = windows.AssignProcessToJobObject(job, windows.CurrentProcess()); err != nil {
		windows.CloseHandle(job)
		return nil, err
	}
	return func() {
		// A normal shutdown already waited for Electron. Disarm before closing to
		// preserve the Core's normal exit code instead of terminating ourselves.
		limits.BasicLimitInformation.LimitFlags = 0
		_, _ = windows.SetInformationJobObject(job, windows.JobObjectExtendedLimitInformation, uintptr(unsafe.Pointer(&limits)), uint32(unsafe.Sizeof(limits)))
		_ = windows.CloseHandle(job)
	}, nil
}

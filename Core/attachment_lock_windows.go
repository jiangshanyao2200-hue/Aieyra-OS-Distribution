// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: lockAttachmentUsage; attachmentProcessAbsent
// Impact: python -B scripts/code-atlas.py show Core/attachment_lock_windows.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import "golang.org/x/sys/windows"

// Readers keep snapshots alive for their entire context lifetime. An exclusive
// collector never waits for readers, and cannot overlap a new reader.
func lockAttachmentUsage(path string, exclusive bool) (func(), error) {
	p, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return nil, err
	}
	h, err := windows.CreateFile(p, windows.GENERIC_READ|windows.GENERIC_WRITE, windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE, nil, windows.OPEN_ALWAYS, windows.FILE_ATTRIBUTE_NORMAL, 0)
	if err != nil {
		return nil, err
	}
	flags := uint32(0)
	if exclusive {
		flags = windows.LOCKFILE_EXCLUSIVE_LOCK | windows.LOCKFILE_FAIL_IMMEDIATELY
	}
	o := &windows.Overlapped{}
	if err = windows.LockFileEx(h, flags, 0, 1, 0, o); err != nil {
		windows.CloseHandle(h)
		return nil, err
	}
	return func() { windows.UnlockFileEx(h, 0, 1, 0, o); windows.CloseHandle(h) }, nil
}

func attachmentProcessAbsent(pid int) bool {
	if pid <= 0 {
		return false
	}
	h, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, uint32(pid))
	if err != nil {
		return err == windows.ERROR_INVALID_PARAMETER
	}
	defer windows.CloseHandle(h)
	var status uint32
	return windows.GetExitCodeProcess(h, &status) == nil && status != 259
}

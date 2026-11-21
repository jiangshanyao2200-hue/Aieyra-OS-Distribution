// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/internal/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: createTemp
// Impact: python -B scripts/code-atlas.py show Core/internal/privatefile/file_windows.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package privatefile

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"unsafe"

	"golang.org/x/sys/windows"
)

func createTemp(dir string) (*os.File, error) {
	user, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil {
		return nil, err
	}
	// Apply the protected DACL at creation, before any other user can open it.
	sd, err := windows.SecurityDescriptorFromString("D:P(A;;FA;;;SY)(A;;FA;;;" + user.User.Sid.String() + ")")
	if err != nil {
		return nil, err
	}
	sa := windows.SecurityAttributes{SecurityDescriptor: sd}
	sa.Length = uint32(unsafe.Sizeof(sa))
	for attempt := 0; attempt < 10; attempt++ {
		var random [16]byte
		if _, err = rand.Read(random[:]); err != nil {
			return nil, err
		}
		name := filepath.Join(dir, ".aieyra-private-"+hex.EncodeToString(random[:])+".tmp")
		wide, err := windows.UTF16PtrFromString(name)
		if err != nil {
			return nil, err
		}
		handle, err := windows.CreateFile(wide, windows.GENERIC_READ|windows.GENERIC_WRITE, windows.FILE_SHARE_READ, &sa, windows.CREATE_NEW, windows.FILE_ATTRIBUTE_NORMAL, 0)
		runtime.KeepAlive(sd)
		if err == windows.ERROR_FILE_EXISTS || err == windows.ERROR_ALREADY_EXISTS {
			continue
		}
		if err != nil {
			return nil, &os.PathError{Op: "create", Path: name, Err: err}
		}
		file := os.NewFile(uintptr(handle), name)
		if file == nil {
			windows.CloseHandle(handle)
			os.Remove(name)
			return nil, fmt.Errorf("cannot open private temporary file")
		}
		return file, nil
	}
	return nil, fmt.Errorf("cannot allocate private temporary file")
}

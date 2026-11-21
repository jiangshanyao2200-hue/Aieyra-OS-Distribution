// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/host/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: runBrowserSecretWorker
// Impact: python -B scripts/code-atlas.py show Core/host/browser_secret_windows.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package host

import (
	"errors"
	"io"
	"unsafe"

	"golang.org/x/sys/windows"
)

func runBrowserSecretWorker(seal bool, in io.Reader, out io.Writer) error {
	const limit = 64 << 10
	data, err := io.ReadAll(io.LimitReader(in, limit+1))
	if err != nil {
		return err
	}
	defer clear(data)
	if len(data) == 0 || len(data) > limit {
		return errors.New("invalid browser secret input size")
	}
	source := windows.DataBlob{Size: uint32(len(data)), Data: &data[0]}
	entropy := []byte("Aieyra Browser website passwords v1")
	optional := windows.DataBlob{Size: uint32(len(entropy)), Data: &entropy[0]}
	var result windows.DataBlob
	if seal {
		err = windows.CryptProtectData(&source, nil, &optional, 0, nil, windows.CRYPTPROTECT_UI_FORBIDDEN, &result)
	} else {
		err = windows.CryptUnprotectData(&source, nil, &optional, 0, nil, windows.CRYPTPROTECT_UI_FORBIDDEN, &result)
	}
	if err != nil {
		return err
	}
	defer windows.LocalFree(windows.Handle(uintptr(unsafe.Pointer(result.Data))))
	plainOrCipher := unsafe.Slice(result.Data, result.Size)
	defer clear(plainOrCipher)
	_, err = out.Write(plainOrCipher)
	return err
}

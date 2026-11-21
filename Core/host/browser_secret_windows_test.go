// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/host/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestBrowserSecretDesktopWorker
// Impact: python -B scripts/code-atlas.py show Core/host/browser_secret_windows_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package host

import (
	"bytes"
	"testing"
)

func TestBrowserSecretDesktopWorker(t *testing.T) {
	plain := []byte("synthetic browser credential")
	var encrypted bytes.Buffer
	handled, err := RunDesktopWorker([]string{"-browser-secret-seal"}, bytes.NewReader(plain), &encrypted)
	if !handled || err != nil {
		t.Fatalf("seal: handled=%v err=%v", handled, err)
	}
	if bytes.Contains(encrypted.Bytes(), plain) {
		t.Fatal("ciphertext contains credential")
	}
	var decrypted bytes.Buffer
	handled, err = RunDesktopWorker([]string{"-browser-secret-open"}, &encrypted, &decrypted)
	if !handled || err != nil || !bytes.Equal(plain, decrypted.Bytes()) {
		t.Fatalf("open: handled=%v matched=%v err=%v", handled, bytes.Equal(plain, decrypted.Bytes()), err)
	}
	handled, err = RunDesktopWorker([]string{"-browser-secret-open"}, bytes.NewReader(plain), &decrypted)
	if !handled || err == nil {
		t.Fatalf("invalid ciphertext: handled=%v err=%v", handled, err)
	}
}

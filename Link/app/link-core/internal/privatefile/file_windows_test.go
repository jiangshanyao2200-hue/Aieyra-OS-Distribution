// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Link/app/link-core/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: TestPrivateDACLReplacesBroadInheritance; assertPrivateDACL
// Impact: python -B scripts/code-atlas.py show Link/app/link-core/internal/privatefile/file_windows_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package privatefile

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/sys/windows"
)

func TestPrivateDACLReplacesBroadInheritance(t *testing.T) {
	dir := t.TempDir()
	parent, err := windows.SecurityDescriptorFromString("D:P(A;OICI;FA;;;WD)")
	if err != nil {
		t.Fatal(err)
	}
	acl, _, err := parent.DACL()
	if err != nil {
		t.Fatal(err)
	}
	if err = windows.SetNamedSecurityInfo(dir, windows.SE_FILE_OBJECT, windows.DACL_SECURITY_INFORMATION|windows.PROTECTED_DACL_SECURITY_INFORMATION, nil, nil, acl, nil); err != nil {
		t.Fatal(err)
	}
	// Inspect immediately after creation, before writing or a permission update.
	temp, err := createTemp(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(temp.Name())
	defer temp.Close()
	assertPrivateDACL(t, temp.Name())
	if info, err := temp.Stat(); err != nil || info.Size() != 0 {
		t.Fatal("private temporary file was not empty", err)
	}
	file := filepath.Join(dir, "identity.json")
	for _, data := range []string{"synthetic first key", "synthetic replacement key"} {
		if err = Write(file, []byte(data)); err != nil {
			t.Fatal(err)
		}
		assertPrivateDACL(t, file)
		if got, err := os.ReadFile(file); err != nil || string(got) != data {
			t.Fatal("credential read failed", err)
		}
	}
	// The caller's parent directory was not tightened by writing one credential.
	after, err := windows.GetNamedSecurityInfo(dir, windows.SE_FILE_OBJECT, windows.DACL_SECURITY_INFORMATION)
	if err != nil || !strings.Contains(after.String(), ";;;WD)") {
		t.Fatal("parent permissions changed", err)
	}
}

func assertPrivateDACL(t *testing.T, file string) {
	t.Helper()
	sd, err := windows.GetNamedSecurityInfo(file, windows.SE_FILE_OBJECT, windows.DACL_SECURITY_INFORMATION)
	if err != nil {
		t.Fatal(err)
	}
	user, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil {
		t.Fatal(err)
	}
	actual := sd.String()
	if !strings.Contains(actual, "D:P") || !strings.Contains(actual, user.User.Sid.String()) || !strings.Contains(actual, ";;;SY)") || strings.Contains(actual, ";;;WD)") || strings.Contains(actual, ";;;BU)") || strings.Contains(actual, ";;;AU)") {
		t.Fatal("unexpected private DACL", actual)
	}
	acl, _, err := sd.DACL()
	if err != nil || acl == nil || acl.AceCount != 2 {
		t.Fatal("expected only current user and SYSTEM", actual, err)
	}
}

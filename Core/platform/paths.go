// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/platform/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: AppRoot; ElectronPath; DefaultOSWorkdir; writableWorkdir; defaultOSWorkdir
// Impact: python -B scripts/code-atlas.py show Core/platform/paths.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package platform

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
)

// AppRoot resolves the same product tree for a portable folder and a macOS bundle.
func AppRoot() string {
	if root := os.Getenv("AIEYRA_ROOT"); root != "" {
		return root
	}
	exe, _ := os.Executable()
	return filepath.Dir(exe)
}

func ElectronPath(root string) string {
	name := "electron"
	switch runtime.GOOS {
	case "windows":
		name = "electron.exe"
	case "darwin":
		name = filepath.Join("Electron.app", "Contents", "MacOS", "Electron")
	}
	return filepath.Join(root, "Client/Desktop", "node_modules", "electron", "dist", name)
}

// DefaultOSWorkdir keeps the portable workspace when writable. A read-only
// installation uses the current user's product directory. Explicit choices
// fail visibly instead of silently writing a user's work somewhere else.
func DefaultOSWorkdir() (string, error) {
	return defaultOSWorkdir(AppRoot(), os.Getenv("AIEYRA_WORKDIR"), os.UserConfigDir, writableWorkdir)
}

func writableWorkdir(dir string) error {
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	f, err := os.CreateTemp(dir, ".aieyra-write-*")
	if err != nil {
		return err
	}
	return errors.Join(f.Close(), os.Remove(f.Name()))
}

func defaultOSWorkdir(app, explicit string, userDir func() (string, error), prepare func(string) error) (string, error) {
	if explicit != "" {
		if err := prepare(explicit); err != nil {
			return "", fmt.Errorf("指定的工作目录不可写 %s: %w", explicit, err)
		}
		return explicit, nil
	}
	portable := filepath.Join(app, "工作目录")
	if err := prepare(portable); err == nil {
		return portable, nil
	}
	base, err := userDir()
	if err != nil {
		return "", fmt.Errorf("安装目录不可写，无法定位用户工作目录: %w", err)
	}
	dir := filepath.Join(base, "AieyraOS", "工作目录")
	if err := prepare(dir); err != nil {
		return "", fmt.Errorf("用户工作目录不可写 %s: %w", dir, err)
	}
	return dir, nil
}

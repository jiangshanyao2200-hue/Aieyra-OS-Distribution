// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: controlTools; registerControl; writeControlRegistration; controlRegistrationDirectory
// Impact: python -B scripts/code-atlas.py show Core/control_registration.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// Keep the bridge's default policy within the tools of the registered runtime.
func (c *MatrixControl) controlTools() []string {
	defaults := []string{"terminal", "exec_command", "write_stdin", "read_shell_output", "apply_patch", "exec", "wait", "update_plan", "view_image", "agents", "human"}
	w := c.manager.workspace
	if w == nil {
		return defaults
	}
	allowed := make(map[string]bool)
	for _, name := range w.permissions(WorkspaceMatrix) {
		allowed[name] = true
	}
	result := make([]string, 0, len(defaults))
	for _, name := range defaults {
		if allowed[name] {
			result = append(result, name)
		}
	}
	return result
}

// 只登记当前实例的本机引用，不复制凭据，也不自动发起模型请求。
// 每次启动使用不同登记身份；旧账本永不绑定到另一个进程。
func (c *MatrixControl) registerControl(created, exe string) error {
	if os.Getenv("AIEYRA_CONTROL_DISABLED") == "1" {
		return nil
	}
	dir, err := controlRegistrationDirectory(exe)
	if err != nil {
		return err
	}
	if dir == "" {
		return nil
	}

	return c.writeControlRegistration(dir, created, exe)
}

func (c *MatrixControl) writeControlRegistration(dir, created, exe string) error {
	s, err := Load(c.manager.config)
	if err != nil {
		return err
	}
	models := []string{}
	for _, profile := range s.APIProfiles {
		if profile.Enabled == nil || *profile.Enabled {
			models = append(models, profile.ID)
		}
	}
	id := fmt.Sprintf("os-%x", sha256.Sum256([]byte(fmt.Sprintf("%s\n%d\n%s\n%s", c.manager.owner, os.Getpid(), exe, created))))[:43]
	local := filepath.Join(dir, "os-sessions", id)
	if err = os.MkdirAll(filepath.Join(local, "work"), 0700); err != nil {
		return err
	}
	config := map[string]any{
		"version": 1, "mode": "os", "discovery_ref": c.file,
		"expected_session": c.manager.owner, "expected_pid": os.Getpid(), "expected_executable": exe,
		"expected_created_at": created, "state_dir": filepath.Join(local, "bridge"), "work_root": filepath.Join(local, "work"),
		"allowed_models": models,
		// 原桥默认策略与当前宿主实际能力取交集。
		"allowed_tools":    c.controlTools(),
		"enable_os_writes": len(models) > 0, "enable_matrix_writes": len(models) > 0, "timeout_seconds": 12,
	}
	path := filepath.Join(local, "bridge.json")
	if err = WriteMatrixJSON(path, config); err != nil {
		return err
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	err = WriteMatrixJSON(filepath.Join(local, "source.json"), map[string]any{
		"version": 1, "id": id, "session_id": c.manager.owner, "pid": os.Getpid(), "executable": exe,
		"created_at": created, "config_sha256": fmt.Sprintf("%x", sha256.Sum256(raw)),
	})
	if err == nil {
		c.registrationState = "registered_local_reference"
	}
	return err
}

// Reuse the existing private store. Registration never creates a second office.
func controlRegistrationDirectory(exe string) (string, error) {
	root := os.Getenv("AIEYRA_ROOT")
	if root == "" {
		root = filepath.Dir(exe)
	}
	app := filepath.Join(root, "Control", "app")
	if _, err := os.Stat(filepath.Join(app, "service", "main.py")); os.IsNotExist(err) {
		return "", nil
	} else if err != nil {
		return "", err
	}
	directory := os.Getenv("AIEYRA_CONTROL_DATA_DIR")
	if directory == "" {
		if dataRoot := os.Getenv("AIEYRA_CONTROL_DATA"); dataRoot != "" {
			if !filepath.IsAbs(dataRoot) {
				return "", fmt.Errorf("指挥中心数据根必须为绝对路径")
			}
			directory = filepath.Join(dataRoot, "shared")
		}
	}
	if directory == "" {
		locator := os.Getenv("AIEYRA_CONTROL_STORAGE")
		if locator == "" {
			base, err := os.UserConfigDir()
			if err != nil {
				return "", err
			}
			if runtime.GOOS == "linux" {
				if config := os.Getenv("XDG_CONFIG_HOME"); config != "" {
					base = config
				}
			}
			locator = filepath.Join(base, "Aieyra Control", "storage.json")
		}
		if !filepath.IsAbs(locator) {
			return "", fmt.Errorf("指挥中心存储定位文件必须为绝对路径")
		}
		raw, err := os.ReadFile(locator)
		if err == nil {
			var value struct {
				Schema   int    `json:"schema_version"`
				DataRoot string `json:"data_root"`
			}
			if err = json.Unmarshal(bytes.TrimPrefix(raw, []byte{0xef, 0xbb, 0xbf}), &value); err != nil || value.Schema != 1 || !filepath.IsAbs(value.DataRoot) {
				return "", fmt.Errorf("指挥中心存储定位文件无效")
			}
			directory = filepath.Join(value.DataRoot, "shared")
		} else if os.IsNotExist(err) {
			directory = filepath.Join(root, "Control", "共享库", "私有数据", "Aieyra Control", "data", "shared")
			if _, err = os.Stat(directory); os.IsNotExist(err) {
				return "", nil
			}
		} else {
			return "", err
		}
	}
	if !filepath.IsAbs(directory) {
		return "", fmt.Errorf("指挥中心数据目录必须为绝对路径")
	}
	info, err := os.Stat(directory)
	if err != nil || !info.IsDir() {
		return "", fmt.Errorf("指挥中心现有存储不可用；拒绝新建空工位")
	}
	real, err := filepath.EvalSymlinks(directory)
	if err != nil {
		return "", err
	}
	software, err := filepath.EvalSymlinks(app)
	if err != nil {
		return "", err
	}
	relative, err := filepath.Rel(software, real)
	if err != nil || relative == "." || (relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator))) {
		return "", fmt.Errorf("指挥中心私有存储不能位于软件目录内")
	}
	return directory, nil
}

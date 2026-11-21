// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/host/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: reuseModuleRuntime; acquireModuleRuntime; ValidateDesktopModule
// Impact: python -B scripts/code-atlas.py show Core/host/module_runtime.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package host

import (
	"bufio"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"regexp"

	programcontract "github.com/aieyra/aieyra-os/program/contract"
	"time"

	agent "github.com/aieyra/aieyra-os/CORE"
	"github.com/aieyra/aieyra-os/CORE/modules"
)

// Discovery is only a hint. Authenticate the live loopback peer before reuse.
func reuseModuleRuntime(config, module string) (bool, error) {
	data, err := os.ReadFile(filepath.Join(agent.PrivatePaths(config).Runtime, "modules", "os.json"))
	if err != nil {
		if os.IsNotExist(err) {
			return false, nil
		}
		return false, err
	}
	var record struct {
		Protocol string `json:"protocol"`
		ID       string `json:"id"`
		Port     int    `json:"port"`
		PID      int    `json:"pid"`
		Token    string `json:"token"`
	}
	if len(data) > 8192 || json.Unmarshal(data, &record) != nil || record.Protocol != "aieyra-module/1" || record.ID != "os" || record.Port < 1 || record.Port > 65535 || len(record.Token) != 64 {
		return false, fmt.Errorf("模块发现记录无效，原文件已保留")
	}
	conn, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", record.Port), 800*time.Millisecond)
	if err != nil {
		return false, nil
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(30 * time.Second))
	reader := bufio.NewReaderSize(conn, 64*1024)
	read := func() (map[string]any, error) {
		line, err := reader.ReadSlice('\n')
		if err != nil {
			return nil, err
		}
		var value map[string]any
		err = json.Unmarshal(line, &value)
		return value, err
	}
	if err = json.NewEncoder(conn).Encode(map[string]any{"type": "hello", "token": record.Token}); err != nil {
		return true, err
	}
	welcome, err := read()
	if err != nil {
		return true, err
	}
	if welcome["type"] != "welcome" || welcome["module"] != "os" || welcome["pid"] != float64(record.PID) {
		return true, fmt.Errorf("模块身份核验未通过")
	}
	params := map[string]any{}
	if module != "" {
		params["module"] = module
		params["action"] = "detach"
	}
	if err = json.NewEncoder(conn).Encode(map[string]any{"type": "request", "id": "launch", "method": "module_action", "params": params}); err != nil {
		return true, err
	}
	for {
		reply, err := read()
		if err != nil {
			return true, err
		}
		if reply["type"] == "response" && reply["id"] == "launch" {
			if reply["ok"] != true {
				return true, fmt.Errorf("现有运行时未能打开模块：%v", reply["error"])
			}
			return true, nil
		}
	}
}

// Held by the Core for its lifetime. Concurrent launches wait for discovery,
// never create competing chat or browser owners while the first is starting.
func acquireModuleRuntime(config, module string) (func(), bool, error) {
	dir := filepath.Join(agent.PrivatePaths(config).Runtime, "modules")
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, false, err
	}
	deadline := time.Now().Add(35 * time.Second)
	for {
		if reused, err := reuseModuleRuntime(config, module); reused || err != nil {
			return nil, reused, err
		}
		file, err := os.OpenFile(filepath.Join(dir, "runtime.lock"), os.O_CREATE|os.O_RDWR, 0600)
		if err != nil {
			return nil, false, err
		}
		if lockModuleRuntime(file) == nil {
			return func() { _ = file.Close() }, false, nil
		}
		_ = file.Close()
		if time.Now().After(deadline) {
			return nil, false, fmt.Errorf("现有运行时尚未就绪，请稍后重试")
		}
		time.Sleep(200 * time.Millisecond)
	}
}

// ValidateDesktopModule reads the same public catalog as the native host.
func ValidateDesktopModule(root, id string) error {
	if id == "" {
		return nil
	}
	data, err := os.ReadFile(filepath.Join(root, "Client/Desktop", "host", "module-catalog.json"))
	if err != nil {
		return fmt.Errorf("模块目录不可读：%w", err)
	}
	var catalog []struct {
		ID         string `json:"id"`
		Detachable *bool  `json:"detachable"`
	}
	if len(data) > 32768 || json.Unmarshal(data, &catalog) != nil {
		return fmt.Errorf("模块目录无效")
	}
	for _, row := range catalog {
		if row.ID == id {
			if row.Detachable != nil && !*row.Detachable {
				return fmt.Errorf("首页固定在 OS 主窗口，请直接启动 Aieyra OS")
			}
			return nil
		}
	}
	// Native Programs own their navigation since the desktop relocation.
	// This only validates a launch name; the running host still performs the
	// shared package admission, including disabled or uninstalled packages.
	programRoot := filepath.Join(root, "Program", "official")
	data, err = os.ReadFile(filepath.Join(programRoot, "catalog.json"))
	if err != nil {
		return fmt.Errorf("程序目录不可读：%w", err)
	}
	var folders []string
	if len(data) > 32768 || json.Unmarshal(data, &folders) != nil || len(folders) > 64 {
		return fmt.Errorf("程序目录无效")
	}
	validFolder := regexp.MustCompile(`^[a-z][a-z0-9_-]{0,47}$`)
	for _, folder := range folders {
		if !validFolder.MatchString(folder) {
			return fmt.Errorf("程序目录身份无效")
		}
		if folder != id {
			continue
		}
		base := filepath.Join(programRoot, folder)
		data, err = os.ReadFile(filepath.Join(base, "manifest.json"))
		if err != nil {
			return fmt.Errorf("程序清单不可读：%w", err)
		}
		manifest, err := modules.DecodeManifest(data)
		if err != nil || manifest.ID != "aieyra."+folder || manifest.Kind != "program" {
			return fmt.Errorf("程序清单身份无效")
		}
		entry := manifest.Entrypoints["program"]
		_, declared := manifest.Files[entry]
		if modules.FileName(entry) != nil || !declared {
			return fmt.Errorf("程序定义入口无效")
		}
		data, err = os.ReadFile(filepath.Join(base, entry))
		if err != nil {
			return fmt.Errorf("程序定义不可读：%w", err)
		}
		files := map[string]bool{}
		for name := range manifest.Files {
			files[name] = true
		}
		definition, err := programcontract.Decode(data, files)
		if err != nil || definition.Desktop.Native != folder {
			return fmt.Errorf("程序导航与目录不一致")
		}
		return nil
	}
	return fmt.Errorf("未知模块：%s", id)
}

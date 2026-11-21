// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/cmd/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: moduleFor; passThrough; environment; run; main
// Impact: python -B scripts/code-atlas.py show Core/cmd/aieyra-module/main.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Command aieyra-module opens a product window using the shared Core.
//
// 用法：
//
//	Aieyra Link.exe                       # 按文件名选择模块
//	aieyra-module.exe --module=link       # 显式指定模块
//
// 每个入口都装配同一 Core/host；有已运行宿主时复用原页面。
// 无 OS.exe 的独立发行包也使用同一配置、模块准入和生命周期。
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	app "github.com/aieyra/aieyra-os/CORE/host"
	"github.com/aieyra/aieyra-os/CORE/platform"
)

// moduleFor 先看显式 --module，再按可执行文件名判断。
func moduleFor(executable string, args []string, titles map[string]string) (string, []string) {
	rest := make([]string, 0, len(args))
	name := ""
	for _, arg := range args {
		trimmed := strings.TrimLeft(arg, "-")
		if strings.HasPrefix(trimmed, "module=") && strings.HasPrefix(arg, "-") {
			name = strings.ToLower(strings.TrimPrefix(trimmed, "module="))
			continue
		}
		rest = append(rest, arg)
	}
	if name == "" {
		base := filepath.Base(filepath.ToSlash(strings.ReplaceAll(executable, "\\", "/")))
		base = strings.TrimSuffix(base, filepath.Ext(base))
		for id, title := range titles {
			if strings.EqualFold(base, title) {
				name = id
				break
			}
		}
	}
	if _, ok := titles[name]; !ok {
		return "", nil
	}
	return name, rest
}

// passThrough 只转交模块宿主认识的参数，其余忽略。
func passThrough(args []string) []string {
	result := []string{}
	for _, arg := range args {
		trimmed := strings.TrimLeft(arg, "-")
		for _, key := range []string{"page=", "config=", "at="} {
			if strings.HasPrefix(trimmed, key) && strings.HasPrefix(arg, "-") && len(arg) <= 4096 {
				result = append(result, "--"+trimmed)
			}
		}
	}
	return result
}

// environment 去掉 OS 生命周期凭据与桥接描述，独立模块自己开租约。
func environment(base []string) []string {
	result := make([]string, 0, len(base))
	for _, item := range base {
		key := strings.ToUpper(strings.SplitN(item, "=", 2)[0])
		if strings.HasPrefix(key, "AIEYRA_OS_OWNER_") || strings.HasPrefix(key, "AIEYRA_RUNTIME_") ||
			strings.HasPrefix(key, "AIEYRA_EXPERIENCE_OBSERVER_") || key == "AIEYRA_WORKSPACE_BRIDGE" ||
			key == "AIEYRA_WORKSPACE_OFFSCREEN" || key == "AIEYRA_WORKSPACE_TEST_CDP_PORT" ||
			key == "AIEYRA_MODULE_OFFSCREEN" || key == "AIEYRA_MODULE_TEST_CDP_PORT" ||
			key == "ELECTRON_RUN_AS_NODE" || key == "NODE_OPTIONS" {
			continue
		}
		result = append(result, item)
	}
	return result
}

func run() error {
	executable, _ := os.Executable()
	root := platform.AppRoot()
	catalog, err := os.ReadFile(filepath.Join(root, "Client", "Desktop", "host", "module-launchers.json"))
	if err != nil {
		return fmt.Errorf("读取程序启动目录：%w", err)
	}
	var titles map[string]string
	if len(catalog) > 8192 || json.Unmarshal(catalog, &titles) != nil || len(titles) == 0 {
		return fmt.Errorf("程序启动目录无效")
	}
	name, rest := moduleFor(executable, os.Args[1:], titles)
	if name == "link" {
		name = "together"
	}
	if name == "" {
		return fmt.Errorf("请使用已登记的程序启动器，或指定 --module=<程序>")
	}
	if err := app.ValidateDesktopModule(root, name); err != nil {
		return err
	}
	if handled, err := app.RecoverManagedUpdate(root); err != nil || handled {
		return err
	}
	// The module owns a fresh process lease. Never inherit an old Core bridge
	// or owner token; profile/runtime locks decide whether a live host is reused.
	for _, item := range os.Environ() {
		key := strings.SplitN(item, "=", 2)[0]
		if len(environment([]string{item})) == 0 {
			if err := os.Unsetenv(key); err != nil {
				return err
			}
		}
	}
	if err := os.Setenv("AIEYRA_OS_OPEN_MODULE", name); err != nil {
		return err
	}
	if err := os.Unsetenv("AIEYRA_OS_OPEN_CONTROL"); err != nil {
		return err
	}
	config := ""
	for _, arg := range passThrough(rest) {
		if strings.HasPrefix(arg, "--config=") {
			config = strings.TrimPrefix(arg, "--config=")
		}
	}
	s, release, err := app.OpenDesktopSettings(config, "")
	if err != nil {
		return err
	}
	defer release()
	return app.RunWorkspace(s, "", "", false)
}

func main() {
	if handled, err := app.RunDesktopWorker(os.Args[1:], os.Stdin, os.Stdout); handled {
		if err != nil {
			os.Exit(1)
		}
		return
	}
	if handled, err := app.RunDesktopMaintenance(os.Args[1:]); handled {
		if err != nil {
			fail(err)
		}
		return
	}
	if err := run(); err != nil {
		fail(err)
	}
}

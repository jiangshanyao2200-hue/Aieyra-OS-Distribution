// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/host/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestFindElectronUsesPathTxt; TestFindElectronFallsBackToConvention; TestFindElectronErrorIsActionable; TestFindElectronIgnoresDirectory; TestEnsureConsoleUTF8SetsCodePage; TestElectronDirReportsMissingConfig
// Impact: python -B scripts/code-atlas.py show Core/host/win_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

//go:build windows

package host

import (
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
)

// 这一段单独成文件是为了跟上 win.go 的构建标签：findElectron 只在 Windows 上存在。

// TestFindElectronUsesPathTxt 验证优先按 electron 包自己记录的 path.txt 定位。
func TestFindElectronUsesPathTxt(t *testing.T) {
	cfgDir := t.TempDir()
	modDir := filepath.Join(cfgDir, "node_modules", "electron")
	if err := os.MkdirAll(filepath.Join(modDir, "dist"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(modDir, "path.txt"), []byte("electron.exe"), 0o600); err != nil {
		t.Fatal(err)
	}
	want := filepath.Join(modDir, "dist", "electron.exe")
	if err := os.WriteFile(want, []byte("stub"), 0o600); err != nil {
		t.Fatal(err)
	}

	got, err := findElectron(cfgDir)
	if err != nil {
		t.Fatalf("应能找到 Electron：%v", err)
	}
	if got != want {
		t.Errorf("路径应为 %s，实际 %s", want, got)
	}
}

// TestFindElectronFallsBackToConvention 验证没有 path.txt 时按约定路径兜底。
func TestFindElectronFallsBackToConvention(t *testing.T) {
	cfgDir := t.TempDir()
	want := filepath.Join(cfgDir, "node_modules", "electron", "dist", "electron.exe")
	if err := os.MkdirAll(filepath.Dir(want), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(want, []byte("stub"), 0o600); err != nil {
		t.Fatal(err)
	}

	got, err := findElectron(cfgDir)
	if err != nil {
		t.Fatalf("应能找到 Electron：%v", err)
	}
	if got != want {
		t.Errorf("路径应为 %s，实际 %s", want, got)
	}
}

// TestFindElectronErrorIsActionable 找不到时必须给出可执行的修复指令。
//
// 这条最重要：路径错了用户看到的现象就是「双击了但什么都没发生」，
// 所以错误信息必须自己说清楚下一步做什么。
func TestFindElectronErrorIsActionable(t *testing.T) {
	// 隔离 PATH：否则机器上装了全局 electron 时这里会意外成功，
	// 测试结果就依赖于跑测试的机器了。
	t.Setenv("PATH", t.TempDir())
	cfgDir := t.TempDir()

	_, err := findElectron(cfgDir)
	if err == nil {
		t.Fatal("空目录不应找到 Electron")
	}
	for _, want := range []string{"ensure-electron.cjs", cfgDir} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("错误信息应包含 %q，实际：%v", want, err)
		}
	}
}

// TestFindElectronIgnoresDirectory 验证同名的目录不会被当成可执行文件。
func TestFindElectronIgnoresDirectory(t *testing.T) {
	t.Setenv("PATH", t.TempDir())
	cfgDir := t.TempDir()
	dir := filepath.Join(cfgDir, "node_modules", "electron", "dist", "electron.exe")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}

	if got, err := findElectron(cfgDir); err == nil {
		t.Errorf("目录不应被当作 Electron：%s", got)
	}
}

// TestEnsureConsoleUTF8SetsCodePage 输出代码页必须切到 UTF-8。
//
// 中文 Windows 控制台默认 GBK，不切的话程序输出的中文全是乱码。
// 失败也不报错——挡启动比乱码更糟，所以这里只断言"切了"，不测"切失败会怎样"。
func TestEnsureConsoleUTF8SetsCodePage(t *testing.T) {
	kernel32 := syscall.NewLazyDLL("kernel32.dll")
	getCP := kernel32.NewProc("GetConsoleOutputCP")
	setCP := kernel32.NewProc("SetConsoleOutputCP")

	prev, _, _ := getCP.Call()
	if prev == 0 {
		t.Skip("没有控制台可切（CI/管道环境），跳过")
	}
	t.Cleanup(func() { _, _, _ = setCP.Call(prev) })

	EnsureConsoleUTF8()

	cur, _, _ := getCP.Call()
	if cur != 65001 {
		t.Errorf("输出代码页应为 UTF-8(65001)，实际 %d", cur)
	}
}

// TestElectronDirReportsMissingConfig 验证找不到 Desktop 目录时的提示可读。
func TestElectronDirReportsMissingConfig(t *testing.T) {
	// 测试二进制所在的临时目录旁边不会有 Client/Desktop/，正好覆盖缺失分支。
	_, err := ElectronDir()
	if err == nil {
		t.Skip("测试二进制同级恰好存在 Desktop 目录，跳过缺失分支")
	}
	if !strings.Contains(err.Error(), ConfigDirName) {
		t.Errorf("错误信息应指明期望的目录名 %q，实际：%v", ConfigDirName, err)
	}
}

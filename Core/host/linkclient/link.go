// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/host/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: regular; discover; Discover; Run; childExit; ExitCode
// Impact: python -B scripts/code-atlas.py show Core/host/linkclient/link.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Package linkclient 只发现和调用OS 内部模块，不在 OS 内重复实现 Link。
package linkclient

import (
	"context"
	"errors"
	"fmt"
	"github.com/aieyra/aieyra-os/CORE/internal/osowner"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"time"
)

func regular(path string) error {
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("Link 程序入口无效，请修复 OS 安装")
	}
	for parent := filepath.Dir(path); ; parent = filepath.Dir(parent) {
		info, err := os.Lstat(parent)
		if err != nil {
			return err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("Link 程序路径包含重定向，请修复 OS 安装")
		}
		if filepath.Dir(parent) == parent {
			break
		}
	}
	return nil
}

func discover(root, selected, programs string) (string, error) {
	name := "aieyra-link"
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	target, err := filepath.Abs(filepath.Join(root, "Link", "app", "runtime", "link", name))
	if err != nil {
		return "", err
	}
	if err = regular(target); err != nil {
		return "", fmt.Errorf("OS 内置 Link 运行文件缺失或无效，请修复 OS 安装：%w", err)
	}
	return target, nil
}

func Discover() (string, error) {
	root := os.Getenv("AIEYRA_ROOT")
	if root == "" {
		executable, err := os.Executable()
		if err != nil {
			return "", err
		}
		root = filepath.Dir(executable)
	}
	return discover(root, "", "")
}

// Run 直接继承流和原参数，等待当前子进程退出后才返回。
func Run(ctx context.Context, args []string, in io.Reader, out, diagnostic io.Writer) error {
	executable, err := Discover()
	if err != nil {
		return err
	}
	port, token, release, err := osowner.Open()
	if err != nil {
		return err
	}
	defer release()
	done := make(chan struct{})
	defer close(done)
	go func() {
		select {
		case <-ctx.Done():
			release()
		case <-done:
		}
	}()
	command := exec.Command(executable, args...)
	command.Env = osowner.Environment(os.Environ(), port, token)
	command.Stdin, command.Stdout, command.Stderr = in, out, diagnostic
	command.WaitDelay = 2 * time.Second
	prepare(command)
	err = command.Run()
	if ctx.Err() != nil {
		return ctx.Err()
	}
	var exit *exec.ExitError
	if errors.As(err, &exit) {
		return &childExit{exit}
	}
	return err
}

type childExit struct{ *exec.ExitError }

// ExitCode 让宿主保留产品退出码；非退出类错误仍由宿主显示一次。
func ExitCode(err error) (int, bool) {
	var exit *childExit
	if !errors.As(err, &exit) {
		return 1, false
	}
	code := exit.ExitCode()
	if code < 1 {
		code = 1
	}
	return code, true
}

// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: MatrixWindow; TaskWindow; Open; Hide; commandLocked; Close
// Impact: python -B scripts/code-atlas.py show Core/matrix_window.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"bufio"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/aieyra/aieyra-os/CORE/platform"
)

type MatrixWindow struct {
	mu            sync.Mutex
	config, file  string
	task, session string
	cmd           *exec.Cmd
	connection    net.Conn
	reader        *bufio.Reader
	closed        bool
	done          chan struct{}
}

func (c *MatrixControl) TaskWindow() *MatrixWindow {
	return &MatrixWindow{config: c.manager.config, file: c.file}
}
func (w *MatrixWindow) Open(presentation ...string) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	mode := "display"
	if len(presentation) > 0 {
		mode = presentation[0]
	}
	if mode != "display" && mode != "interactive" {
		return fmt.Errorf("presentation must be display or interactive")
	}
	if w.closed {
		return fmt.Errorf("task window service is closed")
	}
	if w.cmd != nil {
		if len(presentation) == 0 {
			mode = ""
		}
		return w.commandLocked("show", mode)
	}
	root := os.Getenv("AIEYRA_ROOT")
	if root == "" {
		exe, _ := os.Executable()
		root = filepath.Dir(exe)
	}
	script := filepath.Join(root, "Client/Desktop", "src", "matrix-window.cjs")
	if _, err := os.Stat(script); err != nil {
		return fmt.Errorf("task window runtime is unavailable")
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return err
	}
	defer listener.Close()
	var secret [32]byte
	if _, err = rand.Read(secret[:]); err != nil {
		return err
	}
	token := hex.EncodeToString(secret[:])
	bridge, _ := json.Marshal(map[string]any{"port": listener.Addr().(*net.TCPAddr).Port, "token": token})
	cmd := exec.Command(platform.ElectronPath(root), script)
	for _, v := range os.Environ() {
		if !strings.HasPrefix(v, "ELECTRON_RUN_AS_NODE=") && !strings.HasPrefix(v, "AIEYRA_MATRIX_WINDOW_BRIDGE=") {
			cmd.Env = append(cmd.Env, v)
		}
	}
	cmd.Env = append(cmd.Env, "AIEYRA_MATRIX_WINDOW_BRIDGE="+string(bridge))
	// Electron GUI 的 stdin/stdout 在此环境不可靠；只用带随机身份的回环握手。
	if err = cmd.Start(); err != nil {
		return fmt.Errorf("task window failed to start")
	}
	failed := true
	defer func() {
		if failed {
			_ = cmd.Process.Kill()
			_ = cmd.Wait()
		}
	}()
	_ = listener.(*net.TCPListener).SetDeadline(time.Now().Add(12 * time.Second))
	connection, err := listener.Accept()
	if err != nil {
		return fmt.Errorf("task window bridge did not connect")
	}
	defer func() {
		if failed {
			connection.Close()
		}
	}()
	_ = connection.SetDeadline(time.Now().Add(12 * time.Second))
	reader := bufio.NewReaderSize(connection, 4096)
	line, err := reader.ReadString('\n')
	var hello struct {
		Token string `json:"token"`
	}
	if err != nil || len(line) > 4096 || json.Unmarshal([]byte(line), &hello) != nil || hello.Token != token {
		return fmt.Errorf("task window bridge identity mismatch")
	}
	if err = json.NewEncoder(connection).Encode(map[string]string{"discovery": w.file, "config": w.config, "presentation": mode, "task_id": w.task, "session_id": w.session}); err != nil {
		return fmt.Errorf("task window bridge failed")
	}
	line, err = reader.ReadString('\n')
	var reply struct {
		Ready bool `json:"ready"`
	}
	if err != nil || len(line) > 4096 || json.Unmarshal([]byte(line), &reply) != nil || !reply.Ready {
		return fmt.Errorf("task window did not become ready; check the Desktop runtime")
	}
	_ = connection.SetDeadline(time.Time{})
	w.cmd, w.connection = cmd, connection
	w.reader = reader
	done := make(chan struct{})
	w.done = done
	failed = false
	go func() {
		defer close(done)
		_ = cmd.Wait()
		_ = connection.Close()
		w.mu.Lock()
		if w.cmd == cmd {
			w.cmd = nil
			w.connection = nil
		}
		w.mu.Unlock()
	}()
	return nil
}

// Hide保留任务与宿主；再次Open恢复展示，Close仅供整个会话退出。
func (w *MatrixWindow) Hide() error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.closed {
		return fmt.Errorf("task window service is closed")
	}
	if w.cmd == nil {
		return nil
	}
	return w.commandLocked("hide", "")
}
func (w *MatrixWindow) commandLocked(action, mode string) error {
	connection := w.connection
	if connection == nil || w.reader == nil {
		return fmt.Errorf("task window bridge unavailable")
	}
	_ = connection.SetDeadline(time.Now().Add(5 * time.Second))
	defer connection.SetDeadline(time.Time{})
	request := map[string]string{"action": action}
	if mode != "" {
		request["presentation"] = mode
	}
	err := json.NewEncoder(connection).Encode(request)
	var ack struct {
		Action       string `json:"action"`
		Presentation string `json:"presentation"`
	}
	if err == nil {
		var line string
		line, err = w.reader.ReadString('\n')
		if err == nil && (len(line) > 4096 || json.Unmarshal([]byte(line), &ack) != nil || ack.Action != action || (mode != "" && ack.Presentation != mode)) {
			err = fmt.Errorf("unexpected window acknowledgement")
		}
	}
	if err != nil {
		// 超时后不复用流，避免迟到的ack被下一次调用误认。
		_ = connection.Close()
		if w.cmd != nil {
			_ = w.cmd.Process.Kill()
		}
		w.cmd, w.connection, w.reader = nil, nil, nil
		return fmt.Errorf("task window command was not acknowledged")
	}
	return nil
}
func (w *MatrixWindow) Close() {
	if w == nil {
		return
	}
	w.mu.Lock()
	w.closed = true
	done := w.done
	cmd := w.cmd
	if w.connection != nil {
		_ = w.connection.Close()
	}
	w.mu.Unlock()
	if done != nil {
		// 先让 Electron 经断开的父连接正常退出，释放 renderer 与 profile 锁。
		select {
		case <-done:
		case <-time.After(5 * time.Second):
			if cmd != nil {
				_ = cmd.Process.Kill()
			}
			<-done
		}
	}
}

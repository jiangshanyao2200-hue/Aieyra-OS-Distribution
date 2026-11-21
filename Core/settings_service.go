// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: SettingsService; SetCommunityBridge; Community; callCommunity; NewSettingsService; admitProfile; address; settingsStartWaitError; startAddress; drainSettingsProcess; waitSettingsProcess; Close; closeResult; Call; CallTool; callMethod; settingsServiceKey; settingsServiceContext; WithSettingsService
// Impact: python -B scripts/code-atlas.py show Core/settings_service.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/aieyra/aieyra-os/CORE/platform"
	"github.com/aieyra/aieyra-os/contracts/storage"
)

// 一个聊天进程拥有一个服务客户端；无原生宿主时也保持同一服务进程，探测证明才可跨调用使用。
type SettingsService struct {
	releaseProfile         func()
	mu                     sync.Mutex
	config, root, endpoint string
	cmd                    *exec.Cmd
	input                  io.WriteCloser
	closed                 bool
	communityURL           string
	browserURL             string
	memory                 *memoryStore
	memoryDirectory        string // Explicit private Agent scope; empty means the primary user's existing memory.
	startedAt              int64
	starting               chan struct{}
	startCancel            context.CancelFunc
	startupStopErr         error
	startErr               error
	processDone            <-chan error
	closeDone              chan struct{}
	closeErr               error
}

// 原生宿主持有云端会话；模型只能调用限权分享接口，拿不到能力地址。
func (s *SettingsService) SetCommunityBridge(raw string) error {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "http" || u.Hostname() != "127.0.0.1" || u.Port() == "" || len(u.Path) != 65 || u.RawQuery != "" || u.Fragment != "" || u.User != nil || strings.Trim(u.Path[1:], "0123456789abcdef") != "" {
		return fmt.Errorf("本地分享连接无效")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return fmt.Errorf("本地分享连接已关闭")
	}
	s.communityURL = raw
	return nil
}

func (s *SettingsService) Community(ctx context.Context, args json.RawMessage) (json.RawMessage, error) {
	var request struct {
		Action string `json:"action"`
	}
	if err := json.Unmarshal(args, &request); err != nil || strings.HasPrefix(request.Action, "_") {
		return nil, fmt.Errorf("分享操作无效")
	}
	timeout := 90 * time.Second
	switch request.Action {
	// 资源包最大 512 MiB，下载和上传不能按普通论坛请求的时限中断。
	case "center_acquire", "center_install", "center_publish_file":
		timeout = 30 * time.Minute
	}
	return s.callCommunity(ctx, args, timeout)
}

func (s *SettingsService) callCommunity(ctx context.Context, args json.RawMessage, timeout time.Duration) (json.RawMessage, error) {
	s.mu.Lock()
	raw := s.communityURL
	closed := s.closed
	s.mu.Unlock()
	if closed || raw == "" {
		return nil, fmt.Errorf("请从 Aieyra OS 桌面登录后分享")
	}
	if len(args) > 65536 {
		return nil, fmt.Errorf("分享内容过大")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, raw, bytes.NewReader(args))
	if err != nil {
		return nil, fmt.Errorf("分享请求无效")
	}
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: timeout, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("分享连接未完成；发布后请先用原提交编号查询回执")
	}
	defer resp.Body.Close()
	result, err := io.ReadAll(io.LimitReader(resp.Body, (1<<20)+1))
	if err != nil || resp.StatusCode != 200 || len(result) > 1<<20 || !json.Valid(result) {
		return nil, fmt.Errorf("分享响应无效")
	}
	return result, nil
}

func NewSettingsService(config string) *SettingsService {
	return &SettingsService{config: config, root: os.Getenv("AIEYRA_ROOT"), endpoint: os.Getenv("AIEYRA_CONFIG_URL"), startedAt: time.Now().UnixMilli()}
}

func (s *SettingsService) admitProfile() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return fmt.Errorf("settings service is closed")
	}
	if s.releaseProfile == nil {
		release, err := storage.Enter(s.config)
		if err != nil {
			return err
		}
		s.releaseProfile = release
	}
	return nil
}

func (s *SettingsService) address(ctx context.Context) (string, error) {
	if err := s.admitProfile(); err != nil {
		return "", err
	}
	if err := ValidatePrivateProfile(s.config); err != nil {
		return "", err
	}
	for {
		s.mu.Lock()
		if s.closed {
			s.mu.Unlock()
			return "", fmt.Errorf("设置服务已关闭")
		}
		if err := ctx.Err(); err != nil {
			s.mu.Unlock()
			return "", err
		}
		if s.endpoint != "" {
			endpoint := s.endpoint
			s.mu.Unlock()
			return endpoint, nil
		}
		if s.starting != nil {
			done := s.starting
			s.mu.Unlock()
			select {
			case <-done:
				s.mu.Lock()
				endpoint, err := s.endpoint, s.startErr
				s.mu.Unlock()
				if endpoint == "" && err != nil {
					return "", err
				}
				continue
			case <-ctx.Done():
				return "", settingsStartWaitError(ctx)
			}
		}
		root := s.root
		if root == "" {
			exe, _ := os.Executable()
			root = filepath.Dir(exe)
		}
		started := make(chan struct{})
		// 共享服务的启动不跟随第一个调用者的时限：启动时短时限的后台读取先到，
		// 曾把正在启动的进程杀掉、再由后来者重启，界面因此报 context deadline exceeded。
		// 启动只由自身 15 秒就绪时限与 Close 结束；调用者按自己的时限等待。
		startup, cancel := context.WithCancel(context.Background())
		s.starting, s.startCancel, s.startupStopErr, s.startErr = started, cancel, nil, nil
		s.mu.Unlock()
		go func() {
			_, err := s.startAddress(startup, root)
			cancel()
			s.mu.Lock()
			s.starting, s.startCancel, s.startErr = nil, nil, err
			close(started)
			s.mu.Unlock()
		}()
	}
}

func settingsStartWaitError(ctx context.Context) error {
	return fmt.Errorf("设置服务仍在启动，请稍后重试：%w", ctx.Err())
}

func (s *SettingsService) startAddress(ctx context.Context, root string) (string, error) {
	script := filepath.Join(root, "Client/Desktop", "src", "terminal-server.cjs")
	if _, err := os.Stat(script); err != nil {
		return "", fmt.Errorf("未找到共享设置服务，请从 Aieyra OS 入口启动")
	}
	runtime := platform.ElectronPath(root)
	cmd := exec.Command(runtime, "--use-env-proxy", script, "--config", s.config)
	for _, entry := range os.Environ() {
		if !strings.HasPrefix(entry, "AIEYRA_SETTINGS_HOST=") && !strings.HasPrefix(entry, "ELECTRON_RUN_AS_NODE=") && !strings.HasPrefix(entry, "AIEYRA_CORE_EXECUTABLE=") {
			cmd.Env = append(cmd.Env, entry)
		}
	}
	cmd.Env = append(cmd.Env, "ELECTRON_RUN_AS_NODE=1", "AIEYRA_ROOT="+root)
	if executable, err := os.Executable(); err == nil {
		cmd.Env = append(cmd.Env, "AIEYRA_CORE_EXECUTABLE="+executable)
	}
	hideSettingsProcess(cmd)
	input, err := cmd.StdinPipe()
	if err != nil {
		return "", err
	}
	output, err := cmd.StdoutPipe()
	if err != nil {
		input.Close()
		return "", err
	}
	if err = cmd.Start(); err != nil {
		input.Close()
		return "", fmt.Errorf("共享设置服务无法启动")
	}
	ready := make(chan string, 1)
	go func() {
		scanner := bufio.NewScanner(output)
		scanner.Buffer(make([]byte, 4096), 32<<10)
		line := ""
		if scanner.Scan() {
			line = scanner.Text()
		}
		ready <- line
		for scanner.Scan() {
		}
	}()
	var line string
	select {
	case line = <-ready:
	case <-ctx.Done():
	case <-time.After(15 * time.Second):
	}
	var info struct {
		URL string `json:"url"`
	}
	stop := func(done <-chan error) {
		err := drainSettingsProcess(cmd, input, done)
		s.mu.Lock()
		s.startupStopErr = err
		s.mu.Unlock()
	}
	if ctx.Err() != nil || json.Unmarshal([]byte(line), &info) != nil || !strings.HasPrefix(info.URL, "http://127.0.0.1:") {
		stop(nil)
		if ctx.Err() != nil {
			return "", ctx.Err()
		}
		return "", fmt.Errorf("共享设置服务未就绪")
	}
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		stop(done)
		return "", fmt.Errorf("设置服务已关闭")
	}
	s.cmd, s.input, s.endpoint = cmd, input, info.URL
	s.processDone = done
	s.mu.Unlock()
	return info.URL, nil
}

// stdin EOF 是本次拥有的设置服务的正常退出合同；超时才终止，且不隐去失败。
func drainSettingsProcess(cmd *exec.Cmd, input io.WriteCloser, done <-chan error) error {
	if input != nil {
		_ = input.Close()
	}
	if cmd == nil {
		return nil
	}
	if done == nil {
		waiting := make(chan error, 1)
		go func() { waiting <- cmd.Wait() }()
		done = waiting
	}
	return waitSettingsProcess(done, cmd.Process.Kill, 3*time.Second)
}

func waitSettingsProcess(done <-chan error, kill func() error, timeout time.Duration) error {
	result := func(err error) error {
		if err != nil {
			return fmt.Errorf("settings_service_stop_failed")
		}
		return nil
	}
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case err := <-done:
		return result(err)
	case <-timer.C:
	}
	// A completed wait takes precedence when both signals are ready.
	select {
	case err := <-done:
		return result(err)
	default:
	}
	killErr := kill()
	// 兜底后仍确认本次子进程退出，不能把 Kill 调用成功当作清理完成。
	timer.Reset(timeout)
	select {
	case err := <-done:
		if err == nil || killErr != nil {
			return result(err)
		}
	case <-timer.C:
	}
	return fmt.Errorf("settings_service_stop_timeout")
}

func (s *SettingsService) Close() { _ = s.closeResult() }

func (s *SettingsService) closeResult() error {
	if s == nil {
		return nil
	}
	s.mu.Lock()
	if s.closeDone != nil {
		done := s.closeDone
		s.mu.Unlock()
		<-done
		s.mu.Lock()
		err := s.closeErr
		s.mu.Unlock()
		return err
	}
	s.closed = true
	s.closeDone = make(chan struct{})
	starting, cancel := s.starting, s.startCancel
	s.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	if starting != nil {
		<-starting
	}
	s.mu.Lock()
	memory, cmd, input, processDone := s.memory, s.cmd, s.input, s.processDone
	err := s.startupStopErr
	s.memory, s.cmd, s.input, s.processDone = nil, nil, nil, nil
	s.mu.Unlock()
	if memory != nil {
		if closeErr := memory.Close(); closeErr != nil && err == nil {
			err = fmt.Errorf("settings_memory_close_failed")
		}
	}
	if processErr := drainSettingsProcess(cmd, input, processDone); processErr != nil {
		err = processErr
	}
	s.mu.Lock()
	if err == nil && s.releaseProfile != nil {
		s.releaseProfile()
		s.releaseProfile = nil
	}
	s.closeErr = err
	close(s.closeDone)
	s.mu.Unlock()
	return err
}

// 本地 RPC 不把服务能力地址或凭据写入返回错误。
func (s *SettingsService) Call(ctx context.Context, session, action string, args json.RawMessage) (json.RawMessage, error) {
	if action == "api_adapter_apply" || action == "api_adapter_reset" {
		return s.apiAdapterCall(ctx, action, args)
	}
	if action == "model_test" {
		if out, handled, err := s.testBoundAPIAdapter(ctx, args); handled {
			return out, err
		}
	}
	if action == "profile_image" {
		return s.profileImage(ctx, session, args)
	}
	return s.callMethod(ctx, "system:settings", session, action, args)
}

func (s *SettingsService) CallTool(ctx context.Context, name, session string, args json.RawMessage) (json.RawMessage, error) {
	if name == "browser" {
		s.mu.Lock()
		embedded := s.browserURL != ""
		s.mu.Unlock()
		if embedded {
			return s.callBrowser(ctx, session, args)
		}
	}
	if name == "memory" {
		return s.callMemory(ctx, session, args)
	}
	if name == "feedback" {
		return nil, fmt.Errorf("私密反馈已停用，请通过 community 发布公开问题帖子；旧本地记录不会上传")
	}
	if name == "desktop" {
		data, err := json.Marshal(map[string]any{"action": "_desktop", "session_id": session, "arguments": args})
		if err != nil {
			return nil, err
		}
		return s.callCommunity(ctx, data, 60*time.Second)
	}
	if name == "updates" || name == "apps" || name == "link" || name == "server" {
		data, err := json.Marshal(map[string]any{"action": "_" + name, "arguments": args})
		if err != nil {
			return nil, err
		}
		return s.callCommunity(ctx, data, 26*time.Minute)
	}
	return s.callMethod(ctx, "agent:"+name, session, "", args)
}

func (s *SettingsService) callMethod(ctx context.Context, method, session, action string, args json.RawMessage) (json.RawMessage, error) {
	if s == nil {
		return nil, fmt.Errorf("设置服务未初始化")
	}
	payload := map[string]any{"action": action, "arguments": args, "session_id": session}
	request := map[string]any{"method": method, "payload": payload}
	data, err := json.Marshal(request)
	if err != nil {
		return nil, err
	}
	raw, err := s.address(ctx)
	if err != nil {
		return nil, err
	}
	{
		u, err := url.Parse(raw)
		if err != nil || u.Scheme != "http" || u.Hostname() != "127.0.0.1" || !strings.HasSuffix(u.Path, "renderer/index.html") {
			return nil, fmt.Errorf("本地设置服务地址无效")
		}
		u.Path = strings.TrimSuffix(u.Path, "renderer/index.html") + "rpc"
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, u.String(), bytes.NewReader(data))
		if err != nil {
			return nil, fmt.Errorf("无法构造设置请求")
		}
		req.Header.Set("Content-Type", "application/json")
		timeout := 60 * time.Second
		if method == "agent:updates" {
			timeout = 25 * time.Minute
		}
		client := &http.Client{Timeout: timeout, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
		resp, err := client.Do(req)
		if err != nil {
			return nil, fmt.Errorf("设置服务不可用或请求已取消")
		}
		defer resp.Body.Close()
		result, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
		if err != nil || !json.Valid(result) {
			return nil, fmt.Errorf("设置服务响应无效")
		}
		return result, nil
	}
}

type settingsServiceKey struct{}
type settingsServiceContext struct {
	client  *SettingsService
	session string
}

func WithSettingsService(ctx context.Context, client *SettingsService, session string) context.Context {
	return context.WithValue(ctx, settingsServiceKey{}, settingsServiceContext{client, session})
}

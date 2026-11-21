// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: reopenPolicy; shutdownStamp; startupReopenPolicy; reopenFile; recentShutdown; consumeRecentShutdown; saveNormalShutdown; resumeRecentReopen; shownGreeting
// Impact: python -B scripts/code-atlas.py show Core/workspace_reopen.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type reopenPolicy struct {
	Seconds int `json:"window_seconds"`
}

// 上次正常退出时屏幕上的问候。问候不进对话历史，不存下来重开后就没了。
type shutdownStamp struct {
	ClosedAt      time.Time `json:"closed_at"`
	Greeting      string    `json:"greeting,omitempty"`
	GreetingAfter int       `json:"greeting_after,omitempty"`
}

func startupReopenPolicy() reopenPolicy {
	p := struct {
		Reopen reopenPolicy `json:"startup_reopen"`
	}{Reopen: reopenPolicy{300}}
	_ = ReadRuntimeConfig("运行参数.json", &p)
	if p.Reopen.Seconds < 0 || p.Reopen.Seconds > 3600 {
		p.Reopen.Seconds = 300
	}
	return p.Reopen
}
func reopenFile(config string) string {
	return filepath.Join(PrivatePaths(config).Runtime, "startup", "os.json")
}
func recentShutdown(config string, started time.Time, seconds int) (shutdownStamp, bool) {
	var stamp shutdownStamp
	data, err := os.ReadFile(reopenFile(config))
	if err != nil || len(data) > 16384 || seconds <= 0 {
		return stamp, false
	}
	if json.Unmarshal(data, &stamp) != nil || stamp.ClosedAt.IsZero() {
		return shutdownStamp{}, false
	}
	age := started.Sub(stamp.ClosedAt)
	return stamp, age >= 0 && age <= time.Duration(seconds)*time.Second
}

// Consume the previous clean close once. A crash in this run must not reuse it.
// Called only by the OS owner; a CLI launch must leave the OS receipt alone.
func consumeRecentShutdown(config string, started time.Time, seconds int) (shutdownStamp, bool) {
	stamp, recent := recentShutdown(config, started, seconds)
	if err := os.Remove(reopenFile(config)); err != nil && !os.IsNotExist(err) {
		return shutdownStamp{}, false
	}
	return stamp, recent
}
func saveNormalShutdown(config string, now time.Time, greeting string, after int) error {
	file := reopenFile(config)
	if err := os.MkdirAll(filepath.Dir(file), 0700); err != nil {
		return err
	}
	data, err := json.Marshal(shutdownStamp{ClosedAt: now.UTC(), Greeting: utf8Prefix(greeting, 2048), GreetingAfter: after})
	if err != nil {
		return err
	}
	temp, err := os.CreateTemp(filepath.Dir(file), ".shutdown-*")
	if err != nil {
		return err
	}
	name := temp.Name()
	defer os.Remove(name)
	_, err = temp.Write(data)
	if err == nil {
		err = temp.Sync()
	}
	closeErr := temp.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		return err
	}
	return os.Rename(name, file)
}

// 短时间重开不算一次新的见面：不问候、不跑启动流程、不压缩，屏幕接着上次。
// 上次之后对话有变化，那句问候就不再是“上次的显示”，不恢复。
func (w *Workspace) resumeRecentReopen(generation int) bool {
	if w.host == nil || w.Mode() != HostOS || w.split != nil || !w.host.recentReopen {
		return false
	}
	if text := w.host.reopenStamp.Greeting; text != "" && w.host.reopenStamp.GreetingAfter == generation {
		w.greeting = WorkspaceGreeting{State: "local", Text: text, AfterGeneration: generation, AfterMessageID: w.greetingAnchorLocked(), Resumed: true, Revision: w.greeting.Revision + 1}
		return true
	}
	w.greeting = WorkspaceGreeting{State: "skipped", AfterGeneration: generation, Revision: w.greeting.Revision + 1}
	return true
}

// 主工作区屏幕上正显示的问候，退出时写进关闭回执。
func (w *Workspace) shownGreeting() (string, int) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.split != nil || w.greeting.State != "online" && w.greeting.State != "local" {
		return "", 0
	}
	return strings.TrimSpace(w.greeting.Text), w.greeting.AfterGeneration
}

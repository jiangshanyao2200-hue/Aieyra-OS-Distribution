// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestRecentShutdownUsesCloseTimeAndRejectsInvalidClock; TestRecentReopenSkipsGreetingAndStartup; TestRecentReopenInheritsTheGreetingStillOnScreen
// Impact: python -B scripts/code-atlas.py show Core/workspace_reopen_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"net/http"
	"path/filepath"
	"testing"
	"time"
)

func TestRecentShutdownUsesCloseTimeAndRejectsInvalidClock(t *testing.T) {
	config := filepath.Join(t.TempDir(), "config.json")
	now := time.Now()
	if _, recent := recentShutdown(config, now, 300); recent {
		t.Fatal("first launch treated as reopen")
	}
	if err := saveNormalShutdown(config, now, "还在这里", 3); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		age  time.Duration
		want bool
	}{{0, true}, {5 * time.Minute, true}, {5*time.Minute + time.Nanosecond, false}, {-time.Second, false}} {
		if _, got := recentShutdown(config, now.Add(tc.age), 300); got != tc.want {
			t.Fatalf("age %s: %v", tc.age, got)
		}
	}
	stamp, recent := consumeRecentShutdown(config, now, 300)
	if !recent || stamp.Greeting != "还在这里" || stamp.GreetingAfter != 3 {
		t.Fatalf("clean-close receipt lost: %+v", stamp)
	}
	if _, again := consumeRecentShutdown(config, now, 300); again {
		t.Fatal("clean-close receipt was not consumed exactly once")
	}
}
func TestRecentReopenSkipsGreetingAndStartup(t *testing.T) {
	w, _ := testWorkspace(t, func(http.ResponseWriter, *http.Request) { t.Error("reopen called provider") })
	w.host = &WorkspaceHost{mode: HostOS, recentReopen: true}
	result, err := w.greet(rawJSON(map[string]any{"name": "小鱼"}))
	if err != nil {
		t.Fatal(err)
	}
	greet := result.(WorkspaceGreeting)
	if greet.State != "skipped" || greet.Text != "" || w.startupStarted || len(w.greetingUsage) > 0 {
		t.Fatalf("reopen must show nothing new: %+v", greet)
	}
	w.host.mode = HostCLI
	if w.resumeRecentReopen(0) {
		t.Fatal("OS reopen policy leaked to CLI")
	}
}
func TestRecentReopenInheritsTheGreetingStillOnScreen(t *testing.T) {
	w, _ := testWorkspace(t, func(http.ResponseWriter, *http.Request) { t.Error("reopen called provider") })
	w.host = &WorkspaceHost{mode: HostOS, recentReopen: true, reopenStamp: shutdownStamp{Greeting: "上次那句", GreetingAfter: 0}}
	result, err := w.greet(rawJSON(map[string]any{}))
	if err != nil {
		t.Fatal(err)
	}
	greet := result.(WorkspaceGreeting)
	if greet.State != "local" || greet.Text != "上次那句" || !greet.Resumed {
		t.Fatalf("greeting not inherited: %+v", greet)
	}
	if text, after := w.shownGreeting(); text != "上次那句" || after != 0 {
		t.Fatalf("inherited greeting must survive the next quick restart: %q %d", text, after)
	}
	// 对话已经往前走了，那句问候不再是上次的显示
	w.host.reopenStamp.GreetingAfter = 7
	w.greeting = WorkspaceGreeting{}
	if !w.resumeRecentReopen(0) || w.greeting.State != "skipped" {
		t.Fatalf("stale greeting restored: %+v", w.greeting)
	}
}

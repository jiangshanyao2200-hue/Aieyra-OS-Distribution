// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/cmd/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: launcherNames; TestModuleForPrefersExplicitFlagThenExecutableName; TestPassThroughOnlyForwardsKnownOptions; TestEnvironmentDropsLifecycleProof; TestStandaloneModuleKeepsConfigurationAsOneArgument
// Impact: python -B scripts/code-atlas.py show Core/cmd/aieyra-module/main_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package main

import (
	"reflect"
	"testing"
)

var launcherNames = map[string]string{"link": "Aieyra Link", "settings": "Aieyra Settings", "workspace": "Aieyra Workspace"}

func TestModuleForPrefersExplicitFlagThenExecutableName(t *testing.T) {
	if name, rest := moduleFor(`E:\example\Aieyra OS\Aieyra Link.exe`, []string{"--page=control"}, launcherNames); name != "link" || !reflect.DeepEqual(rest, []string{"--page=control"}) {
		t.Fatalf("got %q %v", name, rest)
	}
	if name, _ := moduleFor(`E:\example\Aieyra OS\Aieyra Workspace.exe`, nil, launcherNames); name != "workspace" {
		t.Fatalf("got %q", name)
	}
	if name, rest := moduleFor(`E:\example\aieyra-module.exe`, []string{"--module=Unknown", "--page=editor"}, launcherNames); name != "" || len(rest) != 0 {
		t.Fatalf("got %q %v", name, rest)
	}
	if name, _ := moduleFor(`E:\example\aieyra-module.exe`, []string{"--module=settings"}, launcherNames); name != "settings" {
		t.Fatalf("settings launcher not resolved: %q", name)
	}
}

func TestPassThroughOnlyForwardsKnownOptions(t *testing.T) {
	got := passThrough([]string{"--page=editor", "-config=D:/example/config.json", "--at=10,20", "--remote-debugging-port=9222", "--inspect", "page=x"})
	want := []string{"--page=editor", "--config=D:/example/config.json", "--at=10,20"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v want %v", got, want)
	}
}

func TestEnvironmentDropsLifecycleProof(t *testing.T) {
	got := environment([]string{"PATH=x", "AIEYRA_OS_OWNER_TOKEN=s", "aieyra_runtime_key=s", "AIEYRA_WORKSPACE_BRIDGE={}", "ELECTRON_RUN_AS_NODE=1", "NODE_OPTIONS=--require x", "KEEP=1"})
	if !reflect.DeepEqual(got, []string{"PATH=x", "KEEP=1"}) {
		t.Fatalf("got %v", got)
	}
}
func TestStandaloneModuleKeepsConfigurationAsOneArgument(t *testing.T) {
	name, rest := moduleFor("Aieyra Link.exe", []string{"--config=C:/example/fixture with spaces/config.json", "--remote-debugging-port=9222"}, launcherNames)
	if name != "link" || !reflect.DeepEqual(passThrough(rest), []string{"--config=C:/example/fixture with spaces/config.json"}) {
		t.Fatalf("module configuration %q %v", name, rest)
	}
}

// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: officialToolAdmissionKey; officialToolConfigKey; officialToolUnavailableError; Error; officialToolStore; officialToolEnabled; withOfficialToolAdmission; officialToolContinuation; admitOfficialToolCall; officialToolVisible
// Impact: python -B scripts/code-atlas.py show Core/tool_official.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/aieyra/aieyra-os/CORE/extensionhost"
	"github.com/aieyra/aieyra-os/CORE/modules"
	"github.com/aieyra/aieyra-os/CORE/platform"
	toolowner "github.com/aieyra/aieyra-os/tool"
	terminaltool "github.com/aieyra/aieyra-os/tool/base/official/terminal"
)

type officialToolAdmissionKey struct{}
type officialToolConfigKey struct{}

type officialToolUnavailableError struct{ name string }

func (e *officialToolUnavailableError) Error() string {
	return fmt.Sprintf("tool_package_disabled: %s is disabled, removed or incompatible; enable its official package before a new operation", e.name)
}

func officialToolStore(ctx context.Context) *modules.Manager {
	if v, ok := ctx.Value(agentManagerKey{}).(agentManagerContext); ok && v.manager != nil {
		return v.manager.toolPackages()
	}
	config, _ := ctx.Value(officialToolConfigKey{}).(string)
	if v, ok := ctx.Value(workspaceContextKey{}).(workspaceContext); ok && v.workspace != nil {
		config = v.workspace.config
	}
	if v, ok := ctx.Value(toolboxContextKey{}).(toolboxExecution); ok && config == "" {
		config = v.config
	}
	if config == "" {
		return nil
	} // Pure lower-level services can run without a user profile.
	layout := platform.ResolveLayout(platform.AppRoot(), config, "")
	return extensionhost.New(layout.Packages, extensionhost.Desktop())
}

func officialToolEnabled(ctx context.Context, name string) bool {
	own, known := toolowner.Find(name)
	if !known {
		return true
	}
	if admitted, ok := ctx.Value(officialToolAdmissionKey{}).(map[string]bool); ok {
		return admitted[own.ID]
	}
	m := officialToolStore(ctx)
	if m == nil {
		return true
	}
	r, err := m.Call(ctx, modules.Request{Action: "resolve", ID: own.ID})
	if err != nil || r.Item == nil || r.Item.Origin != "official" {
		return false
	}
	for _, digest := range m.OfficialDigests[own.ID] {
		if digest == r.Item.Digest {
			return true
		}
	}
	return false
}

// A cell owns the native adapters admitted when it starts, just as it owns a
// validated JavaScript payload. Disable affects later invocations, never changes
// the code under an already accepted cell or destroys its query/cancel route.
func withOfficialToolAdmission(ctx context.Context) context.Context {
	if _, exists := ctx.Value(officialToolAdmissionKey{}).(map[string]bool); exists {
		return ctx
	}
	m := officialToolStore(ctx)
	if m == nil {
		return ctx
	}
	allowed := map[string]bool{}
	ids := []string{}
	for _, row := range toolowner.Officials() {
		ids = append(ids, row.ID)
	}
	resolved, err := m.ResolveSnapshot(ctx, ids)
	if err == nil {
		for id, r := range resolved {
			if r.Error != nil || r.Result.Item == nil || r.Result.Item.Origin != "official" {
				continue
			}
			for _, digest := range m.OfficialDigests[id] {
				if digest == r.Result.Item.Digest {
					allowed[id] = true
					break
				}
			}
		}
	}
	return context.WithValue(ctx, officialToolAdmissionKey{}, allowed)
}

func officialToolContinuation(call ToolCall) bool {
	canonical, err := terminaltool.CanonicalCall(call)
	if err != nil {
		return false
	}
	var args struct {
		SessionID  int    `json:"session_id"`
		Chars      string `json:"chars"`
		PressEnter bool   `json:"press_enter"`
		Action     string `json:"action"`
	}
	if json.Unmarshal([]byte(canonical.Function.Arguments), &args) != nil {
		return false
	}
	switch canonical.Function.Name {
	case "read_shell_output":
		return args.SessionID > 0
	case "write_stdin":
		return args.SessionID > 0 && args.Chars == "" && !args.PressEnter
	case "video_gen":
		return args.Action == "status" || args.Action == "list" || args.Action == "recover" || args.Action == "query" || args.Action == "download"
	case "image_gen":
		return args.Action == "status" || args.Action == "list" || args.Action == "recover"
	}
	return false
}

func admitOfficialToolCall(ctx context.Context, call ToolCall) error {
	if officialToolContinuation(call) || officialToolEnabled(ctx, call.Function.Name) {
		return nil
	}
	return &officialToolUnavailableError{name: call.Function.Name}
}

func officialToolVisible(ctx context.Context, name string) bool {
	if officialToolEnabled(ctx, name) {
		return true
	}
	if name == "image_gen" || name == "video_gen" {
		return true
	} // Read back already purchased batches.
	if row, ok := toolowner.Find(name); ok && row.Name == "terminal" {
		if v, ok := ctx.Value(agentManagerKey{}).(agentManagerContext); ok && v.shell != nil {
			rows, available := v.shell.TrySnapshots()
			return available && len(rows) > 0
		}
	}
	return false
}

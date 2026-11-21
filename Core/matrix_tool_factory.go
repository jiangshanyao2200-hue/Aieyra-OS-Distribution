// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: ToolFactoryManual; toolPath; customTool; toolFactory
// Impact: python -B scripts/code-atlas.py show Core/matrix_tool_factory.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"fmt"
	toolcontract "github.com/aieyra/aieyra-os/tool/contract"
	"os"
	"path/filepath"
	"strings"
)

func ToolFactoryManual() string { return runtimePrompt("Matrix/工具说明/工具工厂.txt") }

func (m *AgentManager) toolPath(id string) (string, error) {
	if !toolcontract.ValidCustomID(id) {
		return "", fmt.Errorf("invalid custom tool id")
	}
	return filepath.Join(m.dir, "tools", strings.TrimPrefix(id, "custom:")+".json"), nil
}
func (m *AgentManager) customTool(id string) (CustomTool, error) {
	p, err := m.toolPath(id)
	if err != nil {
		return CustomTool{}, err
	}
	b, err := os.ReadFile(p)
	if err != nil {
		return CustomTool{}, fmt.Errorf("custom tool version unavailable")
	}
	var v CustomTool
	if len(b) > 128<<10 || json.Unmarshal(b, &v) != nil || v.ID != id {
		return CustomTool{}, fmt.Errorf("custom tool manifest integrity check failed")
	}
	digest, err := toolcontract.CustomDigest(v)
	if err != nil || digest != id {
		return CustomTool{}, fmt.Errorf("custom tool manifest integrity check failed")
	}
	if err := toolcontract.ValidateCustom(v, false); err != nil {
		return CustomTool{}, err
	}
	return v, nil
}
func (m *AgentManager) toolFactory(ctx context.Context, data json.RawMessage) (any, error) {
	var p struct {
		Action string `json:"action"`
		CustomTool
	}
	if json.Unmarshal(data, &p) != nil {
		return nil, fmt.Errorf("invalid manifest")
	}
	dir := filepath.Join(m.dir, "tools")
	switch p.Action {
	case "list":
		files, err := filepath.Glob(filepath.Join(dir, "*.json"))
		if err != nil {
			return nil, err
		}
		list := []map[string]string{}
		for _, path := range files {
			id := "custom:" + strings.TrimSuffix(filepath.Base(path), ".json")
			v, e := m.customTool(id)
			if e == nil && toolAllowed(ctx, id) {
				list = append(list, map[string]string{"id": v.ID, "description": v.Description})
			}
		}
		return list, nil
	case "register":
		v := p.CustomTool
		if v.Presentation == nil {
			kind := "cards"
			for _, capability := range v.Capabilities {
				if IsShellTool(capability) {
					kind = "terminal"
					break
				}
			}
			v.Presentation = &ToolPresentation{Kind: kind, Title: v.Description}
			if len(v.Presentation.Title) > 180 {
				v.Presentation.Title = v.Name
			}
		}
		v.ID = ""
		if err := toolcontract.ValidateCustom(v, true); err != nil {
			return nil, err
		}
		seen := map[string]bool{}
		for _, name := range v.Capabilities {
			if !IsShellTool(name) && name != "apply_patch" && name != "view_image" || !toolAllowed(ctx, name) || seen[name] {
				return nil, fmt.Errorf("custom tool requires unassigned or unsupported capability %s", name)
			}
			seen[name] = true
		}
		digest, err := toolcontract.CustomDigest(v)
		if err != nil {
			return nil, err
		}
		v.ID = digest
		path, err := m.toolPath(v.ID)
		if err != nil {
			return nil, err
		}
		m.mu.Lock()
		defer m.mu.Unlock()
		if err := os.MkdirAll(dir, 0700); err != nil {
			return nil, err
		}
		if _, err := os.Stat(path); err == nil {
			return map[string]any{"id": v.ID, "registered": true, "tested": false}, nil
		}
		files, _ := filepath.Glob(filepath.Join(dir, "*.json"))
		if len(files) >= 64 {
			return nil, fmt.Errorf("custom tool version limit reached")
		}
		if err := WriteMatrixJSON(path, v); err != nil {
			return nil, err
		}
		return map[string]any{"id": v.ID, "registered": true, "tested": false}, nil
	case "remove":
		path, err := m.toolPath(p.ID)
		if err != nil {
			return nil, err
		}
		m.mu.Lock()
		defer m.mu.Unlock()
		for _, job := range m.jobs {
			for _, id := range job.record.Spec.Tools {
				if id == p.ID {
					return nil, fmt.Errorf("version is assigned to a persisted agent; keep it for reproducibility")
				}
			}
		}
		return map[string]any{"removed": p.ID}, os.Remove(path)
	}
	return nil, fmt.Errorf("unknown tool_factory action")
}

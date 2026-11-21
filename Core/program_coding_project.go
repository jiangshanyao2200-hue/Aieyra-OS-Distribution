// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: codingProjectState; sameCodingProjectRoot; readCodingProject; codingProjectCall
// Impact: python -B scripts/code-atlas.py show Core/program_coding_project.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/aieyra/aieyra-os/CORE/internal/privatefile"
	"github.com/aieyra/aieyra-os/contracts/storage"
)

// User workspace state is data, independent of model configuration and prompts.
// Opening/selecting/saving never dispatches a model turn. The next admitted
// Coding turn consumes this state and uses its actual working directory.
type codingProjectState struct {
	Root            string            `json:"root"`
	Revision        int               `json:"revision"`
	ActiveFile      string            `json:"active_file,omitempty"`
	Unsaved         bool              `json:"unsaved,omitempty"`
	Drafts          map[string]bool   `json:"unsaved_files,omitempty"`
	GenerationFloor map[string]int    `json:"generation_floor,omitempty"`
	Saved           map[string]string `json:"saved_versions,omitempty"`
}

func sameCodingProjectRoot(a, b string) bool {
	a, b = filepath.Clean(a), filepath.Clean(b)
	if os.PathSeparator == '\\' {
		return strings.EqualFold(a, b)
	}
	return a == b
}

func (m *AgentManager) readCodingProject() (codingProjectState, error) {
	var state codingProjectState
	data, err := readGroupSnapshot(filepath.Join(m.dir, "coding-project.json"))
	if os.IsNotExist(err) {
		return state, nil
	}
	if err != nil {
		return state, err
	}
	if err = json.Unmarshal(data, &state); err != nil {
		return state, err
	}
	state.Root = storage.Relocate(m.config, state.Root)
	return state, nil
}

func (m *AgentManager) codingProjectCall(raw json.RawMessage) (any, error) {
	var p struct {
		Operation        string `json:"operation"`
		Root             string `json:"root"`
		Path             string `json:"path"`
		Version          string `json:"version"`
		Unsaved          bool   `json:"unsaved"`
		ExpectedRevision int    `json:"expected_revision"`
	}
	if err := json.Unmarshal(raw, &p); err != nil {
		return nil, err
	}
	if p.Operation != "open" && p.Operation != "focus" && p.Operation != "saved" && p.Operation != "draft" {
		return nil, fmt.Errorf("未知项目操作")
	}
	// Match group delivery's lock order. Switching cannot race a pending send.
	conversationGroupsMu.Lock()
	m.mu.Lock()
	var shells []*ShellManager
	result, err := func() (codingProjectState, error) {
		state, err := m.readCodingProject()
		if err != nil {
			return state, err
		}
		if p.Operation == "open" {
			if state.Revision != p.ExpectedRevision {
				return state, fmt.Errorf("项目已变化，请重新打开")
			}
			if p.Root == "" {
				return state, fmt.Errorf("请选择项目目录")
			}
			if err = validContactWorkdir(p.Root); err != nil {
				return state, err
			}
			root, e := filepath.EvalSymlinks(p.Root)
			if e != nil {
				return state, e
			}
			root, e = filepath.Abs(root)
			if e != nil {
				return state, e
			}
			if sameCodingProjectRoot(state.Root, root) {
				return state, nil
			}
			for _, j := range m.jobs {
				if !codingRecord(j.record) {
					continue
				}
				if activeAgent(j.record.State) || j.record.State == "waiting_user" {
					return state, fmt.Errorf("Coding 正在使用项目，请待任务结束后切换")
				}
				if j.done != nil {
					select {
					case <-j.done:
					default:
						return state, errAgentFinishing
					}
				}
				if j.shell != nil {
					if e := identityShellBoundary(j.shell); e != nil {
						return state, fmt.Errorf("项目仍有未结束或未知的终端任务")
					}
				}
			}
			if g, e := m.readGroup(codingScopeID()); e == nil {
				for _, member := range append([]groupMember{g.Host}, g.Members...) {
					if member.Pending || member.Await > 0 || member.Sending != "" {
						return state, fmt.Errorf("Coding 还有待交付任务，请稍后切换项目")
					}
				}
			} else if _, statErr := os.Stat(filepath.Join(m.groupDir(), codingScopeID()+".json")); !os.IsNotExist(statErr) {
				return state, e
			}
			floors := make(map[string]int)
			for id, j := range m.jobs {
				if !codingRecord(j.record) {
					continue
				}
				// A pre-selection default workspace already owned its history.
				// Subsequent project changes start a fresh visible operation range.
				if state.Root != "" || !sameCodingProjectRoot(storage.Relocate(m.config, j.record.Spec.Workdir), root) {
					floors[id] = j.record.Generation
				}
			}
			state = codingProjectState{Root: root, Revision: state.Revision, GenerationFloor: floors}
		} else {
			if state.Root == "" || !sameCodingProjectRoot(p.Root, state.Root) {
				return state, fmt.Errorf("项目已切换，原编辑保留")
			}
			if !filepath.IsLocal(p.Path) || strings.ContainsAny(p.Path, ":\x00") {
				return state, fmt.Errorf("文件不在当前项目内")
			}
			file := filepath.ToSlash(p.Path)
			if state.Drafts == nil {
				state.Drafts = map[string]bool{}
			}
			if p.Unsaved {
				state.Drafts[file] = true
			} else {
				delete(state.Drafts, file)
			}
			// A late autosave does not steal focus from the selected document.
			if p.Operation != "draft" || state.ActiveFile == "" {
				state.ActiveFile = file
			}
			state.Unsaved = state.Drafts[state.ActiveFile]
			if p.Operation == "saved" {
				if len(p.Version) > 200 {
					return state, fmt.Errorf("文件版本无效")
				}
				if state.Saved == nil {
					state.Saved = map[string]string{}
				}
				if _, exists := state.Saved[file]; !exists && len(state.Saved) >= 64 {
					keys := make([]string, 0, len(state.Saved))
					for key := range state.Saved {
						keys = append(keys, key)
					}
					sort.Strings(keys)
					delete(state.Saved, keys[0])
				}
				state.Saved[file] = p.Version
			}
		}
		state.Revision++
		if err = os.MkdirAll(m.dir, 0700); err != nil {
			return state, err
		}
		if err = privatefile.WriteSnapshot(filepath.Join(m.dir, "coding-project.json"), rawJSON(state)); err != nil {
			return state, err
		}
		if p.Operation == "open" {
			for _, j := range m.jobs {
				if codingRecord(j.record) && j.shell != nil {
					shells = append(shells, j.shell)
					j.shell = nil
				}
			}
		}
		return state, nil
	}()
	m.mu.Unlock()
	conversationGroupsMu.Unlock()
	for _, shell := range shells {
		shell.Close()
	}
	if err != nil {
		return nil, err
	}
	return map[string]any{"ok": true, "project": result}, nil
}

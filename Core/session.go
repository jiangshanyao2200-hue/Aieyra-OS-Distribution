// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: sessionIDPattern; SessionState; RestoredSession; SessionPath; ID; Lock; Close; RestoreSession; read; applyToolTurn; Start
// Impact: python -B scripts/code-atlas.py show Core/session.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

// 会话文件只保存消息与恢复状态；模型配置和 API Key 仍属于配置文件。
import (
	"encoding/json"
	"fmt"
	"github.com/aieyra/aieyra-os/CORE/sessionservice"
	contextport "github.com/aieyra/aieyra-os/contracts/context"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

var sessionIDPattern = regexp.MustCompile(sessionservice.IDExpression)

type SessionState struct {
	Workdir        string `json:"workdir,omitempty"`
	Model          string `json:"model"`
	Usage          Usage  `json:"usage"`
	SettingsChoice string `json:"settings_choice,omitempty"`
	ToolboxNotice  string `json:"toolbox_notice,omitempty"`
}

type RestoredSession struct {
	MotherIdentity      *motherIdentityState
	MotherIdentities    map[string]*motherIdentityState
	ContextProvider     *contextport.State
	Compaction          *CompactionState
	WorkspaceGeneration int
	GenerationInput     bool
	GenerationEffect    bool
	GenerationMutation  bool
	GenerationUncertain bool
	Messages            []Message
	Checkpoint          *Checkpoint
	State               SessionState
	Draft               string
	Pending             Message
	Truncated           bool
	Plan                PlanEngine
	PlanHistory         map[int][]PlanTransition
	ShellHistory        map[int][]ShellResult
	PatchHistory        map[int][]PatchResult
	RecoveredTool       *ToolTurn
}

func SessionPath(configPath, id string) (string, error) {
	if err := ValidatePrivateProfile(configPath); err != nil {
		return "", err
	}
	if configPath == "" || !sessionIDPattern.MatchString(id) {
		return "", fmt.Errorf("会话编号无效")
	}
	return sessionservice.Path(PrivatePaths(configPath).Sessions, id)
}

func (a *SessionArchive) ID() string { return strings.TrimSuffix(filepath.Base(a.Path), ".jsonl") }

// 锁由操作系统持有，进程异常退出时自动释放，不依赖易过期的 PID 文件。
func (a *SessionArchive) Lock() error {
	if a.ephemeral {
		return nil
	}
	if a.unlock != nil {
		return nil
	}
	if a.attachmentConfig != "" && a.attachmentUnlock == nil {
		var err error
		a.attachmentUnlock, err = attachmentLease(a.attachmentConfig)
		if err != nil {
			return err
		}
	}
	unlock, err := lockSession(strings.TrimSuffix(a.Path, ".jsonl") + ".lock")
	if err != nil {
		if a.attachmentUnlock != nil {
			a.attachmentUnlock()
			a.attachmentUnlock = nil
		}
		return fmt.Errorf("会话正在其他窗口使用，或保存目录不可写: %w", err)
	}
	a.unlock = unlock
	return nil
}

func (a *SessionArchive) Close() {
	if a.unlock != nil {
		a.unlock()
		a.unlock = nil
	}
	if a.attachmentUnlock != nil {
		a.attachmentUnlock()
		a.attachmentUnlock = nil
	}
}

func RestoreSession(configPath, id string) (*SessionArchive, *RestoredSession, error) {
	file, err := SessionPath(configPath, id)
	if err != nil {
		return nil, nil, err
	}
	a := &SessionArchive{Path: file, attachmentConfig: configPath}
	if err = a.Lock(); err != nil {
		return nil, nil, err
	}
	r, err := a.read()
	if err != nil {
		a.Close()
		return nil, nil, err
	}
	if r.RecoveredTool != nil {
		if err = a.Append("tool_turn", *r.RecoveredTool); err != nil {
			a.Close()
			return nil, nil, err
		}
	}
	return a, r, nil
}

func (a *SessionArchive) read() (*RestoredSession, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	r := &RestoredSession{}
	var intent *ToolIntent
	progress := map[string]ToolReceipt{}
	visit := func(record sessionservice.Record) error {
		var err error
		switch record.Kind {
		case "runtime_context":
			if intent != nil {
				err = fmt.Errorf("runtime context interrupted an unsettled tool turn")
				break
			}
			var update runtimeContextUpdate
			update, err = decodeRuntimeContext(record.Value)
			if err == nil {
				r.Messages = append(r.Messages, update.Messages...)
			}
		case "message":
			var m Message
			if err = json.Unmarshal(record.Value, &m); err == nil {
				if m.Role != RoleUser && m.Role != RoleAssistant && m.Role != RoleTool {
					err = fmt.Errorf("不支持的消息角色")
				} else {
					r.Messages = append(r.Messages, m)
					if m.Role == RoleAssistant {
						r.Pending = Message{}
					}
					if m.Role == RoleAssistant || m.Role == RoleTool {
						r.GenerationEffect = true
					}
					if m.Role == RoleUser {
						r.Draft = ""
						r.GenerationInput = true
					}
				}
			}
		case "tool_intent":
			if intent != nil {
				err = fmt.Errorf("上一条工具执行尚未结算")
				break
			}
			var v ToolIntent
			if err = json.Unmarshal(record.Value, &v); err == nil {
				if v.InvocationID == "" || v.Response.Role != RoleAssistant || len(v.Response.ToolCalls) == 0 {
					err = fmt.Errorf("工具执行意图无效")
				} else {
					intent = &v
					progress = map[string]ToolReceipt{}
				}
			}
		case "tool_progress":
			if intent == nil {
				err = fmt.Errorf("工具收据缺少执行意图")
				break
			}
			var receipt ToolReceipt
			if err = json.Unmarshal(record.Value, &receipt); err == nil {
				found := false
				for _, call := range intent.Response.ToolCalls {
					if receipt.Key == intent.InvocationID+":"+call.ID && receipt.ArgumentHash == ToolArgumentHash(call) && json.Valid([]byte(receipt.Output)) {
						found = true
					}
				}
				if !found {
					err = fmt.Errorf("工具执行收据与意图不匹配")
				} else {
					progress[receipt.Key] = receipt
				}
			}
		case "tool_turn":
			var turn ToolTurn
			if err = json.Unmarshal(record.Value, &turn); err == nil {
				if intent != nil && intent.InvocationID != turn.InvocationID {
					err = fmt.Errorf("工具提交身份不匹配")
				} else {
					err = r.applyToolTurn(turn)
					if err == nil {
						intent = nil
						progress = map[string]ToolReceipt{}
					}
				}
			}
		case "context_provider":
			var migration contextProviderMigration
			if err = json.Unmarshal(record.Value, &migration); err == nil {
				if err = migration.State.Validate(); err == nil {
					if intent != nil || migration.Source != contextProviderSource(r.Messages, r.Checkpoint) {
						err = fmt.Errorf("上下文提供者迁移来源不匹配或工具尚未结算")
					} else if r.ContextProvider != nil && migration.State.Session != r.ContextProvider.Session {
						err = fmt.Errorf("上下文提供者不能跨会话迁移")
					} else {
						r.ContextProvider = &migration.State
						if migration.Checkpoint != nil {
							original, imported := migration.Checkpoint.Imported, r.Checkpoint
							copy := *migration.Checkpoint
							copy.Imported = nil
							if imported == nil {
								err = fmt.Errorf("迁移检查点缺少来源")
							} else {
								prior := *imported
								prior.Imported = nil
								if string(rawJSON(copy)) != string(rawJSON(prior)) || len(original) > 1 {
									err = fmt.Errorf("迁移不能改写已有检查点")
								} else {
									r.Checkpoint = migration.Checkpoint
								}
							}
						}
					}
				}
			}
		case "checkpoint":
			var cp Checkpoint
			if err = json.Unmarshal(record.Value, &cp); err == nil {
				if cp.Covered < 0 || cp.Covered > len(r.Messages) || len(cp.Summary.Goals) == 0 && cp.Segment == 0 && cp.Packet == "" {
					err = fmt.Errorf("检查点无效")
				} else if cp.Compaction != nil && (validateCompaction(cp.Compaction, len(r.Messages), true) != nil || cp.Compaction.Covered != cp.Covered || cp.Compaction.Packet != cp.Packet) {
					err = fmt.Errorf("检查点与上下文整理记录不匹配")
				} else {
					r.Checkpoint = &cp
					if cp.Compaction != nil {
						r.Compaction = cloneCompaction(cp.Compaction)
					}
				}
			}
		case "compaction_state":
			var v CompactionState
			if err = json.Unmarshal(record.Value, &v); err == nil {
				if err = validateCompaction(&v, len(r.Messages), false); err == nil {
					r.Compaction = &v
				}
			}
		case "mother_action":
			// Administrative evidence belongs to the same archive but never
			// becomes model input or a command to replay on reopening.
			err = validateMotherAudit(record.Value)
		case "mother_identity":
			var v motherIdentityState
			if err = json.Unmarshal(record.Value, &v); err == nil {
				err = restoreMotherIdentity(r, v)
			}
		case "reply_end":
			r.Pending = Message{}
		case "state":
			err = json.Unmarshal(record.Value, &r.State)
		case "draft":
			err = json.Unmarshal(record.Value, &r.Draft)
		case "reply_delta":
			var delta Message
			if err = json.Unmarshal(record.Value, &delta); err == nil {
				r.Pending.Role = RoleAssistant
				r.Pending.Content += delta.Content
				r.Pending.ReasoningContent += delta.ReasoningContent
			}
		case "meta": // 版本与创建时间供列表读取，不参与模型上下文。
			var meta struct {
				Generation int `json:"workspace_generation"`
			}
			if err = json.Unmarshal(record.Value, &meta); err == nil && meta.Generation > 0 && meta.Generation != r.WorkspaceGeneration {
				r.WorkspaceGeneration = meta.Generation
				r.GenerationInput, r.GenerationEffect = false, false
				r.GenerationMutation, r.GenerationUncertain = false, false
			}
		case "unexecuted_response", "compaction_deferred", "output_continuation":
			// 诊断回执只供核验；被预算拒绝的工具调用绝不能进入恢复上下文。
		default:
			return fmt.Errorf("会话含未知记录 %q，请更新程序后再恢复", record.Kind)
		}
		return err
	}
	var recovery sessionservice.Recovery
	var err error
	if a.ephemeral {
		recovery, err = sessionservice.ReplayMemory(a.memory, visit)
	} else {
		recovery, err = sessionservice.Replay(a.Path, visit)
	}
	if err != nil {
		return nil, err
	}
	r.Truncated = recovery.Truncated

	if intent != nil {
		turn, e := interruptedToolTurn(*intent, progress)
		if e != nil {
			return nil, e
		}
		if e = r.applyToolTurn(turn); e != nil {
			return nil, e
		}
		r.RecoveredTool = &turn
	}
	return r, nil
}

func (r *RestoredSession) applyToolTurn(turn ToolTurn) error {
	if err := ValidateToolTurn(turn); err != nil {
		return err
	}
	candidate := r.Plan.Clone()
	for _, receipt := range turn.Receipts {
		if err := candidate.Replay(receipt); err != nil {
			return err
		}
	}
	for i, receipt := range turn.Receipts {
		if chatRetryReadOnlyTool(turn.Messages[0].ToolCalls[i].Function.Name) {
			continue
		}
		r.GenerationMutation = true
		var status struct {
			State string `json:"state"`
			Error struct {
				Code string `json:"code"`
			} `json:"error"`
		}
		_ = json.Unmarshal([]byte(receipt.Output), &status)
		switch status.State {
		case "interrupted_unknown", "unknown", "running", "queued", "pending", "starting", "cancelling":
			r.GenerationUncertain = true
		}
		if status.Error.Code == "interrupted_unknown" {
			r.GenerationUncertain = true
		}
	}
	r.Plan = *candidate
	if scheduled := scheduledCompaction(turn); scheduled != nil {
		r.Compaction = scheduled
	}
	first := len(r.Messages)
	r.Messages = append(r.Messages, turn.Messages...)
	r.Pending = Message{}
	if r.PlanHistory == nil {
		r.PlanHistory = map[int][]PlanTransition{}
	}
	if r.ShellHistory == nil {
		r.ShellHistory = map[int][]ShellResult{}
	}
	if r.PatchHistory == nil {
		r.PatchHistory = map[int][]PatchResult{}
	}
	patches := map[string]*PatchResult{}
	transitions := map[string]*PlanTransition{}
	for _, receipt := range turn.Receipts {
		if receipt.Patch != nil {
			patches[receipt.Key] = receipt.Patch
		}
		if receipt.Transition != nil {
			transitions[receipt.Key] = receipt.Transition
		}
	}
	for i, call := range turn.Messages[0].ToolCalls {
		position := first + i + 2
		if call.Function.Name == "apply_patch" {
			if p := patches[turn.InvocationID+":"+call.ID]; p != nil {
				r.PatchHistory[position] = append(r.PatchHistory[position], *p)
			} else {
				var result PatchResult
				if json.Unmarshal([]byte(turn.Messages[i+1].Content), &result) == nil {
					r.PatchHistory[position] = append(r.PatchHistory[position], result)
				}
			}
		}
		if transition := transitions[turn.InvocationID+":"+call.ID]; transition != nil {
			r.PlanHistory[position] = append(r.PlanHistory[position], *transition)
		}
		if IsDisplayTool(call.Function.Name) || IsLegacyFileTool(call.Function.Name) {
			result, err := ToolDisplayResult(call, turn.Messages[i+1].Content)
			if err == nil {
				if call.Function.Name != "exec_command" && result.SessionID != 0 {
					continue // 进程的最终状态由元数据恢复，不重复展示每次轮询。
				}
				if result.Cmd == "" {
					var req ShellCommand
					_ = json.Unmarshal([]byte(call.Function.Arguments), &req)
					result.Cmd, result.Description = req.Cmd, req.Description
				}
				r.ShellHistory[position] = append(r.ShellHistory[position], result)
			}
		}
	}
	return nil
}

func (a *SessionArchive) Start(model string) error {
	if err := a.Lock(); err != nil {
		return err
	}
	if err := a.Append("meta", struct {
		Version int    `json:"version"`
		Created string `json:"created_at"`
	}{1, time.Now().UTC().Format(time.RFC3339)}); err != nil {
		return err
	}
	return a.Append("state", SessionState{Model: model})
}

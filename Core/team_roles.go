// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: teamRoleNames; teamHost; homeTeamRetired; retireFixedExecution; teamPermissions; teamGrantableToolbox; grantTeamToolbox; teamRoleTools; collaborationReady; teamRoleOn; teamReadinessNow; teamReadiness; teamReadyCache; collaborationReadiness; rolePoolProfile; roleProfile; teamNarration; silentRoundsLimit; teamMatrixContract; teamMatrixTeam; teamMatrixUnavailable; teamVisionPrompt; teamExecutionPrompt; teamContract; teamRolePrompt; teamToolboxCatalog; teamToolboxNames; softwareAPIManual; cloudReportManual; communityMutations; toolboxRouted; planActive; teamWorker; fastMemoryShared
// Impact: python -B scripts/code-atlas.py show Core/team_roles.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

// OS 内置主体：Eyra 直接执行简单任务，按复杂度切换专业身份或协作；
// Cota 专业编程与执行，Vaya 调查、情报与导航。每个实例独立上下文。
// 用户停用状态和实际工具授权始终由宿主核对。
// CLI 仍由母体直接工作。
import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/aieyra/aieyra-os/agent/official"
	toolcontract "github.com/aieyra/aieyra-os/tool/contract"
	"os"
	"slices"
	"strings"
	"sync"
	"time"
)

// The latent maintenance label is not a fourth dispatchable Agent.
func teamRoleNames() map[string]string {
	names := official.Names()
	names["subconscious"] = "潜意识"
	return names
}

// 桌面 OS 的主机：团队协同只在这里存在。
func (w *Workspace) teamHost() bool { return w != nil && w.Mode() == HostOS && !w.isTerminal() }

// 第109轮：首页 Eyra 只做母体，不再组建 Cota/Vaya 团队，也不派工给固定的 project/execution 队列。
// 编程任务经 agents program_send 委派给 Coding 程序；TeamCollaboration 现在只表示 Coding 的协作能力。
var homeTeamRetired = true

// Cota 接管 execution 角色。0.2.85 之前遗留的 Nova 待办在团队关闭时仍收尾，
// 不占位、不挡住配置；团队开启时保留给 Cota 继续。
// 第109轮：首页团队退役后，首页遗留的 Vaya、Cota 待办同样收尾（历史保留），不会在启动时被恢复执行；
// Coding 程序里的成员会话不在首页任务表里，也不受影响。
func (w *Workspace) retireFixedExecution() error {
	if !w.teamHost() || CurrentReleaseStage().TeamCollaboration && !homeTeamRetired {
		return nil
	}
	m := w.manager
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, job := range m.jobs {
		role := job.record.Spec.WorkspaceRole
		if role != WorkspaceExecution && (!homeTeamRetired || role != WorkspaceProject) || codingRecord(job.record) || !activeAgent(job.record.State) {
			continue
		}
		job.record.State = "interrupted"
		job.record.CompletedAt = time.Now().UTC().Format(time.RFC3339Nano)
		job.record.Error = "团队协同已关闭；历史保留，请由 Eyra 核对实际结果后继续。"
		if homeTeamRetired {
			job.record.Error = "首页团队已退役；历史保留，编程任务请交给 Coding。"
		}
		m.finishHumansLocked(job, "interrupted")
		if err := m.saveLocked(job); err != nil {
			return err
		}
	}
	return nil
}

// 各角色的默认工具由公开定义持有；成员工具箱按本次真实授权分配。
// 用户或 Eyra 可以在设置里收窄两人的基础工具（vision_tools / execution_tools）。
func (w *Workspace) teamPermissions(role string) []string {
	switch role {
	case WorkspaceMatrix:
		definition, _ := official.Role(role)
		// Saved role defaults do not bypass the product's current stage.
		// Filter a fresh slice so catalog defaults remain immutable.
		p := make([]string, 0, len(definition.DefaultTools))
		for _, name := range definition.DefaultTools {
			if stageToolAllowed(name) {
				p = append(p, name)
			}
		}
		if CurrentReleaseStage().Toolbox {
			for _, name := range toolboxCapabilities {
				if toolboxCapabilityEnabled(name) && !slices.Contains(p, name) {
					p = append(p, name)
				}
			}
		} else {
			p = append(p, "image_gen")
		}
		if w.askUserAvailable(role) {
			p = append(p, "ask_user")
		}
		if ready, _ := w.collaborationReady(); ready {
			p = append(p, "team")
		}
		return p
	case WorkspaceProject, WorkspaceExecution:
		if !CurrentReleaseStage().TeamCollaboration {
			return nil
		}
		tools := append([]string{"team"}, w.teamRoleTools(role)...)
		if granted, ok := w.teamGrants.Load(role); ok {
			tools = append(tools, granted.([]string)...)
		}
		return tools
	}
	return nil
}

// Eyra 派工时能分给 Vaya、Cota 的 toolbox 能力。以用户名义发布、要用户当面决定的不外分。
func teamGrantableToolbox() []string { return official.Team().GrantableToolbox }

// 这次派工分配的 toolbox；不带就收回。只能分 Eyra 自己正拥有的。
func (w *Workspace) grantTeamToolbox(ctx context.Context, role string, names []string) error {
	granted := []string{}
	for _, name := range names {
		if !slices.Contains(teamGrantableToolbox(), name) && !toolcontract.ValidPackageID(name) {
			return fmt.Errorf("toolbox %s cannot be assigned to a team role", name)
		}
		if !toolAllowed(ctx, name) {
			return fmt.Errorf("toolbox %s is not available to assign", name)
		}
		if toolcontract.ValidPackageID(name) {
			v, err := w.manager.versionedTool(ctx, name)
			if err != nil {
				return err
			}
			if err = versionedToolPermitted(ctx, v); err != nil {
				return err
			}
			child := WithToolPermissions(ctx, append(w.teamRoleTools(role), name))
			if err = versionedToolPermitted(child, v); err != nil {
				return fmt.Errorf("recipient lacks required tool capability: %w", err)
			}
		}
		if !slices.Contains(granted, name) {
			granted = append(granted, name)
		}
	}
	w.teamGrants.Store(role, granted)
	return nil
}

// 设置里没写就用默认；写了就只取可选范围里的，顺序按可选范围。
func (w *Workspace) teamRoleTools(role string) []string {
	definition, ok := official.Role(role)
	if !ok || role == WorkspaceMatrix {
		return nil
	}
	var chosen []string
	if s, err := Load(w.config); err == nil {
		if role == WorkspaceProject {
			chosen = s.VisionTools
		} else {
			chosen = s.ExecutionTools
		}
	}
	if chosen == nil {
		return definition.DefaultTools
	}
	var out []string
	for _, name := range definition.ToolChoices {
		if slices.Contains(chosen, name) {
			out = append(out, name)
		}
	}
	return out
}

// 协同只要求阶段开放、用户没关；Vaya、Cota 没选模型时用 Eyra 的模型。
func (w *Workspace) collaborationReady() (bool, []string) {
	r := w.teamReadinessNow()
	return r.ready, r.missing
}

// 这个角色现在能不能用：团队开着、用户没单独关掉。
func (w *Workspace) teamRoleOn(role string) bool {
	switch r := w.teamReadinessNow(); role {
	case WorkspaceProject:
		return r.vaya
	case WorkspaceExecution:
		return r.cota
	}
	return false
}

func (w *Workspace) teamReadinessNow() teamReadiness {
	if homeTeamRetired || !CurrentReleaseStage().TeamCollaboration || !w.teamHost() {
		return teamReadiness{}
	}
	// 界面每几百毫秒取一次快照；配置按修改时间缓存，设置一保存就生效。
	info, statErr := os.Stat(w.config)
	if statErr == nil {
		if cached, ok := teamReadyCache.Load(w.config); ok {
			if c := cached.(teamReadiness); c.modified.Equal(info.ModTime()) && c.size == info.Size() {
				return c
			}
		}
	}
	s, err := Load(w.config)
	if err != nil {
		return teamReadiness{missing: []string{"配置暂时无法读取"}}
	}
	ready, missing := s.collaborationReadiness()
	r := teamReadiness{ready: ready, missing: missing, vaya: s.TeamRoleOn(WorkspaceProject), cota: s.TeamRoleOn(WorkspaceExecution)}
	if statErr == nil {
		r.modified, r.size = info.ModTime(), info.Size()
		teamReadyCache.Store(w.config, r)
	}
	return r
}

type teamReadiness struct {
	modified time.Time
	size     int64
	ready    bool
	missing  []string
	vaya     bool
	cota     bool
}

var teamReadyCache sync.Map

func (s *Settings) collaborationReadiness() (bool, []string) {
	// 两个都关了就没有团队，Eyra 单独工作。
	if !s.TeamRoleOn(WorkspaceProject) && !s.TeamRoleOn(WorkspaceExecution) {
		return false, nil
	}
	return true, nil
}

// 角色模型档：必须在模型池里且启用。
func (s *Settings) rolePoolProfile(id string) *APIProfile {
	if s == nil || id == "" {
		return nil
	}
	for i := range s.APIProfiles {
		p := &s.APIProfiles[i]
		if p.ID == id && (p.Kind == "" || p.Kind == "chat") && (p.Enabled == nil || *p.Enabled) {
			return p
		}
	}
	return nil
}

// 角色在设置里选的模型；没有时由调用方回退到 Matrix。
func (s *Settings) roleProfile(role string) string {
	var id string
	switch role {
	case WorkspaceProject:
		id = s.VisionProfile
	case WorkspaceExecution:
		id = s.ExecutionProfile
	default:
		return ""
	}
	if s.rolePoolProfile(id) == nil {
		return ""
	}
	return id
}

func teamNarration() string { return runtimePrompt(official.Prompt(WorkspaceMatrix, "narration")) }

// 连续这么多轮只调工具不说话，就提醒一次。
const silentRoundsLimit = 2

func teamMatrixContract() string { return runtimePrompt(official.Prompt(WorkspaceMatrix, "contract")) }

func teamMatrixTeam() string { return runtimePrompt(official.Prompt(WorkspaceMatrix, "team")) }

func teamMatrixUnavailable(missing []string) string {
	reason := "it is switched off"
	if len(missing) > 0 {
		reason = "not configured: " + strings.Join(missing, "、")
	}
	return formatPromptText(runtimePrompt(official.Prompt(WorkspaceMatrix, "unavailable")), reason)
}

func teamVisionPrompt() string { return runtimePrompt(official.Prompt(WorkspaceProject, "role")) }

func teamExecutionPrompt() string { return runtimePrompt(official.Prompt(WorkspaceExecution, "role")) }

func (w *Workspace) teamContract(role string) string {
	switch role {
	case WorkspaceMatrix:
		stage := CurrentReleaseStage()
		contract := teamMatrixContract()
		if !stage.TeamCollaboration || !stage.Toolbox {
			contract = runtimePrompt(official.Prompt(WorkspaceMatrix, "base_stage"))
		}
		if ready, missing := w.collaborationReady(); ready {
			contract += teamMatrixTeam()
			if !w.teamRoleOn(WorkspaceProject) {
				contract += formatPromptText(runtimePrompt(official.Prompt(WorkspaceMatrix, "role_off")), official.Name(WorkspaceProject))
			}
			if !w.teamRoleOn(WorkspaceExecution) {
				contract += formatPromptText(runtimePrompt(official.Prompt(WorkspaceMatrix, "role_off")), official.Name(WorkspaceExecution))
			}
		} else if stage.TeamCollaboration && !homeTeamRetired {
			contract += teamMatrixUnavailable(missing)
		}
		return contract + teamNarration() + runtimePrompt(official.Prompt(WorkspaceMatrix, "delivery")) + baseContractTail()
	case WorkspaceProject, WorkspaceExecution:
		// All editable behavior layers are already in teamRolePrompt. The
		// runtime tail describes identity/protocol only, without a second persona.
		return workspaceRoleContract(role)
	}
	return workspaceRoleContract(role)
}

// Vaya、Cota 各有独立身份与上下文。
func teamRolePrompt(role string) string {
	switch role {
	case WorkspaceProject:
		return teamVisionPrompt()
	case WorkspaceExecution:
		return teamExecutionPrompt()
	}
	return ""
}

// 目录只列出这个角色实际获授权的工具，不出现“目录里有、实际不能用”。
func teamToolboxCatalog(ctx context.Context) string {
	if !toolboxAvailable(ctx) {
		return ""
	}
	return runtimePrompt("Matrix/工具说明/工具箱目录前缀.txt") + toolboxDiscoveryIndex(ctx) + "\n" + packageToolCatalogue(ctx)
}

func teamToolboxNames(ctx context.Context) []string {
	var names []string
	for _, entry := range toolboxDiscovery(ctx) {
		names = append(names, entry.Capability.Name)
	}
	return names
}

func softwareAPIManual() string { return runtimePrompt("Matrix/工具说明/软件接口.txt") }

func cloudReportManual() string { return runtimePrompt("Matrix/工具说明/云端上报.txt") }

// 发帖、上报这类以用户名义对外的动作，要求先征得同意（R7 安全迁移；计划 §8 第 4 条）。
var communityMutations = map[string]bool{"topic_publish": true, "reply": true, "topic_like": true, "topic_withdraw": true, "reply_withdraw": true, "topic_state": true, "moderate": true, "publish": true, "withdraw": true, "home_preferences": true, "center_publish_file": true, "center_withdraw": true, "center_install": true, "center_migrate": true, "center_apply": true}

// 把 toolbox 里的迁移工具转给原有执行器。原执行器的权限检查按原工具名进行，这里只为这一次调用补上。
func toolboxRouted(ctx context.Context, name string, raw json.RawMessage) (json.RawMessage, error) {
	var p map[string]any
	if len(raw) == 0 || json.Unmarshal(raw, &p) != nil {
		return nil, fmt.Errorf("arguments 必须为对象")
	}
	action, _ := p["action"].(string)
	confirmed, _ := p["confirmed"].(bool)
	target := ""
	switch name {
	case "community":
		target = "community"
		if communityMutations[action] && !confirmed {
			return nil, fmt.Errorf("这一步以用户名义对外发布：先用 ask_user 征得同意，再带 confirmed=true 调用")
		}
	case "cloud_report":
		switch {
		case action == "report_bug":
			if !confirmed {
				return nil, fmt.Errorf("上报会公开发布：先用 ask_user 征得同意，再带 confirmed=true 调用")
			}
			target, p["action"], p["type"] = "community", "topic_publish", "bug"
		case action == "receipt":
			target = "community"
		case strings.HasPrefix(action, "update_"):
			target, p["action"] = "updates", strings.TrimPrefix(action, "update_")
		default:
			return nil, fmt.Errorf("unknown cloud_report action")
		}
	case "software_api":
		target = "workspace"
		switch {
		case strings.HasPrefix(action, "update_"):
			target, p["action"] = "updates", strings.TrimPrefix(action, "update_")
		case workspaceDesktopAction(action), action == "connect", action == "theme", action == "theme_rollback", action == "model", action == "control", action == "sessions":
		case action == "collaboration_status", action == "collaboration_configure":
		default:
			return nil, nil // 交给 settings 服务
		}
	default:
		return nil, fmt.Errorf("未知工具")
	}
	args, _ := json.Marshal(p)
	if bound, ok := ctx.Value(programAgentContextKey{}).(programAgentContext); ok {
		return bound.routed(ctx, target, args)
	}
	allowed, _ := ctx.Value(toolPermissionsKey{}).(map[string]bool)
	widened := map[string]bool{target: true}
	for k, v := range allowed {
		widened[k] = v
	}
	ctx = context.WithValue(ctx, toolPermissionsKey{}, widened)
	result := executeWorkspaceTool(ctx, ToolCall{Function: FunctionCall{Name: target, Arguments: string(args)}})
	data, err := json.Marshal(result)
	if err != nil {
		return nil, err
	}
	var outcome struct {
		OK    *bool  `json:"ok"`
		Error string `json:"error"`
	}
	if json.Unmarshal(data, &outcome) == nil && outcome.OK != nil && !*outcome.OK && outcome.Error != "" {
		return data, fmt.Errorf("%s", outcome.Error)
	}
	return data, nil
}

// 当前有一份未结束的计划。
func planActive(e *PlanEngine) bool {
	return e != nil && e.State != nil && e.State.Status != "complete" && e.State.Status != "cancelled"
}

func teamWorker(role string) bool { return role == WorkspaceProject || role == WorkspaceExecution }

// Vaya、Cota 读取共享 fast memory 的只读参考。
func (w *Workspace) fastMemoryShared(settings *Settings, role string) bool {
	return w != nil && !w.contextMemoryOff.Load() && w.service != nil && w.split == nil && settings != nil && settings.MemoryEnabled && w.teamHost() && teamWorker(role)
}

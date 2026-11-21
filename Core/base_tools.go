// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: baseToolMode; baseToolNames; toolboxCapabilities; baseToolPermissions; toolboxAvailable; workflowAvailable; baseToolsSentence; baseContractTail; baseMatrixContract; baseTerminalContract
// Impact: python -B scripts/code-atlas.py show Core/base_tools.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	toolcontract "github.com/aieyra/aieyra-os/tool/contract"
	toolboxowner "github.com/aieyra/aieyra-os/tool/toolbox"
)

// beta 基础工具模式（README.md 运行时 · 基础工具 T1）：Eyra 只用五个基础工具——计划、补丁和三个 Shell 工具
// （exec_command 可前台、后台或 tty 运行，write_stdin 输入或等待，read_shell_output 续读）。
// 权限、模型定义、toolbox 目录、角色合同、工作流提示与完成门都从这里同源决定，
// 不留下"目录里有、实际不能用"或"要求调用已关闭工具才能结束"的合同。
var baseToolMode = true

// view_image 与 web_search 只在当前模型入口实际支持时才出现在工具清单里（UI设计知识库 形态 §15.11 V1/V2）；
// report 只在有报告查看器的 OS 桌面宿主、且角色原本有 workspace 权限时出现（见 Workspace.permissions）。
var baseToolNames = []string{"update_plan", "apply_patch", "terminal", "exec_command", "write_stdin", "read_shell_output", "view_image", "web_search", "report", "memory", "agents", "ask_user", "models", "image_gen"}

// toolbox 里的可选能力；一项都没授权时，toolbox 本身和它的目录都不出现。
var toolboxCapabilities = toolboxowner.Names()

func baseToolPermissions(permissions []string) []string {
	if !baseToolMode {
		return permissions
	}
	granted := map[string]bool{}
	for _, name := range permissions {
		granted[name] = true
	}
	var result []string
	for _, name := range baseToolNames {
		if granted[name] {
			result = append(result, name)
		}
	}
	return result
}

func toolboxAvailable(ctx context.Context) bool {
	if !toolboxContextEnabled(ctx) {
		return false
	}
	ctx = withOfficialToolAdmission(ctx)
	for _, entry := range toolboxowner.Catalog() {
		if toolboxBuiltinVisible(ctx, entry) {
			return true
		}
	}
	if allowed, ok := ctx.Value(toolPermissionsKey{}).(map[string]bool); ok {
		for name, granted := range allowed {
			if granted && toolcontract.VersionedID(name) && toolAllowed(ctx, name) {
				return true
			}
		}
	}
	return false
}

// 工作流交付（workspace 的 workflow_* 动作）只在 workspace 工具可用时才提示、才作为完成门。
func workflowAvailable(ctx context.Context) bool { return toolAllowed(ctx, "workspace") }

// OS 与 CLI 共用工具清单与结尾几句（CLI 同步，用户 2026-10-10 确认）：只换宿主名和叙述方式，结尾原文不动。
func baseToolsSentence() string { return runtimePrompt("Matrix/运行协定/基础工具.txt") }

func baseContractTail() string { return runtimePrompt("Matrix/运行协定/执行约定.txt") }

func baseMatrixContract() string { return runtimePrompt("Matrix/运行协定/单人桌面.txt") }

// 终端宿主（Aieyra CLI）：没有桌面、画布和文档页，长答案在 assistant content 里写全；连接由用户输入 /api 配置。
func baseTerminalContract() string { return runtimePrompt("Matrix/运行协定/命令行.txt") }

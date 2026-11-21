// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: AgentFailure; classifyAgentFailure; localErrorText; failureHeading; modelAvailabilityFailure; upstreamErrorText
// Impact: python -B scripts/code-atlas.py show Core/agent_failure.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"strings"
)

type AgentFailure struct {
	Code      string `json:"code"`
	Title     string `json:"title"`
	Origin    string `json:"origin"`
	Retryable bool   `json:"retryable"`
}

// These identities are emitted only by the local delivery boundary. Upstream
// messages with the same text do not establish an unfinished local execution.
var (
	errUnfinishedShell     = errors.New("agent ended while a shell process was still running; inspect receipts before accepting delivery")
	errUnfinishedExecution = errors.New("agent ended while an execution cell was still running; continue wait before delivery")
	errEmptyFinal          = errors.New("model ended without a deliverable")
)

// 只有结构化拒绝码可以证明拦截；预算、冷却和连接错误不得误归因。
func classifyAgentFailure(err error, baseURL string) *AgentFailure {
	if err == nil {
		return nil
	}
	f := &AgentFailure{Code: "unclassified", Title: "任务中断，原因待核实", Origin: "unknown"}
	var toolUnavailable *officialToolUnavailableError
	if errors.As(err, &toolUnavailable) {
		return &AgentFailure{"tool_package_disabled", "所需工具包不可用，请在工具设置中检查启用状态与版本；本轮记录已保留", "local", false}
	}
	var invalidTool *InvalidToolResponseError
	if errors.As(err, &invalidTool) {
		return &AgentFailure{"invalid_tool_response", invalidTool.Error(), "upstream", false}
	}
	var output *OutputLimitError
	if errors.As(err, &output) {
		return &AgentFailure{"output_limit", output.Error(), "upstream", false}
	}
	var thinking *LongThinkingError
	if errors.As(err, &thinking) {
		return &AgentFailure{"long_thinking", thinking.Error(), "transport", false}
	}
	var streamTimeout *modelResponseTimeout
	if errors.As(err, &streamTimeout) {
		switch streamTimeout.stage {
		case modelFirstResponseTimeout:
			return &AgentFailure{modelFirstResponseTimeout, "等待模型首个有效响应超时", "transport", true}
		case modelStreamIdleTimeout:
			return &AgentFailure{modelStreamIdleTimeout, "模型响应流长时间未收到新数据", "transport", true}
		}
	}
	text := strings.ToLower(err.Error())
	switch {
	case errors.Is(err, errUnfinishedShell):
		return &AgentFailure{"unfinished_shell", "模型已结束回复，但命令仍未完成", "local", false}
	case errors.Is(err, errUnfinishedExecution):
		return &AgentFailure{"unfinished_execution", "模型已结束回复，但执行仍未完成", "local", false}
	case errors.Is(err, errEmptyFinal):
		return &AgentFailure{"empty_final", "Eyra 结束了这一轮，但没有留下文字回复", "local", false}
	case strings.Contains(text, "mother repair budget exhausted"):
		return &AgentFailure{"mother_repair_limit", "本次主动修理已达到预算，原任务与回执保留", "local", false}
	case strings.Contains(text, "agent cumulative token budget exhausted"):
		return &AgentFailure{"task_token_limit", "本轮累计用量达到设置的任务预算", "local", false}
	case strings.Contains(text, "agent request budget exhausted"):
		return &AgentFailure{"task_request_limit", "本轮请求次数达到任务上限", "local", false}
	case strings.Contains(text, "context budget exhausted") || strings.Contains(text, "input exceeds model window"):
		return &AgentFailure{"context_limit", "输入与输出预留超出模型登记的上下文窗口；未识别型号使用 8K 保守值。请在连接设置中填写实际窗口或调低最大输出，原文已保留", "local", false}
	case errors.Is(err, context.Canceled):
		return &AgentFailure{"cancelled", "任务已停止", "local", false}
	case errors.Is(err, context.DeadlineExceeded):
		return &AgentFailure{"timeout", "本次等待超时", "transport", true}
	}
	var api *APIError
	if errors.As(err, &api) {
		f.Origin = "upstream"
		switch strings.ToLower(api.Code) {
		case "content_policy_violation", "content_filter", "policy_violation", "moderation_blocked":
			f.Code, f.Title = "provider_blocked", "上游明确拦截（来源待核实）"
			if u, e := url.Parse(baseURL); e == nil && u.Scheme == "https" && (u.Host == "api.openai.com" || u.Host == "api.deepseek.com") {
				f.Title = "官方拦截"
				f.Origin = "official"
			}
			return f
		case "accounts_cooling_down":
			return &AgentFailure{"account_cooling", "上游账号正在冷却，请稍后继续", "upstream", false}
		case "insufficient_quota", "quota_exhausted":
			return &AgentFailure{"quota", "上游账户额度不足", "upstream", false}
		}
		if api.StatusCode == 429 {
			return &AgentFailure{"rate_limit", "上游请求限流，请稍后继续", "upstream", true}
		}
		// 型号本身的问题：服务商名单常变（2026-10-10 实验台：下线、不可用、未开通、地区限制都曾只显示“原因待核实”）。
		if model := modelAvailabilityFailure(api); model != nil {
			return model
		}
		if api.StatusCode == 401 || api.StatusCode == 403 {
			if api.StatusCode == 403 && strings.Contains(strings.ToLower(api.Message), "free tier can only be used from within opencode") {
				return &AgentFailure{"provider_client_restriction", "此免费模型仅限 OpenCode 官方客户端使用", "upstream", false}
			}
			return &AgentFailure{"access_denied", "上游拒绝访问，请检查账号或权限", "upstream", false}
		}
		if api.StatusCode == 504 || api.StatusCode == 524 {
			return &AgentFailure{"provider_unavailable", "上游网关等待超时", "upstream", true}
		}
		if api.StatusCode >= 500 {
			return &AgentFailure{"provider_unavailable", "上游服务暂时不可用", "upstream", true}
		}
		// Structured terminal failures can arrive over HTTP 200. This recovery
		// classification does not change the request transport's retry policy.
		for _, kind := range []string{api.Code, api.Type} {
			switch strings.ToLower(strings.TrimSpace(kind)) {
			case "server_error", "overloaded", "overloaded_error":
				return &AgentFailure{"provider_unavailable", "上游服务暂时不可用", "upstream", true}
			}
		}
		// 认不出的上游错误：把上游原话（截短、去掉疑似凭据）告诉用户，而不是“原因待核实”。
		if text := upstreamErrorText(api); text != "" {
			f.Title = fmt.Sprintf("上游返回错误（HTTP %d）：%s", api.StatusCode, text)
		}
	}
	if kind := transientRequestError(err); kind != "" {
		return &AgentFailure{kind, "连接中断，本次请求未完成", "transport", true}
	}
	// 认不出的本机错误同样给出原话（去掉疑似凭据、只取第一行），不用一句“原因待核实”带过。
	if f.Origin == "unknown" {
		if text := localErrorText(err); text != "" {
			f.Title = "任务中断：" + text
		}
	}
	return f
}

func localErrorText(err error) string {
	text := strings.TrimSpace(strings.SplitN(err.Error(), "\n", 2)[0])
	text = credentialLike.ReplaceAllString(text, "$1***")
	if r := []rune(text); len(r) > 160 {
		text = string(r[:160]) + "…"
	}
	return text
}

func failureHeading(r AgentRecord) string {
	if r.Failure != nil {
		return r.Failure.Title
	}
	return fmt.Sprintf("任务未完成（%s）", r.State)
}

var (
	modelReplacement = regexp.MustCompile(`(?i)\buse\s+([A-Za-z0-9._:/-]+)\s+instead`)
	credentialLike   = regexp.MustCompile(`(?i)(sk-|bearer\s+|key[=:]\s*)[A-Za-z0-9._-]{8,}`)
)

func modelAvailabilityFailure(api *APIError) *AgentFailure {
	text := strings.ToLower(api.Type + " " + api.Code + " " + api.Message)
	switch {
	case api.StatusCode == 410 || strings.Contains(text, "deprecated") || strings.Contains(text, "decommissioned"):
		title := "这个模型已被服务商下线"
		if m := modelReplacement.FindStringSubmatch(api.Message); m != nil {
			title += "，可改用 " + m[1]
		}
		return &AgentFailure{"model_retired", title, "upstream", false}
	case strings.Contains(text, "regionerror") || strings.Contains(text, "not available in your country") || strings.Contains(text, "not available in your region"):
		return &AgentFailure{"model_region", "这个模型在当前地区不可用", "upstream", false}
	case strings.Contains(text, "not activated") || strings.Contains(text, "not been activated"):
		return &AgentFailure{"model_not_activated", "这个模型还没在服务商处开通", "upstream", false}
	case strings.Contains(text, "model is unavailable") || strings.Contains(text, "model not found") || strings.Contains(text, "model_not_found") || strings.Contains(text, "does not exist"):
		return &AgentFailure{"model_unavailable", "服务商暂时无法提供这个模型", "upstream", false}
	}
	return nil
}

func upstreamErrorText(api *APIError) string {
	text := api.Message
	if text == "" {
		text = strings.TrimSpace(api.Type + " " + api.Code)
	}
	text = credentialLike.ReplaceAllString(strings.Join(strings.Fields(text), " "), "[已隐藏]")
	if r := []rune(text); len(r) > 100 {
		text = string(r[:100]) + "…"
	}
	return text
}

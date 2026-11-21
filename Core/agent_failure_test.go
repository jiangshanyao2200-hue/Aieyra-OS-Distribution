// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestFailureRetainsLongThinkingRecoveryReason; TestFailureOriginRequiresEvidence; TestFailureStructuredServerErrorPreservesSpecificDecisions; TestFailureCompletionBoundaryRequiresLocalEvidence; TestFailureTitlesTellModelProblems
// Impact: python -B scripts/code-atlas.py show Core/agent_failure_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"errors"
	"fmt"
	"io"
	"strings"
	"testing"
)

func TestFailureRetainsLongThinkingRecoveryReason(t *testing.T) {
	for _, cause := range []error{context.DeadlineExceeded, io.ErrUnexpectedEOF} {
		err := fmt.Errorf("request: %w", &LongThinkingError{Seconds: 120, Err: cause})
		failure := classifyAgentFailure(err, "https://relay.invalid")
		if failure.Code != "long_thinking" || failure.Origin != "transport" || failure.Retryable || !strings.Contains(failure.Title, "120 秒") || !strings.Contains(failure.Title, "没有自动重试") {
			t.Fatalf("long thinking lost its recovery reason: %+v", failure)
		}
	}
	ordinary := classifyAgentFailure(context.DeadlineExceeded, "https://relay.invalid")
	if ordinary.Code != "timeout" || !ordinary.Retryable {
		t.Fatalf("ordinary timeout changed: %+v", ordinary)
	}
	spoof := classifyAgentFailure(errors.New((&LongThinkingError{Seconds: 120}).Error()), "https://relay.invalid")
	if spoof.Code == "long_thinking" {
		t.Fatal("untyped text must not establish a local retry decision")
	}
}

func TestFailureOriginRequiresEvidence(t *testing.T) {
	cases := []struct {
		err               error
		url, code, origin string
	}{
		{errors.New("agent cumulative token budget exhausted"), "https://api.openai.com", "task_token_limit", "local"},
		{errors.New("http2: server sent GOAWAY and closed the connection"), "https://api.openai.com", "connection_goaway", "transport"},
		{&APIError{StatusCode: 429, Code: "accounts_cooling_down"}, "https://relay.invalid", "account_cooling", "upstream"},
		{&APIError{StatusCode: 403, Message: "forbidden"}, "https://api.openai.com", "access_denied", "upstream"},
		{&APIError{StatusCode: 403, Message: "Free tier can only be used from within OpenCode"}, "https://opencode.ai/zen/v1", "provider_client_restriction", "upstream"},
		{&APIError{StatusCode: 400, Code: "content_policy_violation"}, "https://api.openai.com/v1", "provider_blocked", "official"},
		{&APIError{StatusCode: 400, Code: "content_policy_violation"}, "https://api.openai.com.evil.invalid/v1", "provider_blocked", "upstream"},
	}
	for _, c := range cases {
		f := classifyAgentFailure(c.err, c.url)
		if f.Code != c.code || f.Origin != c.origin {
			t.Fatalf("%+v", f)
		}
	}
}

func TestFailureStructuredServerErrorPreservesSpecificDecisions(t *testing.T) {
	for _, tc := range []struct {
		name, code, origin string
		err                error
		retryable          bool
	}{
		{"code", "provider_unavailable", "upstream", &APIError{StatusCode: 200, Code: "server_error", Message: responsesFailedMessage}, true},
		{"type", "provider_unavailable", "upstream", &APIError{StatusCode: 200, Type: "overloaded_error", Message: responsesFailedMessage}, true},
		{"overloaded code", "provider_unavailable", "upstream", &APIError{StatusCode: 200, Code: "overloaded"}, true},
		{"wrapped", "provider_unavailable", "upstream", fmt.Errorf("request: %w", &APIError{StatusCode: 200, Type: "server_error"}), true},
		{"policy wins", "provider_blocked", "upstream", &APIError{StatusCode: 200, Code: "content_policy_violation", Type: "server_error"}, false},
		{"quota wins", "quota", "upstream", &APIError{StatusCode: 200, Code: "insufficient_quota", Type: "server_error"}, false},
		{"cooling wins", "account_cooling", "upstream", &APIError{StatusCode: 200, Code: "accounts_cooling_down", Type: "server_error"}, false},
		{"rate limit wins", "rate_limit", "upstream", &APIError{StatusCode: 429, Code: "server_error"}, true},
		{"model wins", "model_unavailable", "upstream", &APIError{StatusCode: 200, Code: "server_error", Message: "Model is unavailable."}, false},
		{"permission wins", "access_denied", "upstream", &APIError{StatusCode: 403, Code: "server_error"}, false},
		{"unknown code", "unclassified", "upstream", &APIError{StatusCode: 200, Code: "new_provider_code", Message: responsesFailedMessage}, false},
		{"message only", "unclassified", "upstream", &APIError{StatusCode: 200, Message: responsesFailedMessage}, false},
		{"plain local spoof", "unclassified", "unknown", errors.New("HTTP 200 [server_error] " + responsesFailedMessage), false},
		{"plain type spoof", "unclassified", "unknown", errors.New("overloaded_error server_error"), false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			failure := classifyAgentFailure(tc.err, "https://relay.invalid")
			if failure == nil || failure.Code != tc.code || failure.Origin != tc.origin || failure.Retryable != tc.retryable {
				t.Fatalf("failure=%+v", failure)
			}
		})
	}
}

func TestFailureCompletionBoundaryRequiresLocalEvidence(t *testing.T) {
	cases := []struct {
		name, code, title, origin string
		err                       error
	}{
		{"shell", "unfinished_shell", "模型已结束回复，但命令仍未完成", "local", errUnfinishedShell},
		{"wrapped shell", "unfinished_shell", "模型已结束回复，但命令仍未完成", "local", fmt.Errorf("delivery: %w", errUnfinishedShell)},
		{"execution", "unfinished_execution", "模型已结束回复，但执行仍未完成", "local", errUnfinishedExecution},
		{"wrapped execution", "unfinished_execution", "模型已结束回复，但执行仍未完成", "local", fmt.Errorf("delivery: %w", errUnfinishedExecution)},
		{"untyped shell text", "unclassified", "任务中断：" + errUnfinishedShell.Error(), "unknown", errors.New(errUnfinishedShell.Error())},
		{"untyped execution text", "unclassified", "任务中断：" + errUnfinishedExecution.Error(), "unknown", errors.New(errUnfinishedExecution.Error())},
		{"upstream shell text", "unclassified", "上游返回错误（HTTP 400）：" + errUnfinishedShell.Error(), "upstream", &APIError{StatusCode: 400, Message: errUnfinishedShell.Error()}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			f := classifyAgentFailure(c.err, "https://relay.invalid")
			if f == nil || f.Code != c.code || f.Title != c.title || f.Origin != c.origin || f.Retryable {
				t.Fatalf("failure=%+v", f)
			}
		})
	}
}

// 2026-10-10 实验台实测到的上游原话：型号问题要说清楚，认不出的错误给原话，不给“原因待核实”。
func TestFailureTitlesTellModelProblems(t *testing.T) {
	cases := []struct {
		name, code, title string
		err               *APIError
	}{
		{"retired", "model_retired", "这个模型已被服务商下线，可改用 mimo-v2.6-flash-free", &APIError{StatusCode: 410, Type: "ModelDeprecated", Message: "Model mimo-v2.5-free has been deprecated. Use mimo-v2.6-flash-free instead."}},
		{"unavailable", "model_unavailable", "服务商暂时无法提供这个模型", &APIError{StatusCode: 400, Type: "server_error", Message: "Upstream request failed: Model is unavailable."}},
		{"not activated", "model_not_activated", "这个模型还没在服务商处开通", &APIError{StatusCode: 400, Code: "invalid_parameter_error", Message: "The product is not activated, please confirm that you have activated products and try again after activation."}},
		{"region", "model_region", "这个模型在当前地区不可用", &APIError{StatusCode: 403, Type: "RegionError", Message: "This model is not available in your country"}},
		{"free tier still wins", "provider_client_restriction", "此免费模型仅限 OpenCode 官方客户端使用", &APIError{StatusCode: 403, Type: "FreeTierError", Message: "OpenCode's free tier can only be used from within OpenCode"}},
		{"plain upstream text", "unclassified", "上游返回错误（HTTP 426）：Your client is outdated, token [已隐藏] [已隐藏]", &APIError{StatusCode: 426, Message: "Your client is outdated, token sk-abcdefghijklmnop sk-abcdefghijklmnopqrst"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			f := classifyAgentFailure(c.err, "https://relay.invalid")
			if f.Code != c.code || f.Title != c.title || f.Origin != "upstream" || f.Retryable {
				t.Fatalf("failure=%+v", f)
			}
		})
	}
}

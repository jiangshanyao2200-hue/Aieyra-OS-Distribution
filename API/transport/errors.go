// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: API/transport/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: APIError; Error; Hint; ParseAPIError; RetryAfter; TransientRequestError
// Impact: python -B scripts/code-atlas.py show API/transport/errors.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package transport

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"
	"syscall"
	"time"
)

// APIError 承载服务端返回的结构化错误。
type APIError struct {
	RetryAfter time.Duration
	// Transient：状态码本身不算临时，但这个型号上确实是偶发的（见 markGeminiTransient）。
	Transient  bool
	StatusCode int
	Type       string
	Code       string
	Message    string
	Raw        string
}

func (e *APIError) Error() string {
	switch {
	case e.Message != "" && e.Code != "":
		return fmt.Sprintf("HTTP %d [%s] %s", e.StatusCode, e.Code, e.Message)
	case e.Message != "":
		return fmt.Sprintf("HTTP %d %s", e.StatusCode, e.Message)
	case e.Raw != "":
		return fmt.Sprintf("HTTP %d %s", e.StatusCode, e.Raw)
	default:
		return fmt.Sprintf("HTTP %d %s", e.StatusCode, http.StatusText(e.StatusCode))
	}
}

// Hint 针对常见错误码给出可操作的修复建议。
// 官方错误码见 /zh-cn/quick_start/error_codes。
func (e *APIError) Hint() string {
	msg := strings.ToLower(e.Message)
	switch {
	case e.StatusCode == 401:
		return "鉴权失败：请检查「API配置」标签页中的 Key 是否完整、是否已被撤销。"
	case e.StatusCode == 402:
		return "余额不足：请检查当前供应商的余额或订阅，必要时充值。"
	case e.StatusCode == 403 && (strings.Contains(msg, "country") || strings.Contains(msg, "region") || strings.Contains(msg, "territory")):
		return "当前出口地区被供应商限制，请确认代理已开启并重试；必要时重新打开应用。"
	case e.StatusCode == 403 && strings.Contains(msg, "free tier can only be used from within opencode"):
		return "OpenCode 免费层限制为其官方客户端使用；此免费模型目前无法从 Aieyra 调用。"
	case e.StatusCode == 403:
		return "供应商拒绝访问，请检查当前模型的使用权限。"
	case e.StatusCode == 422:
		return "参数非法：通常是 max_tokens 超出上限，或 temperature/top_p 越界。"
	case e.StatusCode == 429:
		return "触发限速：请降低并发或稍后重试。"
	case e.StatusCode == 400 && strings.Contains(msg, "reasoning_content"):
		return "缺少 reasoning_content：携带 tools 的请求必须完整回传历史思考内容。"
	case e.StatusCode == 400 && strings.Contains(msg, "thinking"):
		return "thinking 参数不被接受：请核对当前模型的思考参数与接口协议。"
	case e.StatusCode == 400 && (strings.Contains(msg, "model") || strings.Contains(msg, "模型")):
		return "模型请求被拒绝：请核对供应商目录中的模型标识、当前可用性与参数。"
	case e.StatusCode == 404:
		return "路径不存在：请核对当前供应商的 Base URL 与接口协议。"
	case e.StatusCode >= 500:
		return "服务端错误：官方建议稍后重试。"
	}
	return ""
}

func ParseAPIError(resp *http.Response) error {
	// Raw 只保留前 8K 用于展示；Message 的判定用完整（限 1M）正文，
	// 否则长 message 被截断后 Hint()（依赖 reasoning_content/thinking/model
	// 关键字）直接失效，只剩一句空话。
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	full := strings.TrimSpace(string(raw))
	short := full
	if len(short) > 8192 {
		short = short[:8192]
	}
	apiErr := &APIError{StatusCode: resp.StatusCode, Raw: short, RetryAfter: RetryAfter(resp.Header.Get("Retry-After"), time.Now())}

	// 形态 1：标准 {error:{message,type,code}}。
	var envelope struct {
		Error struct {
			Message string `json:"message"`
			Type    string `json:"type"`
			Code    string `json:"code"`
		} `json:"error"`
	}
	if json.Unmarshal(raw, &envelope) == nil && (envelope.Error.Message != "" || envelope.Error.Type != "" || envelope.Error.Code != "") {
		apiErr.Message = envelope.Error.Message
		apiErr.Type = envelope.Error.Type
		apiErr.Code = envelope.Error.Code
		return apiErr
	}
	// 形态 2：网关常见的 {"error":"string"}。
	var strForm struct {
		Error string `json:"error"`
	}
	if json.Unmarshal(raw, &strForm) == nil && strForm.Error != "" {
		apiErr.Message = strForm.Error
		return apiErr
	}
	// 形态 3：扁平 {message/code/type}。
	var flat struct {
		Message string `json:"message"`
		Code    string `json:"code"`
		Type    string `json:"type"`
	}
	if json.Unmarshal(raw, &flat) == nil && (flat.Message != "" || flat.Type != "" || flat.Code != "") {
		apiErr.Message = flat.Message
		apiErr.Code = flat.Code
		apiErr.Type = flat.Type
		return apiErr
	}
	return apiErr
}

func RetryAfter(value string, now time.Time) time.Duration {
	if seconds, err := strconv.ParseInt(value, 10, 64); err == nil && seconds >= 0 {
		if seconds > 30 {
			return 31 * time.Second
		}
		return time.Duration(seconds) * time.Second
	}
	if until, err := http.ParseTime(value); err == nil && until.After(now) {
		return until.Sub(now)
	}
	return 0
}

func TransientRequestError(err error) string {
	var api *APIError
	if errors.As(err, &api) {
		// 额度不足和订阅限制不能靠重试恢复，即使中转将其标成 429/5xx。
		detail := strings.ToLower(api.Code + " " + api.Type + " " + api.Message)
		if strings.EqualFold(api.Code, "accounts_cooling_down") {
			return ""
		}
		for _, marker := range []string{"insufficient_quota", "quota_exhausted", "insufficient balance", "credit balance", "billing", "limit_reached", "quota exceeded", "额度不足", "余额不足"} {
			if strings.Contains(detail, marker) {
				return ""
			}
		}
		if api.Transient {
			return "http_" + strconv.Itoa(api.StatusCode)
		}
		if api.StatusCode == 408 || api.StatusCode == 429 || api.StatusCode == 500 || api.StatusCode == 502 || api.StatusCode == 503 || api.StatusCode == 504 {
			return "http_" + strconv.Itoa(api.StatusCode)
		}
		return ""
	}
	if errors.Is(err, context.Canceled) {
		return ""
	}
	if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
		return "unexpected_eof"
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return "timeout"
	}
	if errors.Is(err, syscall.ECONNRESET) || errors.Is(err, syscall.ECONNABORTED) || errors.Is(err, syscall.EPIPE) {
		return "connection_reset"
	}
	// Go's HTTP/2 GOAWAY error is not exported as a net.Error. Only classify
	// the transport's exact diagnostic, never an arbitrary provider body.
	if strings.Contains(err.Error(), "http2: server sent GOAWAY and closed the connection") {
		return "connection_goaway"
	}
	var network net.Error
	if errors.As(err, &network) && (network.Timeout() || network.Temporary()) {
		return "temporary_network"
	}
	return ""
}

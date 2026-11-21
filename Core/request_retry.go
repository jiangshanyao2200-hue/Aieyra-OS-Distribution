// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: RetryInfo; longThinkingCutoff; firstModelResponseTimeout; modelResponseTimeout; Error; Unwrap; LongThinkingError; Error; Unwrap; markGeminiTransient; retryContextKey; retryOptions; WithResponseRetry; withResponseRetryCallbacks; withoutRequestRetry; retryAfter; transientRequestError; streamAttempt; modelResponseEvent; retryStream
// Impact: python -B scripts/code-atlas.py show Core/request_retry.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"errors"
	"fmt"
	"github.com/aieyra/aieyra-os/api/transport"
	"github.com/aieyra/aieyra-os/contracts/protocol"
	"math/rand"
	"strconv"
	"strings"
	"sync"
	"time"
)

type RetryInfo = protocol.RetryInfo

// 长时间思考后响应仍未提交的失败请求不再自动原样重试。
var longThinkingCutoff = 90 * time.Second

const firstModelResponseTimeout = 72 * time.Second

const (
	modelFirstResponseTimeout = "first_response_timeout"
	modelStreamIdleTimeout    = "stream_idle_timeout"
)

type modelResponseTimeout struct {
	stage string
	wait  time.Duration
}

func (e *modelResponseTimeout) Error() string {
	if e.stage == modelStreamIdleTimeout {
		if e.wait <= 0 {
			return "模型响应流长时间未收到新数据"
		}
		return fmt.Sprintf("模型流持续 %.0f 秒未收到数据：%v", e.wait.Seconds(), context.DeadlineExceeded)
	}
	if e.wait <= 0 {
		return "等待模型首个有效响应超时"
	}
	return fmt.Sprintf("%.0f 秒内未收到模型首个有效响应：%v", e.wait.Seconds(), context.DeadlineExceeded)
}

func (*modelResponseTimeout) Unwrap() error { return context.DeadlineExceeded }

// LongThinkingError 表示模型长时间思考后的响应中断；零散正文或
// 尚未提交的工具参数不能证明本次响应已经完成。
type LongThinkingError struct {
	Seconds int
	Err     error
}

func (e *LongThinkingError) Error() string {
	return "模型响应在 " + strconv.Itoa(e.Seconds) + " 秒后中断，尚未完成；为避免重复长时间思考，没有自动重试。可以继续任务，或在模型设置里调低思考强度。"
}

func (e *LongThinkingError) Unwrap() error { return e.Err }

// Gemini 经中转偶发 400，同样的请求再发一次就过（2026-11-04 实测 12 次出现 1 次）；被拒的请求不计费，
// 仍受总共 3 次的上限约束。明确说请求太大的不算。
func markGeminiTransient(s *Settings, err error) error {
	var api *APIError
	if !errors.As(err, &api) || api.StatusCode != 400 || !strings.Contains(strings.ToLower(s.Model), "gemini") {
		return err
	}
	detail := strings.ToLower(api.Code + " " + api.Message)
	for _, marker := range []string{"too large", "too long", "exceed", "maximum", "context length", "token count"} {
		if strings.Contains(detail, marker) {
			return err
		}
	}
	api.Transient = true
	return err
}

type retryContextKey struct{}
type retryOptions struct {
	noRetry              bool
	resetPartial         bool
	afterAttempt         func(RetryInfo) error
	beforeRetry          func(RetryInfo) error
	delay                func(int) time.Duration
	firstResponseTimeout time.Duration
}

// 只有能清除未提交片段的消费者可以重新开始已经有输出的请求。
func WithResponseRetry(ctx context.Context, beforeRetry func(RetryInfo) error) context.Context {
	return withResponseRetryCallbacks(ctx, nil, beforeRetry)
}

// A finished attempt owns its bill even when cancellation stops the backoff.
// The next request is admitted separately, only after that wait has completed.
func withResponseRetryCallbacks(ctx context.Context, afterAttempt, beforeRetry func(RetryInfo) error) context.Context {
	return context.WithValue(ctx, retryContextKey{}, retryOptions{resetPartial: true, afterAttempt: afterAttempt, beforeRetry: beforeRetry})
}

// Startup surfaces errors immediately; normal task retry policy is unchanged.
func withoutRequestRetry(ctx context.Context) context.Context {
	return context.WithValue(ctx, retryContextKey{}, retryOptions{noRetry: true})
}

func retryAfter(value string, now time.Time) time.Duration { return transport.RetryAfter(value, now) }

func transientRequestError(err error) string { return transport.TransientRequestError(err) }

func streamAttempt(parent context.Context, first, idle time.Duration) (context.Context, func(), func()) {
	ctx, cancel := context.WithCancelCause(parent)
	var mu sync.Mutex
	started, stopped := false, false
	expires := time.Now().Add(first)
	var timer *time.Timer
	mu.Lock()
	timer = time.AfterFunc(first, func() {
		mu.Lock()
		defer mu.Unlock()
		if stopped {
			return
		}
		if remaining := time.Until(expires); remaining > 0 {
			timer.Reset(remaining)
			return
		}
		stopped = true
		if started {
			cancel(&modelResponseTimeout{stage: modelStreamIdleTimeout, wait: idle})
		} else {
			cancel(&modelResponseTimeout{stage: modelFirstResponseTimeout, wait: first})
		}
	})
	mu.Unlock()
	touch := func(event bool) {
		mu.Lock()
		defer mu.Unlock()
		if stopped || !started && !event || !time.Now().Before(expires) {
			return
		}
		started = true
		expires = time.Now().Add(idle)
	}
	return transport.WithStreamActivity(ctx, func() { touch(false) }), func() { touch(true) }, func() {
		mu.Lock()
		defer mu.Unlock()
		stopped = true
		timer.Stop()
		cancel(context.Canceled)
	}
}

func modelResponseEvent(event Event) bool {
	switch event.Kind {
	case EventDelta:
		return event.Text != ""
	case EventReasoning, EventReasoningStart, EventBodyPreparing, EventToolPreparing, EventResponse, EventDone:
		return true
	default:
		return false
	}
}

// 重试只包住模型请求；完整响应发布后即不可重放，更不包住工具执行器。
func (c *Client) retryStream(ctx context.Context, send func(Event) error, run func(context.Context, func(Event) error) error) error {
	options, _ := ctx.Value(retryContextKey{}).(retryOptions)
	first := options.firstResponseTimeout
	if first <= 0 {
		first = firstModelResponseTimeout
	}
	idle := c.http.Timeout
	if idle <= 0 {
		idle = firstModelResponseTimeout
	}
	for attempt := 1; ; attempt++ {
		if err := ctx.Err(); err != nil {
			return err
		}
		attemptCtx, responseStarted, cancel := streamAttempt(ctx, first, idle)
		partial, committed, reasoning := false, false, false
		outputBytes, started := 0, time.Now()
		var usage *Usage
		err := run(attemptCtx, inlineThinkingEvents(func(event Event) error {
			if modelResponseEvent(event) {
				responseStarted()
			}
			if event.Kind == EventDelta || event.Kind == EventReasoning {
				outputBytes += len(event.Text)
			}
			if event.Kind == EventResponse || event.Kind == EventDone {
				committed = true
			}
			if event.Kind == EventDelta && event.Text != "" || event.Kind == EventReasoning && event.Text != "" || event.Kind == EventToolPreparing {
				partial = true
			}
			if event.Kind == EventReasoningStart || event.Kind == EventReasoning {
				reasoning = true
			}
			if event.Kind == EventUsage {
				usage = event.Usage
			}
			return send(event)
		}))
		if cause := context.Cause(attemptCtx); err != nil && errors.Is(cause, context.DeadlineExceeded) {
			err = cause
		}
		cancel()
		if err == nil {
			return nil
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		category := transientRequestError(err)
		if options.noRetry || committed || category == "" || attempt >= 3 || partial && !options.resetPartial {
			return err
		}
		// A late partial sentence or tool-argument fragment is not a committed
		// response. Replaying it can repeat minutes of reasoning (Grok R97).
		if reasoning && time.Since(started) >= longThinkingCutoff {
			return &LongThinkingError{Seconds: int(time.Since(started).Seconds()), Err: err}
		}
		delay := time.Duration(1<<(attempt-1))*500*time.Millisecond + time.Duration(rand.Intn(251))*time.Millisecond
		if options.delay != nil {
			delay = options.delay(attempt)
		}
		var api *APIError
		if errors.As(err, &api) {
			if api.RetryAfter > 30*time.Second {
				return err
			}
			if api.RetryAfter > delay {
				delay = api.RetryAfter
			}
		}
		info := RetryInfo{Attempt: attempt + 1, MaxAttempts: 3, DelayMS: delay.Milliseconds(), Category: category, Partial: partial, Usage: usage, OutputBytes: outputBytes}
		if options.afterAttempt != nil {
			if err = options.afterAttempt(info); err != nil {
				return err
			}
		}
		if err = send(Event{Kind: EventRetry, Retry: &info}); err != nil {
			return err
		}
		timer := time.NewTimer(delay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return ctx.Err()
		case <-timer.C:
		}
		if err = ctx.Err(); err != nil {
			return err
		}
		if options.beforeRetry != nil {
			if err = options.beforeRetry(info); err != nil {
				return err
			}
		}
	}
}

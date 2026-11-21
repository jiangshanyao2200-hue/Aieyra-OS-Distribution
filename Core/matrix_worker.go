// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: MatrixWorkerFlag; modelWorkerRequest; modelWorkerFrame; modelWorkerUsageState; observe; modelWorkerAPIError; setError; modelWorkerTransportedError; Error; Unwrap; decodedError; RunMatrixModelWorker; completeAgentProcess; drainModelWorkerProcess; modelWorkerSettings; modelWorkerEnvironment
// Impact: python -B scripts/code-atlas.py show Core/matrix_worker.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

// The worker transports model requests only. The parent remains the sole owner
// of tools, human decisions, archives, request budgets and durable task state.
import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/aieyra/aieyra-os/api/adapter"
	"github.com/aieyra/aieyra-os/api/transport"
	"io"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"
)

const MatrixWorkerFlag = "--matrix-model-worker"

type modelWorkerRequest struct {
	ProfileConfig string              `json:"profile_config,omitempty"`
	APIAdapter    *adapter.Definition `json:"api_adapter,omitempty"`
	Settings      *Settings           `json:"settings"`
	EnvKey        bool                `json:"env_key"`
	Session       string              `json:"session"`
	Messages      []Message           `json:"messages"`
	Tools         []ToolDefinition    `json:"tools"`
	NoRetry       bool                `json:"no_retry,omitempty"`
}
type modelWorkerFrame struct {
	Kind                string                    `json:"kind"`
	Event               *Event                    `json:"event,omitempty"`
	Error               string                    `json:"error,omitempty"`
	ContextError        string                    `json:"context_error,omitempty"`
	APIError            *modelWorkerAPIError      `json:"api_error,omitempty"`
	LongThinkingSeconds *int                      `json:"long_thinking_seconds,omitempty"`
	OutputLimit         *OutputLimitError         `json:"output_limit,omitempty"`
	InvalidTool         *InvalidToolResponseError `json:"invalid_tool_response,omitempty"`
	Retry               *RetryInfo                `json:"retry,omitempty"`
	Answer              Message                   `json:"answer,omitempty"`
	Finish              string                    `json:"finish,omitempty"`
	Usage               *Usage                    `json:"usage,omitempty"`
}

// Accounting handshakes and ordered stream events use separate goroutines.
// Keep observed usage with the request that owned it across those boundaries.
type modelWorkerUsageState struct {
	pending       *Usage
	resetRequired int
	resetObserved int
}

func (s *modelWorkerUsageState) observe(f modelWorkerFrame) {
	switch f.Kind {
	case "event":
		if f.Event.Kind == EventRetry {
			s.pending = nil
			if f.Event.Retry != nil {
				s.resetObserved = max(s.resetObserved, f.Event.Retry.Attempt)
			}
		} else if f.Event.Kind == EventUsage && f.Event.Usage != nil && s.resetObserved >= s.resetRequired {
			value := *f.Event.Usage
			s.pending = &value
		}
	case "attempt":
		s.resetRequired = max(s.resetRequired, f.Retry.Attempt)
		if f.Retry.Usage != nil {
			value := *f.Retry.Usage
			s.pending = &value
		}
	case "retry":
		s.pending = nil
	}
}

// Preserve provider identity across the pipe without copying the raw response.
// Error keeps the original text, including any context added by a caller.
type modelWorkerAPIError struct {
	StatusCode int           `json:"status_code"`
	Type       string        `json:"type,omitempty"`
	Code       string        `json:"code,omitempty"`
	Message    string        `json:"message,omitempty"`
	RetryAfter time.Duration `json:"retry_after,omitempty"`
}

func (f *modelWorkerFrame) setError(err error) {
	if err == nil {
		return
	}
	f.Error = err.Error()
	// Only local typed causes establish cancellation/timeout identity. Provider
	// messages and legacy frames with the same words remain ordinary text.
	var streamTimeout *modelResponseTimeout
	switch {
	case errors.Is(err, context.Canceled):
		f.ContextError = "cancelled"
	case errors.As(err, &streamTimeout):
		f.ContextError = streamTimeout.stage
	case errors.Is(err, context.DeadlineExceeded):
		f.ContextError = "deadline_exceeded"
	}
	var invalidTool *InvalidToolResponseError
	if errors.As(err, &invalidTool) {
		copy := *invalidTool
		f.InvalidTool = &copy
	}
	var output *OutputLimitError
	if errors.As(err, &output) {
		copy := *output
		f.OutputLimit = &copy
	}
	var thinking *LongThinkingError
	if errors.As(err, &thinking) {
		seconds := thinking.Seconds
		f.LongThinkingSeconds = &seconds
	}
	var api *APIError
	if errors.As(err, &api) {
		f.APIError = &modelWorkerAPIError{api.StatusCode, api.Type, api.Code, api.Message, api.RetryAfter}
	}
}

type modelWorkerTransportedError struct {
	text  string
	cause error
}

func (e *modelWorkerTransportedError) Error() string { return e.text }
func (e *modelWorkerTransportedError) Unwrap() error { return e.cause }

func (f modelWorkerFrame) decodedError() error {
	var cause error
	if f.InvalidTool != nil {
		cause = f.InvalidTool
	}
	if f.OutputLimit != nil {
		cause = f.OutputLimit
	}
	if api := f.APIError; api != nil {
		cause = &APIError{StatusCode: api.StatusCode, Type: api.Type, Code: api.Code, Message: api.Message, RetryAfter: api.RetryAfter}
	}
	var contextErr error
	switch f.ContextError {
	case "cancelled":
		contextErr = context.Canceled
	case "deadline_exceeded":
		contextErr = context.DeadlineExceeded
	case modelFirstResponseTimeout, modelStreamIdleTimeout:
		contextErr = &modelResponseTimeout{stage: f.ContextError}
	}
	if contextErr != nil {
		cause = errors.Join(cause, contextErr)
	}
	if seconds := f.LongThinkingSeconds; seconds != nil && *seconds >= 0 {
		cause = &LongThinkingError{Seconds: *seconds, Err: cause}
	}
	if cause != nil {
		text := f.Error
		if text == "" {
			text = cause.Error()
		}
		return &modelWorkerTransportedError{text: text, cause: cause}
	}
	if f.Error != "" {
		return errors.New(f.Error)
	}
	return nil
}

// RunMatrixModelWorker is an internal entrypoint, never a separate executor.
// Credentials travel only through the inherited private stdin pipe.
func RunMatrixModelWorker(in io.Reader, out io.Writer) error {
	dec := json.NewDecoder(io.LimitReader(in, 32<<20))
	var request modelWorkerRequest
	if err := dec.Decode(&request); err != nil {
		return fmt.Errorf("worker request unavailable")
	}
	if request.Settings == nil || !sessionIDPattern.MatchString(request.Session) {
		return fmt.Errorf("invalid worker request")
	}
	if request.ProfileConfig != "" {
		releaseProfile, err := UsePrivateProfile(request.ProfileConfig)
		if err != nil {
			return err
		}
		defer releaseProfile()
	}
	request.Settings.envAPIKey = request.EnvKey
	if (request.APIAdapter == nil) != (request.Settings.apiAdapterSelection() == nil) {
		return fmt.Errorf("worker API adapter snapshot missing or unexpected")
	}
	if request.APIAdapter != nil {
		if err := request.APIAdapter.Validate(); err != nil {
			return err
		}
	}
	ctx, cancel := context.WithCancel(WithProviderSession(context.Background(), request.Session))
	defer cancel()
	acks := make(chan modelWorkerFrame)
	go func() {
		defer cancel()
		for {
			var ack modelWorkerFrame
			if dec.Decode(&ack) != nil {
				return
			}
			select {
			case acks <- ack:
			case <-ctx.Done():
				return
			}
		}
	}()
	var mu sync.Mutex
	enc := json.NewEncoder(out)
	emit := func(f modelWorkerFrame) error {
		mu.Lock()
		defer mu.Unlock()
		err := enc.Encode(f)
		if err != nil {
			cancel()
		}
		return err
	}
	requestAck := func(kind string, info RetryInfo) error {
		if err := emit(modelWorkerFrame{Kind: kind, Retry: &info}); err != nil {
			return err
		}
		select {
		case ack := <-acks:
			if ack.Kind != kind+"_ack" {
				return fmt.Errorf("invalid retry acknowledgement")
			}
			if ack.Error != "" {
				return errors.New(ack.Error)
			}
			return nil
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	ctx = withResponseRetryCallbacks(ctx, func(info RetryInfo) error { return requestAck("attempt", info) }, func(info RetryInfo) error { return requestAck("retry", info) })
	if request.NoRetry {
		ctx = withoutRequestRetry(ctx)
	}
	client := New(request.Settings)
	client.adapterSnapshot = request.APIAdapter
	answer, usage, err := completeAgentObserved(ctx, client, request.Settings, request.Messages, request.Tools, func(event Event) {
		f := modelWorkerFrame{Kind: "event", Event: &event}
		if event.Err != nil {
			f.setError(event.Err)
			event.Err = nil
		}
		if event.Message != nil {
			f.Finish = event.Message.FinishReason
		}
		_ = emit(f)
	})
	frame := modelWorkerFrame{Kind: "result", Answer: answer, Usage: usage, Finish: answer.FinishReason}
	frame.setError(err)
	return emit(frame)
}

func completeAgentProcess(ctx context.Context, settings *Settings, messages []Message, definitions []ToolDefinition, observe func(Event), started func(int) error) (answer Message, usage *Usage, resultErr error) {
	apiAdapter, err := resolveAPIAdapter(ctx, settings.Path(), settings.apiAdapterSelection())
	if err != nil {
		return Message{}, nil, err
	}
	exe, err := os.Executable()
	if err != nil {
		return Message{}, nil, err
	}
	command := exec.CommandContext(ctx, exe, MatrixWorkerFlag)
	command.Env = modelWorkerEnvironment(os.Environ())
	hideModelWorker(command)
	input, err := command.StdinPipe()
	if err != nil {
		return Message{}, nil, err
	}
	// 父stdin EOF使生产worker取消在途请求；只在超时后强制兜底。
	command.Cancel = func() error { _ = input.Close(); return nil }
	command.WaitDelay = 3 * time.Second
	output, err := command.StdoutPipe()
	if err != nil {
		input.Close()
		return Message{}, nil, err
	}
	// No inherited stderr output: a provider error must go through redaction.
	command.Stderr = io.Discard
	if err = command.Start(); err != nil {
		input.Close()
		return Message{}, nil, err
	}
	pendingUsage := modelWorkerUsageState{}
	defer func() {
		exited, stopErr := drainModelWorkerProcess(command, input)
		if resultErr == nil {
			if ctx.Err() != nil {
				resultErr = ctx.Err()
			} else {
				resultErr = stopErr
			}
		}
		// 只有真实Wait已确认退出，才把持久worker状态清零。
		if exited && started != nil {
			if err := started(0); err != nil && resultErr == nil {
				resultErr = err
			}
		}
		if usage == nil && resultErr != nil {
			usage = pendingUsage.pending
		}
	}()
	if started != nil {
		if err = started(command.Process.Pid); err != nil {
			return Message{}, nil, err
		}
	}
	session := transport.SessionID(ctx)
	enc := json.NewEncoder(input)
	options, _ := ctx.Value(retryContextKey{}).(retryOptions)
	if err = enc.Encode(modelWorkerRequest{ProfileConfig: settings.Path(), Settings: modelWorkerSettings(settings), APIAdapter: apiAdapter, EnvKey: settings.envAPIKey, Session: session, Messages: messages, Tools: definitions, NoRetry: options.noRetry}); err != nil {
		return Message{}, nil, err
	}
	dec := json.NewDecoder(output)
	for {
		var f modelWorkerFrame
		if err = dec.Decode(&f); err != nil {
			if ctx.Err() != nil {
				return Message{}, nil, ctx.Err()
			}
			return Message{}, nil, fmt.Errorf("model worker ended without a complete response: %w", err)
		}
		switch f.Kind {
		case "event":
			if f.Event == nil {
				return Message{}, nil, fmt.Errorf("missing worker event")
			}
			f.Event.Err = f.decodedError()
			if f.Event.Message != nil {
				f.Event.Message.FinishReason = f.Finish
			}
			pendingUsage.observe(f)
			if observe != nil {
				observe(*f.Event)
			}
		case "attempt", "retry":
			if f.Retry == nil {
				return Message{}, nil, fmt.Errorf("missing retry request")
			}
			var retryErr error
			options, _ := ctx.Value(retryContextKey{}).(retryOptions)
			if f.Kind == "attempt" {
				pendingUsage.observe(f)
				if options.afterAttempt != nil {
					retryErr = options.afterAttempt(*f.Retry)
				}
			} else {
				if options.beforeRetry != nil {
					retryErr = options.beforeRetry(*f.Retry)
				}
				if retryErr == nil {
					pendingUsage.observe(f)
				}
			}
			ack := modelWorkerFrame{Kind: f.Kind + "_ack"}
			if retryErr != nil {
				ack.Error = retryErr.Error()
			}
			if err = enc.Encode(ack); err != nil {
				return Message{}, nil, err
			}
		case "result":
			if ctx.Err() != nil {
				return Message{}, f.Usage, ctx.Err()
			}
			f.Answer.FinishReason = f.Finish
			return f.Answer, f.Usage, f.decodedError()
		default:
			return Message{}, nil, fmt.Errorf("unknown worker response")
		}
	}
}

func drainModelWorkerProcess(command *exec.Cmd, input io.WriteCloser) (bool, error) {
	_ = input.Close()
	done := make(chan error, 1)
	go func() { done <- command.Wait() }()
	timer := time.NewTimer(3 * time.Second)
	defer timer.Stop()
	select {
	case err := <-done:
		if err != nil {
			return true, fmt.Errorf("model_worker_stop_failed")
		}
		return true, nil
	case <-timer.C:
		_ = command.Process.Kill()
	}
	timer.Reset(3 * time.Second)
	select {
	case <-done:
		return true, fmt.Errorf("model_worker_stop_timeout")
	case <-timer.C:
		return false, fmt.Errorf("model_worker_stop_timeout")
	}
}

func modelWorkerSettings(settings *Settings) *Settings {
	minimal := *settings
	minimal.APIKeyHistory, minimal.ProviderConnections, minimal.APIProfiles = nil, nil, nil
	minimal.ProviderLastProfiles = nil
	minimal.SystemPrompt, minimal.PromptDir, minimal.loadedPrompt = "", "", ""
	if p := settings.activePoolProfile(); p != nil {
		profile := *p
		profile.APIKeyHistory = nil
		profile.APIKey = settings.APIKey
		minimal.APIProfiles = []APIProfile{profile}
		for _, c := range settings.ProviderConnections {
			if c.ID == p.ConnectionID {
				c.APIKeyHistory = nil
				c.APIKey = settings.APIKey
				minimal.ProviderConnections = append(minimal.ProviderConnections, c)
			}
		}
	}
	return &minimal
}

func modelWorkerEnvironment(environment []string) []string {
	var clean []string
	for _, pair := range environment {
		key, _, _ := strings.Cut(pair, "=")
		switch strings.ToUpper(key) {
		case "PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "PREFIX", "LANG", "LC_ALL", "TZ", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "SSL_CERT_FILE", "SSL_CERT_DIR", "GOMAXPROCS", "GOMEMLIMIT", "GOGC", "AIEYRA_RESOURCE_ROOT", "AIEYRA_ROOT":
			clean = append(clean, pair)
		}
	}
	return clean
}

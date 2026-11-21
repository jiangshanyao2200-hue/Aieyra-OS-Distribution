// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: ModelDiagnosticWorkerFlag; modelDiagnosticRequest; modelDiagnosticReply; modelDiagnostic; RunModelDiagnosticWorker
// Impact: python -B scripts/code-atlas.py show Core/model_diagnostic_worker.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/aieyra/aieyra-os/api/adapter"
	"github.com/aieyra/aieyra-os/api/transport"
)

const ModelDiagnosticWorkerFlag = "--model-diagnostic-worker"

type modelDiagnosticRequest struct {
	Config    string             `json:"config"`
	Profile   string             `json:"profile"`
	Identity  string             `json:"identity"`
	Selection *adapter.Selection `json:"selection"`
	Session   string             `json:"session"`
	TimeoutMS int                `json:"timeout_ms"`
	Body      json.RawMessage    `json:"body"`
}

type modelDiagnosticReply struct {
	OK     bool            `json:"ok"`
	Reply  json.RawMessage `json:"reply,omitempty"`
	Error  string          `json:"error,omitempty"`
	Status int             `json:"status,omitempty"`
	Hint   string          `json:"hint,omitempty"`
}

func modelDiagnostic(ctx context.Context, request modelDiagnosticRequest) (reply modelDiagnosticReply) {
	var secret string
	fail := func(err error) modelDiagnosticReply {
		message := err.Error()
		if secret != "" {
			message = strings.ReplaceAll(message, secret, "[redacted]")
		}
		result := modelDiagnosticReply{Error: message}
		var api *APIError
		if errors.As(err, &api) {
			result.Status = api.StatusCode
			result.Hint = api.Hint()
		}
		return result
	}
	if request.Config == "" || len(request.Config) > 4096 || request.Profile == "" || request.Selection == nil || request.Selection.Validate() != nil || len(request.Session) > 256 {
		return fail(fmt.Errorf("诊断缺少有效的配置所有者或API适配绑定"))
	}
	s, err := Load(request.Config)
	if err != nil {
		return fail(fmt.Errorf("无法读取诊断配置"))
	}
	s.ActiveProfile = request.Profile
	s.applyPoolProfile()
	s.applyRuntimeCredential()
	secret = s.APIKey
	if s.activePoolProfile() == nil || !sameAdapter(s.apiAdapterSelection(), request.Selection) || s.ProviderIdentity() != request.Identity {
		return fail(fmt.Errorf("模型或API适配绑定已变化，请刷新后重试"))
	}
	if p := s.activePoolProfile(); p.Enabled != nil && !*p.Enabled {
		return fail(fmt.Errorf("请先启用诊断模型"))
	}
	if err = s.ValidatePoolRequest(); err != nil {
		return fail(err)
	}
	var body map[string]json.RawMessage
	if len(request.Body) > 2<<20 || json.Unmarshal(request.Body, &body) != nil || body == nil {
		return fail(fmt.Errorf("诊断请求必须是最多2MiB的JSON对象"))
	}
	if value, ok := body["stream"]; ok && string(value) != "false" {
		return fail(fmt.Errorf("诊断只支持有界非流请求"))
	}
	if s.Protocol() != ProtocolGoogle {
		var model string
		if json.Unmarshal(body["model"], &model) != nil || model != s.Model {
			return fail(fmt.Errorf("诊断请求型号与选定模型不符"))
		}
	}
	limitName := "max_tokens"
	switch s.Protocol() {
	case ProtocolResponses:
		limitName = "max_output_tokens"
	case ProtocolGoogle:
		if json.Unmarshal(body["generationConfig"], &body) != nil {
			return fail(fmt.Errorf("诊断缺少输出上限"))
		}
		limitName = "maxOutputTokens"
	case ProtocolChat:
		if _, ok := body["max_completion_tokens"]; ok {
			limitName = "max_completion_tokens"
		}
	}
	var limit int
	if json.Unmarshal(body[limitName], &limit) != nil || limit < 1 || limit > 4096 {
		return fail(fmt.Errorf("诊断输出上限必须为1至4096"))
	}
	if request.TimeoutMS < 1 || request.TimeoutMS > int(firstModelResponseTimeout/time.Millisecond) {
		return fail(fmt.Errorf("诊断超时必须为1至72000毫秒"))
	}
	ctx, cancel := context.WithTimeout(WithProviderSession(ctx, request.Session), time.Duration(request.TimeoutMS)*time.Millisecond)
	defer cancel()
	definition, err := resolveAPIAdapter(ctx, request.Config, request.Selection)
	if err != nil {
		return fail(err)
	}
	client := transport.NewClient(time.Duration(request.TimeoutMS) * time.Millisecond)
	defer client.CloseIdleConnections()
	data, err := transport.DiagnosticJSON(ctx, client, transport.Connection{BaseURL: NormalizeBaseURL(s.BaseURL), Protocol: s.Protocol(), Model: s.Model, APIKey: s.APIKey, Adapter: definition}, request.Body)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			return fail(fmt.Errorf("诊断请求超时（%.0f 秒）", float64(request.TimeoutMS)/1000))
		}
		return fail(err)
	}
	return modelDiagnosticReply{OK: true, Reply: data}
}

// The host owns the config path. No credentials or private prompts travel in
// the command line or request. Closing stdin cancels the one admitted request.
func RunModelDiagnosticWorker(in io.Reader, out io.Writer) error {
	decoder := json.NewDecoder(io.LimitReader(in, (3<<20)+1))
	decoder.DisallowUnknownFields()
	var request modelDiagnosticRequest
	if err := decoder.Decode(&request); err != nil {
		return json.NewEncoder(out).Encode(modelDiagnosticReply{Error: "诊断输入无效"})
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() { var extra any; _ = decoder.Decode(&extra); cancel() }()
	return json.NewEncoder(out).Encode(modelDiagnostic(ctx, request))
}

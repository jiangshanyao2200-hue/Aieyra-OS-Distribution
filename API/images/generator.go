// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: API/images/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: Hooks; Generator; museImageSlots; NewGenerator
// Impact: python -B scripts/code-atlas.py show API/images/generator.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package images

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"github.com/aieyra/aieyra-os/api/catalog"
	"github.com/aieyra/aieyra-os/contracts/protocol"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// Hooks are per attempt. BeforeSubmit persists unknown accounting before any request;
// PreserveResponse saves paid bytes before parsing. No callback triggers a retry.
type Hooks struct {
	RequestID        string
	BeforeSubmit     func() error
	PreserveResponse func([]byte) error
	Usage            func(protocol.ImageUsage)
}
type Generator func(context.Context, protocol.ImageRequest, Hooks) ([]byte, error)

var museImageSlots sync.Map

func NewGenerator(baseURL, apiKey string, client *http.Client, inspect func([]byte) (string, error)) (Generator, error) {
	if inspect == nil {
		return nil, fmt.Errorf("image output validator is required")
	}
	u, err := url.Parse(strings.TrimRight(strings.TrimSpace(baseURL), "/"))
	if err != nil || u.Hostname() == "" || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Opaque != "" {
		return nil, fmt.Errorf("invalid image provider URL")
	}
	u.Path = strings.TrimRight(u.Path, "/")
	u.RawPath = ""
	endpoint := u.String()
	transport := http.Client{Timeout: 5 * time.Minute}
	if client != nil {
		transport = *client
	}
	if transport.Timeout == 0 {
		transport.Timeout = 5 * time.Minute
	}
	transport.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	return func(ctx context.Context, input protocol.ImageRequest, hooks Hooks) ([]byte, error) {
		if err := input.Validate(); err != nil {
			return nil, err
		}
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		muse := catalog.MuseKind(baseURL, input.Model)
		if muse != "" && muse != "image" {
			return nil, fmt.Errorf("所选 Muse 型号不是图片生成模型")
		}
		if muse == "image" {
			if input.Operation == "edit" || len(input.Images) > 0 || input.Mask != nil {
				return nil, fmt.Errorf("Muse 图片编辑和遮罩尚未验证，未提交请求")
			}
			slot, _ := museImageSlots.LoadOrStore(endpoint, make(chan struct{}, 1))
			select {
			case slot.(chan struct{}) <- struct{}{}:
				defer func() { <-slot.(chan struct{}) }()
			case <-ctx.Done():
				return nil, ctx.Err()
			}
		}
		body, contentType, err := requestBody(input)
		if muse == "image" {
			prompt := input.Prompt
			if input.Size != "auto" && input.Size != "" {
				prompt += "\nDesired framing: " + input.Size + "."
			}
			body, err = json.Marshal(map[string]any{"model": input.Model, "prompt": prompt, "n": 1, "response_format": "url"})
			contentType = "application/json"
		}
		if err != nil {
			return nil, err
		}
		route := "/images/generations"
		if input.Operation == "edit" {
			route = "/images/edits"
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint+route, bytes.NewReader(body))
		if err != nil {
			return nil, err
		}
		req.Header.Set("Content-Type", contentType)
		if requestID := hooks.RequestID; requestID != "" {
			req.Header.Set("X-Client-Request-Id", requestID)
			req.Header.Set("X-Request-ID", requestID)
		}
		if apiKey != "" {
			req.Header.Set("Authorization", "Bearer "+apiKey)
		}
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		if hooks.BeforeSubmit != nil {
			if err := hooks.BeforeSubmit(); err != nil {
				return nil, err
			}
		}
		response, err := transport.Do(req)
		if err != nil {
			return nil, &protocol.ImageProviderError{Message: "图片请求中断，结果待核对", Unknown: true}
		}
		defer response.Body.Close()
		if response.StatusCode < 200 || response.StatusCode >= 300 {
			return nil, &protocol.ImageProviderError{Message: fmt.Sprintf("图片接口返回 HTTP %d", response.StatusCode), Unknown: response.StatusCode >= 500 || response.StatusCode == 408}
		}
		data, err := io.ReadAll(io.LimitReader(response.Body, PaidResponseByteLimit+1))
		if err != nil || len(data) > PaidResponseByteLimit {
			return nil, &protocol.ImageProviderError{Message: "图片响应未完整接收，结果待核对", Unknown: true}
		}
		// Preserve paid responses before JSON/image validation. This never causes
		// an HTTP retry; malformed or incomplete output remains inspectable.
		if preserve := hooks.PreserveResponse; preserve != nil {
			if err := preserve(data); err != nil {
				return nil, &protocol.ImageProviderError{Message: "图片响应已返回但原始回执保存失败，勿重发", Unknown: true}
			}
		}
		decoded, err := Recover(ctx, data, Recovery{
			BaseURL: endpoint, Model: input.Model, Client: &transport, Inspect: inspect,
			Usage: hooks.Usage, BeforeDownload: func() error { return ctx.Err() },
		})
		if err != nil && ctx.Err() != nil {
			return nil, &protocol.ImageProviderError{Message: "图片已返回但处理被中断，原回执保留，勿重发", Unknown: true}
		}
		return decoded, err
	}, nil
}

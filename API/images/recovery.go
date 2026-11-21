// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: API/images/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: PaidResponseByteLimit; paidResponse; Recovery; readPaidResponse; receiptUsage; ReceiptUsage; Recover
// Impact: python -B scripts/code-atlas.py show API/images/recovery.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package images

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/aieyra/aieyra-os/api/catalog"
	"github.com/aieyra/aieyra-os/contracts/protocol"
)

const PaidResponseByteLimit = ((protocol.GeneratedImageByteLimit+2)/3)*4 + 65536

type paidResponse struct {
	Usage json.RawMessage `json:"usage"`
	Data  []struct {
		Base64 string `json:"b64_json"`
		URL    string `json:"url"`
	} `json:"data"`
}

// Recovery only reads a paid response and, when explicitly admitted, downloads
// its existing image. It never submits an image generation/edit request.
type Recovery struct {
	BaseURL, Model string
	Client         *http.Client
	Inspect        func([]byte) (string, error)
	BeforeDownload func() error
	Usage          func(protocol.ImageUsage)
}

func readPaidResponse(data []byte) (paidResponse, error) {
	var reply paidResponse
	if len(data) > PaidResponseByteLimit || json.Unmarshal(data, &reply) != nil {
		return reply, &protocol.ImageProviderError{Message: "图片接口响应异常，原回执保留，结果待核对", Unknown: true}
	}
	return reply, nil
}

func receiptUsage(raw json.RawMessage, baseURL, model string) *protocol.ImageUsage {
	u, err := url.Parse(baseURL)
	if err != nil || u.Hostname() == "" || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Opaque != "" || strings.TrimSpace(model) == "" || catalog.MuseKind(baseURL, model) != "" {
		return nil
	}
	return ParseUsage(raw)
}

// ReceiptUsage allows accounting-only recovery after the original image has
// already been saved. Unknown origins and Muse gateway estimates stay unknown.
func ReceiptUsage(data []byte, baseURL, model string) *protocol.ImageUsage {
	reply, err := readPaidResponse(data)
	if err != nil {
		return nil
	}
	return receiptUsage(reply.Usage, baseURL, model)
}

func Recover(ctx context.Context, data []byte, options Recovery) ([]byte, error) {
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	if options.Inspect == nil {
		return nil, fmt.Errorf("image output validator is required")
	}
	reply, err := readPaidResponse(data)
	if err != nil {
		return nil, err
	}
	if usage := receiptUsage(reply.Usage, options.BaseURL, options.Model); usage != nil && options.Usage != nil {
		options.Usage(*usage)
	}
	unknown := func(message string) ([]byte, error) {
		return nil, &protocol.ImageProviderError{Message: message, Unknown: true}
	}
	if len(reply.Data) != 1 {
		return unknown("图片接口响应异常，结果待核对")
	}
	var decoded []byte
	if reply.Data[0].Base64 != "" {
		decoded, err = base64.StdEncoding.Strict().DecodeString(reply.Data[0].Base64)
	} else if reply.Data[0].URL != "" {
		origin, e := url.Parse(options.BaseURL)
		if e != nil || origin.Hostname() == "" || origin.User != nil || origin.Opaque != "" || origin.RawQuery != "" || origin.Fragment != "" || (origin.Scheme != "http" && origin.Scheme != "https") {
			return unknown("无法确认原图片连接，未下载；原回执保留")
		}
		link, e := url.Parse(reply.Data[0].URL)
		if e != nil || link.User != nil || link.Opaque != "" || link.Fragment != "" || link.Hostname() == "" || (link.Scheme != "https" && !(link.Scheme == "http" && link.Host == origin.Host)) {
			return unknown("图片下载地址无效，结果待核对")
		}
		if options.BeforeDownload == nil {
			return unknown("原图片下载尚未授权，原回执保留")
		}
		if err := options.BeforeDownload(); err != nil {
			return nil, err
		}
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		download, e := http.NewRequestWithContext(ctx, http.MethodGet, link.String(), nil)
		if e != nil {
			return unknown("图片下载地址无效")
		}
		client := http.Client{Timeout: 5 * time.Minute}
		if options.Client != nil {
			client = *options.Client
		}
		if client.Timeout == 0 {
			client.Timeout = 5 * time.Minute
		}
		client.Jar = nil
		client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
		response, e := client.Do(download)
		if e != nil {
			return unknown("图片已生成但下载中断，请勿重复生成")
		}
		defer response.Body.Close()
		if response.StatusCode != http.StatusOK {
			return unknown("图片已生成但下载失败，请勿重复生成")
		}
		decoded, err = io.ReadAll(io.LimitReader(response.Body, protocol.GeneratedImageByteLimit+1))
	} else {
		return unknown("图片接口未返回图片，结果待核对")
	}
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	if err != nil || len(decoded) > protocol.GeneratedImageByteLimit {
		return unknown("返回图片未完整接收或超过 32 MiB，结果待核对")
	}
	if _, err := options.Inspect(decoded); err != nil {
		return unknown("返回图片损坏，结果待核对")
	}
	return decoded, nil
}

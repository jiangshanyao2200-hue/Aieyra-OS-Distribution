// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: API/transport/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: Trace; traceTransport; traceFileLimit; RoundTrip; traceBody; Read; Close
// Impact: python -B scripts/code-atlas.py show API/transport/trace.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package transport

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"time"
)

// 开发诊断：设置 AIEYRA_PROVIDER_TRACE=<目录> 时，每次模型请求的请求体和原始响应（含流式 SSE）原样存进该目录，
// 供多模型实验台查适配问题（2026-10-10：百炼 qwen3.8-flash 第二次请求的工具调用被判不完整，没有原始数据可查）。
// 只存请求体，不存请求头（Key 在请求头里）；每个文件最多 8MB；默认关闭。
func Trace(base http.RoundTripper) http.RoundTripper {
	dir := os.Getenv("AIEYRA_PROVIDER_TRACE")
	if dir == "" || os.MkdirAll(dir, 0o700) != nil {
		return base
	}
	return &traceTransport{base: base, dir: dir}
}

type traceTransport struct {
	base http.RoundTripper
	dir  string
	seq  atomic.Int64
}

const traceFileLimit = 8 << 20

func (t *traceTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	host := strings.NewReplacer(":", "_", "/", "_").Replace(req.URL.Host)
	name := filepath.Join(t.dir, fmt.Sprintf("%d-%03d-%s", time.Now().UnixMilli(), t.seq.Add(1), host))
	if req.GetBody != nil {
		if body, err := req.GetBody(); err == nil {
			data, _ := io.ReadAll(io.LimitReader(body, traceFileLimit))
			body.Close()
			_ = os.WriteFile(name+".request.json", data, 0o600)
		}
	}
	resp, err := t.base.RoundTrip(req)
	if err != nil {
		_ = os.WriteFile(name+".error.txt", []byte(err.Error()), 0o600)
		return nil, err
	}
	if file, e := os.OpenFile(fmt.Sprintf("%s.response-%d.txt", name, resp.StatusCode), os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600); e == nil {
		resp.Body = &traceBody{ReadCloser: resp.Body, file: file, left: traceFileLimit}
	}
	return resp, nil
}

type traceBody struct {
	io.ReadCloser
	file *os.File
	left int64
}

func (b *traceBody) Read(p []byte) (int, error) {
	n, err := b.ReadCloser.Read(p)
	if n > 0 && b.left > 0 {
		w := min(int64(n), b.left)
		_, _ = b.file.Write(p[:w])
		b.left -= w
	}
	return n, err
}

func (b *traceBody) Close() error {
	_ = b.file.Close()
	return b.ReadCloser.Close()
}

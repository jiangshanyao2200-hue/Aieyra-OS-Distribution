// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: API/videos/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: taskID; Hooks; Client; NewClient; Create; Status; request; DecodeTask; safeMediaURL; Download
// Impact: python -B scripts/code-atlas.py show API/videos/client.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Package videos implements the verified Muse JSON job protocol. Persistence,
// ownership, model selection and recovery belong to the calling host.
package videos

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/aieyra/aieyra-os/api/catalog"
	"github.com/aieyra/aieyra-os/contracts/protocol"
)

var taskID = regexp.MustCompile(`^task_[A-Za-z0-9_-]{1,155}$`)

type Hooks struct {
	BeforeSubmit     func() error
	PreserveResponse func([]byte) error
}

type Client struct {
	base, key string
	http      http.Client
}

func NewClient(base, key string, client *http.Client) (*Client, error) {
	base = strings.TrimRight(strings.TrimSpace(base), "/")
	if catalog.MuseKind(base, "muse-video") != "video" {
		return nil, fmt.Errorf("当前连接尚无已验证的Muse视频协议")
	}
	c := &Client{base: base, key: key, http: http.Client{Timeout: 60 * time.Second}}
	if client != nil {
		c.http = *client
	}
	if c.http.Timeout == 0 {
		c.http.Timeout = 60 * time.Second
	}
	c.http.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	return c, nil
}

// Create makes exactly one HTTP attempt. BeforeSubmit must durably record an
// unknown paid submission; the upstream does not deduplicate request IDs.
func (c *Client) Create(ctx context.Context, input protocol.VideoRequest, hooks Hooks) (protocol.VideoTask, error) {
	if err := input.Validate(); err != nil {
		return protocol.VideoTask{}, err
	}
	if catalog.MuseKind(c.base, input.Model) != "video" || hooks.BeforeSubmit == nil || hooks.PreserveResponse == nil {
		return protocol.VideoTask{}, fmt.Errorf("视频提交缺少已验证模型或持久回执边界")
	}
	body, err := json.Marshal(struct {
		protocol.VideoRequest
		Seconds string `json:"seconds"`
	}{input, strconv.Itoa(input.Duration)})
	if err != nil {
		return protocol.VideoTask{}, err
	}
	task, err := c.request(ctx, http.MethodPost, c.base+"/videos", body, "", hooks)
	if err == nil && task.Model != "" && task.Model != input.Model {
		return protocol.VideoTask{}, &protocol.VideoProviderError{Message: "视频回执模型不匹配，保留原回执，禁止重投", Unknown: true}
	}
	return task, err
}

// Status always uses the original base and public ID. It never substitutes an
// upstream ID, adds administrator channel headers, or creates another job.
func (c *Client) Status(ctx context.Context, id string, preserve func([]byte) error) (protocol.VideoTask, error) {
	if !taskID.MatchString(id) {
		return protocol.VideoTask{}, fmt.Errorf("视频任务ID无效")
	}
	return c.request(ctx, http.MethodGet, c.base+"/videos/"+id, nil, id, Hooks{PreserveResponse: preserve})
}

func (c *Client) request(ctx context.Context, method, endpoint string, body []byte, expected string, hooks Hooks) (protocol.VideoTask, error) {
	req, err := http.NewRequestWithContext(ctx, method, endpoint, bytes.NewReader(body))
	if err != nil {
		return protocol.VideoTask{}, err
	}
	if c.key != "" {
		req.Header.Set("Authorization", "Bearer "+c.key)
	}
	if method == http.MethodPost {
		req.Header.Set("Content-Type", "application/json")
	}
	if err = ctx.Err(); err != nil {
		return protocol.VideoTask{}, err
	}
	if hooks.BeforeSubmit != nil {
		if err = hooks.BeforeSubmit(); err != nil {
			return protocol.VideoTask{}, err
		}
	}
	unknown := method == http.MethodPost
	failure := func(message string) (protocol.VideoTask, error) {
		return protocol.VideoTask{}, &protocol.VideoProviderError{Message: message, Unknown: unknown}
	}
	response, err := c.http.Do(req)
	if err != nil {
		return failure("视频请求未取得完整回执；保留原任务，不能重新提交")
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, (1<<20)+1))
	if err != nil || len(raw) > 1<<20 {
		return failure("视频响应未完整接收；不能重新提交")
	}
	if hooks.PreserveResponse != nil {
		if err = hooks.PreserveResponse(raw); err != nil {
			return failure("视频回执保存失败；不能重新提交")
		}
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		// Even a failed response is preserved before classification. A 5xx
		// may follow upstream acceptance; its body can be useful for recovery.
		unknown = unknown && (response.StatusCode >= 500 || response.StatusCode == 408 || response.StatusCode >= 300 && response.StatusCode < 400)
		return failure(fmt.Sprintf("视频接口返回HTTP %d；原任务ID保留", response.StatusCode))
	}
	task, err := DecodeTask(raw, expected)
	if err != nil {
		return failure(err.Error())
	}
	return task, nil
}

// DecodeTask can recover a captured paid response without any network request.
func DecodeTask(raw []byte, expected string) (protocol.VideoTask, error) {
	var wire struct {
		ID, Model, Status, URL  string
		TaskID                  string `json:"task_id"`
		Progress                *int
		Video, Result, Metadata struct{ URL string }
	}
	// task_id needs its wire spelling; fields such as signed URLs stay private
	// in the caller's receipt and must be omitted from model-facing summaries.
	if len(raw) > 1<<20 || json.Unmarshal(raw, &wire) != nil {
		return protocol.VideoTask{}, fmt.Errorf("视频回执格式无效，保留原回执")
	}
	if wire.ID == "" {
		wire.ID = wire.TaskID
	}
	if !taskID.MatchString(wire.ID) || wire.TaskID != "" && wire.TaskID != wire.ID || expected != "" && wire.ID != expected {
		return protocol.VideoTask{}, fmt.Errorf("视频回执任务身份不匹配，保留原回执")
	}
	if wire.Status == "in_progress" {
		wire.Status = "processing"
	}
	switch wire.Status {
	case "queued", "processing", "completed", "failed":
	default:
		return protocol.VideoTask{}, fmt.Errorf("视频任务状态尚未识别，保留原回执")
	}
	if wire.Progress != nil && (*wire.Progress < 0 || *wire.Progress > 100) {
		wire.Progress = nil
	}
	media := wire.URL
	if media == "" {
		media = wire.Video.URL
	}
	if media == "" {
		media = wire.Result.URL
	}
	if media == "" {
		media = wire.Metadata.URL
	}
	if media != "" && !safeMediaURL(media) {
		return protocol.VideoTask{}, fmt.Errorf("视频下载地址无效，保留原回执")
	}
	return protocol.VideoTask{ID: wire.ID, Model: wire.Model, State: wire.Status, Progress: wire.Progress, URL: media}, nil
}

func safeMediaURL(raw string) bool {
	u, err := url.Parse(raw)
	return err == nil && u.Scheme == "https" && u.Hostname() != "" && u.User == nil && u.Opaque == "" && u.Fragment == "" && len(raw) <= 16384
}

// Download uses only a completed job's URL. No bearer, cookie jar or provider
// headers follow the media URL or redirects. No unimplemented /content route
// or cancellation request is synthesized.
func (c *Client) Download(ctx context.Context, task protocol.VideoTask, dst io.Writer) (int64, error) {
	if task.State != "completed" || !taskID.MatchString(task.ID) || !safeMediaURL(task.URL) || dst == nil {
		return 0, fmt.Errorf("视频尚无可下载的完成回执")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, task.URL, nil)
	if err != nil {
		return 0, err
	}
	download := c.http
	download.Jar = nil
	download.Timeout = 3 * time.Minute
	download.CheckRedirect = func(next *http.Request, via []*http.Request) error {
		if len(via) >= 5 || !safeMediaURL(next.URL.String()) {
			return fmt.Errorf("视频下载重定向无效")
		}
		next.Header = http.Header{}
		return nil
	}
	response, err := download.Do(req)
	if err != nil {
		return 0, fmt.Errorf("视频下载未完成，仍可查询和下载原任务")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK || response.ContentLength > protocol.GeneratedVideoByteLimit {
		return 0, fmt.Errorf("视频下载HTTP状态或大小无效，原任务保留")
	}
	n, err := io.Copy(dst, io.LimitReader(response.Body, protocol.GeneratedVideoByteLimit+1))
	if err != nil || n > protocol.GeneratedVideoByteLimit || n == 0 {
		return n, fmt.Errorf("视频下载不完整或超过256MiB，原任务保留")
	}
	return n, nil
}

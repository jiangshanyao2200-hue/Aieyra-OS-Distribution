// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: VideoGenManual; videoArgs; videoRecord; videoResult; videoScope; defaultVideoProfile; videoChoice; videoClientFactory; saveVideoRecord; readVideoRecord; videoSummary; applyVideoTask; runVideoGen; inspectVideoFile; finishVideoDownload; verifySavedVideo
// Impact: python -B scripts/code-atlas.py show Core/video_tasks.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/aieyra/aieyra-os/CORE/internal/privatefile"
	"github.com/aieyra/aieyra-os/api/catalog"
	apivideos "github.com/aieyra/aieyra-os/api/videos"
	"github.com/aieyra/aieyra-os/contracts/protocol"
	"github.com/aieyra/aieyra-os/contracts/storage"
	"github.com/aieyra/aieyra-os/tool/toolbox/official/videogen"
)

func VideoGenManual() string {
	if text, err := readPromptResource("Matrix/工具说明/视频生成.txt"); err == nil {
		return text
	}
	return videogen.Manual
}

type videoArgs struct {
	Action    string `json:"action"`
	RequestID string `json:"request_id"`
	ProfileID string `json:"profile_id"`
	Prompt    string `json:"prompt"`
	Duration  int    `json:"duration"`
	Size      string `json:"size"`
	Offset    int    `json:"offset"`
	Limit     int    `json:"limit"`
}

type videoRecord struct {
	Version      int                   `json:"version"`
	Scope        string                `json:"scope"`
	RequestID    string                `json:"request_id"`
	ProfileID    string                `json:"profile_id"`
	ConnectionID string                `json:"connection_id"`
	Base         string                `json:"base"`
	Input        protocol.VideoRequest `json:"input"`
	State        string                `json:"state"`
	Task         protocol.VideoTask    `json:"provider_task"` // Private, may contain a signed URL.
	Created      string                `json:"created"`
	LastQuery    int64                 `json:"last_query,omitempty"`
	Error        string                `json:"error,omitempty"`
	Media        *apivideos.Media      `json:"media,omitempty"`
	SHA256       string                `json:"sha256,omitempty"`
	Bytes        int64                 `json:"bytes,omitempty"`
	Submitted    bool                  `json:"submitted"`
}

type videoResult struct {
	Kind          string           `json:"kind"`
	RequestID     string           `json:"request_id"`
	State         string           `json:"state"`
	Model         string           `json:"model,omitempty"`
	TaskID        string           `json:"task_id,omitempty"`
	Progress      *int             `json:"progress,omitempty"`
	Submitted     bool             `json:"submitted"`
	UsageReported bool             `json:"usage_reported"`
	Path          string           `json:"path,omitempty"`
	SHA256        string           `json:"sha256,omitempty"`
	Bytes         int64            `json:"bytes,omitempty"`
	Media         *apivideos.Media `json:"media,omitempty"`
	Error         string           `json:"error,omitempty"`
	Recovery      string           `json:"recovery,omitempty"`
	Items         []videoResult    `json:"items,omitempty"`
	HasMore       bool             `json:"has_more,omitempty"`
}

// A runtime identity supplies ownership; no model argument can select another
// conversation's tasks. Primary OS roles use the durable home session ID.
func videoScope(ctx context.Context) (string, error) {
	if c, ok := ctx.Value(agentManagerKey{}).(agentManagerContext); ok && c.manager != nil {
		bound, valid := ctx.Value(conversationLinkCallerKey{}).(conversationLinkCaller)
		r, err := c.manager.Status(c.manager.owner, c.owner)
		if err != nil || !valid || bound.ID != r.ID || bound.Generation != r.Generation {
			return "", fmt.Errorf("视频调用缺少有效运行身份")
		}
		if !c.manager.primaryCoreLink(r) {
			return "agent:" + c.manager.owner + ":" + r.ID, nil
		}
	}
	if c, ok := ctx.Value(workspaceContextKey{}).(workspaceContext); ok && c.workspace != nil {
		c.workspace.mu.Lock()
		id, closed := c.workspace.state.ID, c.workspace.closed
		c.workspace.mu.Unlock()
		if id != "" && !closed {
			return "workspace:" + id, nil
		}
	}
	return "", fmt.Errorf("视频任务必须属于真实会话")
}

func defaultVideoProfile(config string) string {
	var raw struct {
		Profile string `json:"video_profile"`
	}
	data, err := os.ReadFile(config)
	if err != nil || json.Unmarshal(data, &raw) != nil {
		return ""
	}
	return strings.TrimSpace(raw.Profile)
}

func videoChoice(config, profileID string) (imageGenChoice, string, error) {
	s, err := Load(config)
	if err != nil {
		return imageGenChoice{}, "", fmt.Errorf("模型池暂时无法读取")
	}
	if profileID == "" {
		profileID = defaultVideoProfile(config)
	}
	if profileID == "" {
		return imageGenChoice{}, "", fmt.Errorf("请在模型连接中选择默认生视频模型，或指定可用视频模型")
	}
	c := resolveImageGenSettings(s, []string{profileID}, true, profileID)
	connection := ""
	for _, p := range s.APIProfiles {
		if p.ID == profileID {
			connection = p.ConnectionID
			break
		}
	}
	if !c.Ready {
		return c, connection, fmt.Errorf("%s", c.Reason)
	}
	if catalog.MuseKind(c.baseURL, c.Model) != "video" {
		return c, connection, fmt.Errorf("所选模型没有已验证的视频协议")
	}
	return c, connection, nil
}

var videoClientFactory = func(c imageGenChoice) (*apivideos.Client, error) {
	return apivideos.NewClient(c.baseURL, c.apiKey, nil)
}

func saveVideoRecord(dir string, r *videoRecord) error {
	data, err := json.Marshal(r)
	if err != nil {
		return err
	}
	return privatefile.Write(filepath.Join(dir, "task.json"), data)
}

func readVideoRecord(dir, scope, id string) (*videoRecord, error) {
	f, err := os.Open(filepath.Join(dir, "task.json"))
	if err != nil {
		return nil, err
	}
	defer f.Close()
	raw, err := io.ReadAll(io.LimitReader(f, (2<<20)+1))
	var r videoRecord
	if err != nil || len(raw) > 2<<20 || json.Unmarshal(raw, &r) != nil || r.Version != 1 || r.Scope != scope || r.RequestID != id || r.Input.Validate() != nil {
		return nil, fmt.Errorf("视频任务记录损坏或归属不符，保留原件，禁止重投")
	}
	switch r.State {
	case "prepared", "unknown", "queued", "processing", "ready", "failed", "completed":
	default:
		return nil, fmt.Errorf("视频任务状态无效，禁止重投")
	}
	if r.State == "prepared" && (r.Submitted || r.Task.ID != "") {
		return nil, fmt.Errorf("视频提交记录矛盾，禁止重投")
	}
	return &r, nil
}

func videoSummary(r *videoRecord, dir string) videoResult {
	v := videoResult{Kind: "video_gen", RequestID: r.RequestID, State: r.State, Model: r.Input.Model, TaskID: r.Task.ID, Progress: r.Task.Progress, Submitted: r.Submitted, Error: r.Error}
	switch r.State {
	case "unknown":
		v.Recovery = "原提交结果未知；使用原request_id的recover核对回执，禁止重复生成"
	case "prepared":
		v.Recovery = "任务已保存，submit才提交一次付费请求"
	case "queued", "processing":
		v.Recovery = "稍后用原request_id查询；停止本地等待不代表上游取消"
	case "ready":
		v.Recovery = "视频已生成，download后核对实际媒体"
	case "completed":
		v.Path = filepath.Join(dir, "video.mp4")
		v.Media = r.Media
		v.SHA256 = r.SHA256
		v.Bytes = r.Bytes
	}
	return v
}

func applyVideoTask(r *videoRecord, task protocol.VideoTask) {
	r.Task = task
	r.State = task.State
	if task.State == "completed" {
		r.State = "ready"
	}
	r.Error = ""
}

func runVideoGen(ctx context.Context, config string, raw json.RawMessage) (result videoResult, resultErr error) {
	result = videoResult{Kind: "video_gen", State: "rejected"}
	var a videoArgs
	if len(raw) > 32768 || decodeShellArgs(string(raw), &a) != nil {
		return result, fmt.Errorf("视频参数必须为有效对象")
	}
	if a.Action == "" {
		return result, fmt.Errorf("请指定视频任务操作")
	}
	ctx = context.WithValue(ctx, officialToolConfigKey{}, config)
	if !toolAllowed(ctx, "video_gen") {
		return result, fmt.Errorf("tool_not_assigned: video_gen")
	}
	if err := admitOfficialToolCall(ctx, ToolCall{Function: FunctionCall{Name: "video_gen", Arguments: string(raw)}}); err != nil {
		return result, err
	}
	scope, err := videoScope(ctx)
	if err != nil {
		return result, err
	}
	release, err := storage.Enter(config)
	if err != nil {
		return result, err
	}
	defer release()
	if err = ValidatePrivateProfile(config); err != nil {
		return result, err
	}
	root := filepath.Join(PrivatePaths(config).VideoTasks, workflowHash(scope))
	if a.Action == "list" {
		if a.Limit == 0 {
			a.Limit = 20
		}
		if a.Offset < 0 || a.Limit < 1 || a.Limit > 100 {
			return result, fmt.Errorf("分页无效")
		}
		entries, e := os.ReadDir(root)
		if e != nil && !os.IsNotExist(e) {
			return result, e
		}
		result.State = "completed"
		result.Items = []videoResult{}
		seen := 0
		for _, entry := range entries {
			if !entry.IsDir() || !imageBatchID.MatchString(entry.Name()) {
				continue
			}
			if seen < a.Offset {
				seen++
				continue
			}
			if len(result.Items) == a.Limit {
				result.HasMore = true
				break
			}
			r, e := readVideoRecord(filepath.Join(root, entry.Name()), scope, entry.Name())
			if e != nil {
				return result, e
			}
			result.Items = append(result.Items, videoSummary(r, filepath.Join(root, entry.Name())))
		}
		return result, nil
	}
	switch a.Action {
	case "create", "submit", "status", "query", "download", "recover":
	default:
		return result, fmt.Errorf("视频操作无效")
	}
	if !imageBatchID.MatchString(a.RequestID) {
		return result, fmt.Errorf("需要稳定request_id，最多96个字母、数字、短横线或下划线")
	}
	dir := filepath.Join(root, a.RequestID)
	if a.Action == "create" {
		if err = os.MkdirAll(dir, 0700); err != nil {
			return result, err
		}
	}
	if a.Action == "status" {
		r, e := readVideoRecord(dir, scope, a.RequestID)
		if e != nil {
			return result, e
		}
		return videoSummary(r, dir), nil
	}
	lock, err := os.OpenFile(filepath.Join(dir, "task.lock"), os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return result, err
	}
	defer lock.Close()
	if err = lockImageBatch(lock); err != nil {
		return result, fmt.Errorf("原视频任务正在处理；请status查询，勿重复创建")
	}
	r, err := readVideoRecord(dir, scope, a.RequestID)
	if a.Action == "create" {
		if err != nil && !os.IsNotExist(err) {
			return result, err
		}
		if r != nil {
			if a.ProfileID == "" {
				a.ProfileID = r.ProfileID
			}
			if r.ProfileID != a.ProfileID || r.Input.Prompt != a.Prompt || r.Input.Duration != a.Duration || r.Input.Size != a.Size {
				return result, fmt.Errorf("同一视频request_id不能改变生成参数")
			}
			return videoSummary(r, dir), nil
		}
		choice, connection, e := videoChoice(config, a.ProfileID)
		if e != nil {
			return result, e
		}
		input := protocol.VideoRequest{Model: choice.Model, Prompt: a.Prompt, Duration: a.Duration, Size: a.Size}
		if e = input.Validate(); e != nil {
			return result, e
		}
		r = &videoRecord{Version: 1, Scope: scope, RequestID: a.RequestID, ProfileID: choice.ProfileID, ConnectionID: connection, Base: choice.baseURL, Input: input, State: "prepared", Created: time.Now().UTC().Format(time.RFC3339Nano)}
		if e = saveVideoRecord(dir, r); e != nil {
			return result, e
		}
		return videoSummary(r, dir), nil
	}
	if err != nil {
		return result, err
	}
	defer func() {
		result = videoSummary(r, dir)
		if resultErr != nil {
			result.Error = resultErr.Error()
			if result.State == "completed" {
				result.State, result.Path = "unverified", ""
			}
		}
	}()
	if ctx.Err() != nil {
		return result, ctx.Err()
	}
	if a.Action == "recover" {
		if r.State != "unknown" {
			return result, nil
		}
		f, e := os.Open(filepath.Join(dir, "create.response.json"))
		if e != nil {
			return result, fmt.Errorf("原视频回执尚未保存完整；不得重新提交")
		}
		raw, e := io.ReadAll(io.LimitReader(f, (1<<20)+1))
		_ = f.Close()
		if e != nil {
			return result, fmt.Errorf("原视频回执读取失败；不得重新提交")
		}
		task, e := apivideos.DecodeTask(raw, r.Task.ID)
		if e != nil {
			return result, e
		}
		if task.Model != "" && task.Model != r.Input.Model {
			return result, fmt.Errorf("原视频回执模型与请求不符，保留原件")
		}
		applyVideoTask(r, task)
		return result, saveVideoRecord(dir, r)
	}
	if a.Action == "submit" && r.State != "prepared" {
		return result, nil
	}
	if a.Action == "download" && r.State == "completed" {
		return result, verifySavedVideo(dir, r)
	}
	if a.Action == "query" && (r.Task.ID == "" || r.State == "completed" || r.State == "failed") {
		return result, fmt.Errorf("原任务目前无需或无法远端查询，请先status/recover")
	}
	if a.Action == "download" && r.State != "ready" {
		return result, fmt.Errorf("视频尚未生成完成，请查询原任务")
	}
	resolve := func() (imageGenChoice, error) {
		if ctx.Err() != nil {
			return imageGenChoice{}, ctx.Err()
		}
		if !toolAllowed(ctx, "video_gen") {
			return imageGenChoice{}, fmt.Errorf("视频权限已撤销")
		}
		c, connection, e := videoChoice(config, r.ProfileID)
		if e != nil {
			return c, e
		}
		if c.baseURL != r.Base || c.Model != r.Input.Model || connection != r.ConnectionID {
			return c, fmt.Errorf("原视频连接已改变；恢复原绑定后查询，不能改投其他入口")
		}
		return c, nil
	}
	choice, err := resolve()
	if err != nil {
		return result, err
	}
	client, err := videoClientFactory(choice)
	if err != nil {
		return result, err
	}
	preserve := func(name string) func([]byte) error {
		return func(raw []byte) error { return privatefile.Write(filepath.Join(dir, name), raw) }
	}
	switch a.Action {
	case "submit":
		task, e := client.Create(ctx, r.Input, apivideos.Hooks{BeforeSubmit: func() error {
			current, e := resolve()
			if e != nil {
				return e
			}
			if current.apiKey != choice.apiKey {
				return fmt.Errorf("视频连接凭据已变化，请重新确认原任务")
			}
			r.State = "unknown"
			r.Submitted = true
			return saveVideoRecord(dir, r)
		}, PreserveResponse: preserve("create.response.json")})
		if e != nil {
			var provider *protocol.VideoProviderError
			if errors.As(e, &provider) && !provider.Unknown {
				r.State = "failed"
			}
			r.Error = e.Error()
			if saveErr := saveVideoRecord(dir, r); saveErr != nil {
				return result, saveErr
			}
			return result, e
		}
		applyVideoTask(r, task)
		return result, saveVideoRecord(dir, r)
	case "query":
		if time.Now().UnixMilli()-r.LastQuery < 5000 {
			return result, fmt.Errorf("查询间隔至少5秒，请稍后查看原任务")
		}
		r.LastQuery = time.Now().UnixMilli()
		if err = saveVideoRecord(dir, r); err != nil {
			return result, err
		}
		task, e := client.Status(ctx, r.Task.ID, preserve("query.response.json"))
		if e == nil && task.Model != "" && task.Model != r.Input.Model {
			e = fmt.Errorf("视频查询回执模型与原请求不符，保留原件")
		}
		if e != nil {
			r.Error = e.Error()
			if saveErr := saveVideoRecord(dir, r); saveErr != nil {
				return result, saveErr
			}
			return result, e
		}
		applyVideoTask(r, task)
		return result, saveVideoRecord(dir, r)
	case "download":
		if _, e := os.Stat(filepath.Join(dir, "video.mp4")); e == nil {
			return result, finishVideoDownload(dir, r)
		} else if !os.IsNotExist(e) {
			return result, e
		}
		partial := filepath.Join(dir, "video.partial")
		f, e := os.OpenFile(partial, os.O_CREATE|os.O_TRUNC|os.O_RDWR, 0600)
		if e != nil {
			return result, e
		}
		_, e = client.Download(ctx, r.Task, f)
		if e == nil {
			e = f.Sync()
		}
		closeErr := f.Close()
		if e == nil {
			e = closeErr
		}
		if e != nil {
			return result, e
		}
		if _, _, _, e = inspectVideoFile(partial); e != nil {
			return result, e
		}
		if e = os.Rename(partial, filepath.Join(dir, "video.mp4")); e != nil {
			return result, e
		}
		return result, finishVideoDownload(dir, r)
	}
	return result, fmt.Errorf("视频操作未执行")
}

func inspectVideoFile(path string) (apivideos.Media, string, int64, error) {
	var media apivideos.Media
	f, err := os.Open(path)
	if err != nil {
		return media, "", 0, err
	}
	defer f.Close()
	stat, err := f.Stat()
	if err != nil {
		return media, "", 0, err
	}
	media, err = apivideos.InspectMP4(f, stat.Size())
	if err != nil {
		return media, "", stat.Size(), err
	}
	hash := sha256.New()
	n, err := io.Copy(hash, io.LimitReader(f, protocol.GeneratedVideoByteLimit+1))
	if err != nil || n != stat.Size() {
		return media, "", n, fmt.Errorf("视频文件读取期间发生变化")
	}
	return media, hex.EncodeToString(hash.Sum(nil)), n, nil
}

func finishVideoDownload(dir string, r *videoRecord) error {
	media, digest, size, err := inspectVideoFile(filepath.Join(dir, "video.mp4"))
	if err != nil {
		return err
	}
	r.Media = &media
	r.SHA256 = digest
	r.Bytes = size
	r.State = "completed"
	r.Error = ""
	return saveVideoRecord(dir, r)
}

func verifySavedVideo(dir string, r *videoRecord) error {
	media, digest, size, err := inspectVideoFile(filepath.Join(dir, "video.mp4"))
	if err != nil {
		return err
	}
	if r.Media == nil || media != *r.Media || digest != r.SHA256 || size != r.Bytes {
		return fmt.Errorf("已完成视频文件与原回执不符，请保留原件核对")
	}
	return nil
}

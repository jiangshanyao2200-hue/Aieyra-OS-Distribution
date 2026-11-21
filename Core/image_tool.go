// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: imageByteLimit; imageRequestByteLimit; ImageRequest; ImageResult; toolImageInterpreterKey; toolImageObservation; toolImageInterpreter; SupportsToolImages; toolImagesKey; WithToolImages; ImageToolDefinition; viewImage; imageTools; imageToolAvailable; localImageObservation; imageLabel; readRequestImage; toolImage; imageResultFromCall
// Impact: python -B scripts/code-atlas.py show Core/image_tool.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

// 图片只在发送请求时编码；会话和工具日志保存不可变资产引用，避免反复落盘 base64。
import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"github.com/aieyra/aieyra-os/api/request"
	"github.com/aieyra/aieyra-os/contracts/storage"
	viewtool "github.com/aieyra/aieyra-os/tool/base/official/view_image"
	viewcontract "github.com/aieyra/aieyra-os/tool/base/official/view_image/contract"
	"image"
	"io"
	"os"
	"path/filepath"
	"strings"
)

const imageByteLimit = viewtool.ByteLimit
const imageRequestByteLimit = 24 << 20

type ImageRequest = viewcontract.Request
type ImageResult viewcontract.Result

type toolImageInterpreterKey struct{}
type toolImageObservation struct {
	Text, Source, Model, Language, Limitation string
	Truncated                                 bool
}
type toolImageInterpreter func(context.Context, ImageAttachment, string) (toolImageObservation, error)

func SupportsToolImages(s *Settings) bool {
	if s == nil {
		return false
	}
	if !s.GenericAdapter() {
		return s.Protocol() == ProtocolResponses && s.Model == ModelFlash
	}
	// 与 Desktop 的 image-capabilities.cjs 共用验收矩阵。目录声明和旧 vision
	// 布尔值不构成图片实测；能力必须绑定实际入口、模型、协议。
	if NormalizeBaseURL(s.BaseURL) == "https://opencode.ai/zen/go/v1" && s.Protocol() == ProtocolChat {
		return s.Model == "deepseek-v4-flash-vision-exp" || s.Model == "mimo-v2.6-flash"
	}
	return s.Protocol() == ProtocolChat && s.Model == "qwen3.8-flash" && verifiedBailianEndpoint(s.BaseURL)
}

type toolImagesKey struct{}

func WithToolImages(ctx context.Context, enabled bool) context.Context {
	return context.WithValue(ctx, toolImagesKey{}, enabled)
}

func ImageToolDefinition() ToolDefinition {
	d := viewtool.Definition()
	d.Description = runtimePrompt("Matrix/工具说明/查看图片.txt")
	return d
}

func (m *ShellManager) viewImage(ctx context.Context, call ToolCall) (ImageResult, []ImageAttachment) {
	if m.config != "" {
		ctx = context.WithValue(ctx, officialToolConfigKey{}, m.config)
	}
	if err := admitOfficialToolCall(ctx, call); err != nil {
		return ImageResult{State: "rejected", Error: &viewcontract.Error{Code: "tool_package_disabled", Message: err.Error()}}, nil
	}
	var req ImageRequest
	r := ImageResult{State: "rejected"}
	fail := func(code, message string) (ImageResult, []ImageAttachment) {
		r.Error = &viewcontract.Error{Code: code, Message: message}
		return r, nil
	}
	if err := decodeShellArgs(call.Function.Arguments, &req); err != nil {
		return fail("invalid_arguments", err.Error())
	}
	r.Path, r.Description = req.Path, req.Description
	if enabled, _ := ctx.Value(toolImagesKey{}).(bool); !enabled {
		return fail("image_unsupported", "当前模型未验证图片输入，且没有可用的视觉模型或本机OCR；请配置已验证的视觉模型")
	}
	if ctx.Err() != nil {
		return fail("cancelled", "图像读取已取消")
	}
	if p, ok := storage.Active(); ok {
		req.Path = p.Relocate(req.Path)
		req.Paths = append([]string(nil), req.Paths...)
		for i := range req.Paths {
			req.Paths[i] = p.Relocate(req.Paths[i])
		}
	}
	prepared, payload := viewtool.Prepare(ctx, m.root, req)
	r = ImageResult(prepared)
	if r.Error != nil {
		return r, nil
	}
	data, format := payload.Data, payload.Format
	sum := sha256.Sum256(data)
	hash := hex.EncodeToString(sum[:])
	dir := filepath.Join(m.dir, "images")
	if err := os.MkdirAll(dir, 0700); err != nil {
		return fail("persistence_failed", err.Error())
	}
	asset := filepath.Join(dir, hash+"."+format)
	m.imageMu.Lock()
	defer m.imageMu.Unlock()
	out, err := os.OpenFile(asset, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if os.IsExist(err) {
		old, e := os.ReadFile(asset)
		if e != nil || !bytes.Equal(old, data) {
			return fail("asset_conflict", "图片快照损坏，请检查会话资产目录")
		}
	} else if err != nil {
		return fail("persistence_failed", err.Error())
	} else {
		_, err = out.Write(data)
		if err == nil {
			err = out.Sync()
		}
		closeErr := out.Close()
		if err == nil {
			err = closeErr
		}
		if err != nil {
			return fail("persistence_failed", err.Error())
		}
	}
	r.OK, r.State, r.ImageID = true, "completed", hash
	attachment := ImageAttachment{Asset: asset, SHA256: hash, MIME: r.MIME, Detail: r.Detail, Width: r.Width, Height: r.Height, Bytes: len(data)}
	if interpret, ok := ctx.Value(toolImageInterpreterKey{}).(toolImageInterpreter); ok {
		observation, err := interpret(ctx, attachment, req.Description)
		if err != nil {
			r.OK = false
			r.State = "failed"
			r.Error = &viewcontract.Error{Code: "image_observation_failed", Message: err.Error()}
			return r, nil
		}
		if strings.TrimSpace(observation.Text) == "" {
			r.OK, r.State = false, "failed"
			r.Error = &viewcontract.Error{Code: "image_observation_empty", Message: "观察服务未返回内容，不能据此声称看到了图片"}
			return r, nil
		}
		r.Observation, r.ObservationSource, r.ObservationModel = observation.Text, observation.Source, observation.Model
		r.ObservationLanguage, r.ObservationTruncated, r.Limitation = observation.Language, observation.Truncated, observation.Limitation
		return r, nil
	}
	r.ObservationSource = "image_attachment"
	return r, []ImageAttachment{attachment}
}

// Every role uses this same adapter. Auxiliary vision requests stay in the
// original job's quota, cancellation and receipt scope; local OCR never claims
// understanding of shapes, colours or a scene without text.
func (m *AgentManager) imageTools(ctx context.Context, job *agentJob, selected *Settings) context.Context {
	vision := m.conversationImageSettings(selected)
	ctx = WithToolImages(ctx, SupportsToolImages(vision) || viewtool.OCRAvailable())
	if SupportsToolImages(selected) {
		return ctx
	}
	if SupportsToolImages(vision) {
		return context.WithValue(ctx, toolImageInterpreterKey{}, toolImageInterpreter(func(inner context.Context, image ImageAttachment, purpose string) (toolImageObservation, error) {
			answer, _, err := m.agentRequest(inner, job, vision, []Message{{Role: RoleSystem, Content: runtimePrompt("子代/模板/看图.txt")}, {Role: RoleUser, Content: purpose, Images: []ImageAttachment{image}}}, nil, "image")
			return toolImageObservation{Text: answer.Content, Source: "vision_model", Model: vision.Model}, err
		}))
	}
	if viewtool.OCRAvailable() {
		return context.WithValue(ctx, toolImageInterpreterKey{}, toolImageInterpreter(localImageObservation))
	}
	return ctx
}

func (m *AgentManager) imageToolAvailable(selected *Settings) bool {
	return SupportsToolImages(m.conversationImageSettings(selected)) || viewtool.OCRAvailable()
}

func localImageObservation(ctx context.Context, image ImageAttachment, _ string) (toolImageObservation, error) {
	observation := toolImageObservation{Source: "windows_ocr", Limitation: "仅提取图中文字，可能有识别错误；不能据此判断无文字画面的内容、颜色或布局。"}
	f, err := os.Open(image.Asset)
	if err != nil {
		return observation, err
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, imageByteLimit+1))
	if err != nil {
		return observation, err
	}
	sum := sha256.Sum256(data)
	if len(data) != image.Bytes || len(data) > imageByteLimit || hex.EncodeToString(sum[:]) != image.SHA256 {
		return observation, fmt.Errorf("OCR图片快照摘要不匹配")
	}
	result, err := viewtool.OCR(ctx, data)
	observation.Text, observation.Language, observation.Truncated = result.Text, result.Language, result.Truncated
	if err == nil && strings.TrimSpace(observation.Text) == "" {
		observation.Text = "本机OCR未识别到文字；这不代表图片为空或已理解画面。"
	}
	return observation, err
}

// The label that ties a user image to its name, so "@name" and "@图N" resolve.
func imageLabel(i int, a ImageAttachment) string {
	if a.Name == "" {
		return ""
	}
	if a.Label != "" {
		return fmt.Sprintf("[%s] %s", a.Label, a.Name)
	}
	return fmt.Sprintf("[图%d] %s", i+1, a.Name)
}

func readRequestImage(a ImageAttachment, remaining *int) request.Image {
	failure := func(reason string) request.Image {
		return request.Image{Text: formatPromptText(runtimePrompt("Matrix/辅助指令/图片未读取.txt"), a.SHA256, reason)}
	}
	if a.Bytes <= 0 || a.Bytes > imageByteLimit || a.Bytes > *remaining {
		return failure("image byte budget exceeded")
	}
	if a.MIME != "image/png" && a.MIME != "image/jpeg" && a.MIME != "image/gif" && a.MIME != "image/webp" {
		return failure("unsupported image format")
	}
	detail := a.Detail
	if detail == "" || detail == "original" {
		detail = "auto"
	}
	if detail != "auto" && detail != "low" && detail != "high" {
		return failure("invalid image detail")
	}
	f, err := os.Open(a.Asset)
	if err != nil {
		return failure("snapshot missing")
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, imageByteLimit+1))
	if err != nil {
		return failure("snapshot unreadable")
	}
	sum := sha256.Sum256(data)
	if len(data) != a.Bytes || hex.EncodeToString(sum[:]) != a.SHA256 {
		return failure("snapshot hash mismatch")
	}
	cfg, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || "image/"+format != a.MIME || cfg.Width != a.Width || cfg.Height != a.Height || cfg.Width < 1 || cfg.Height < 1 || cfg.Width > 8192 || cfg.Height > 8192 || int64(cfg.Width)*int64(cfg.Height) > 32000000 {
		return failure("snapshot format or dimensions mismatch")
	}
	*remaining -= len(data)
	return request.Image{DataURL: "data:" + a.MIME + ";base64," + base64.StdEncoding.EncodeToString(data), Detail: detail}
}

// 按指纹读回 view_image 存下的快照；读回后再核对一次哈希，文件被换过就拒绝。
func (m *ShellManager) toolImage(id string) (map[string]any, error) {
	if len(id) != 64 || strings.Trim(id, "0123456789abcdef") != "" {
		return nil, fmt.Errorf("invalid image id")
	}
	for _, format := range []string{"png", "jpeg", "gif", "webp"} {
		f, err := os.Open(filepath.Join(m.dir, "images", id+"."+format))
		if err != nil {
			continue
		}
		data, err := io.ReadAll(io.LimitReader(f, imageByteLimit+1))
		f.Close()
		if err != nil || len(data) > imageByteLimit {
			return nil, fmt.Errorf("image snapshot unreadable")
		}
		sum := sha256.Sum256(data)
		if hex.EncodeToString(sum[:]) != id {
			return nil, fmt.Errorf("image snapshot hash mismatch")
		}
		return map[string]any{"image_id": id, "mime": "image/" + format, "data": base64.StdEncoding.EncodeToString(data)}, nil
	}
	return nil, fmt.Errorf("image snapshot unavailable")
}

func imageResultFromCall(call ToolCall) ImageResult {
	var req ImageRequest
	_ = json.Unmarshal([]byte(call.Function.Arguments), &req)
	return ImageResult{State: "queued", Path: req.Path, Paths: req.Paths, Description: req.Description}
}

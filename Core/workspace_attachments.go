// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: composerLabel; composerSendRejection; Error; Unwrap; attachmentMessageHash; attachmentContent; prepareComposerAttachments
// Impact: python -B scripts/code-atlas.py show Core/workspace_attachments.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"github.com/aieyra/aieyra-os/contracts/storage"
	"image"
	"io"
	"os"
	"path/filepath"
	"strings"
	"unicode"
)

// composerLabel reports whether a label is well formed for its kind.
func composerLabel(a ComposerAttachment) bool {
	prefix := "文件"
	if a.Kind == "image" {
		prefix = "图"
	}
	n, ok := strings.CutPrefix(a.Label, prefix)
	return ok && len(n) >= 1 && len(n) <= 2 && n[0] >= '1' && n[0] <= '9' && strings.Trim(n, "0123456789") == ""
}

// This receipt is emitted only after request deduplication, while the owning
// task lock is held, and before a new message has been accepted.
type composerSendRejection struct {
	TaskID    string
	RequestID string
	Code      string
	Cause     error
}

func (e *composerSendRejection) Error() string { return e.Cause.Error() }
func (e *composerSendRejection) Unwrap() error { return e.Cause }

func attachmentMessageHash(text string, attachments []ComposerAttachment) string {
	if len(attachments) == 0 {
		return taskMessageHash(text)
	}
	data, _ := json.Marshal(struct {
		Text        string               `json:"text"`
		Attachments []ComposerAttachment `json:"attachments"`
	}{text, attachments})
	return fmt.Sprintf("%x", sha256.Sum256(data))
}

func attachmentContent(text string, attachments []ComposerAttachment) string {
	if len(attachments) == 0 {
		return text
	}
	manifest, _ := json.Marshal(attachments)
	return text + runtimePrompt("Matrix/辅助指令/用户附件清单.txt") + string(manifest)
}

func prepareComposerAttachments(config string, attachments []ComposerAttachment, settings *Settings) ([]ImageAttachment, error) {
	if err := ValidatePrivateProfile(config); err != nil {
		return nil, err
	}
	if len(attachments) > 10 {
		return nil, fmt.Errorf("每条消息最多添加 10 个附件")
	}
	root, err := filepath.Abs(PrivatePaths(config).Attachments)
	if err != nil {
		return nil, err
	}
	var images []ImageAttachment
	total, imageBytes := 0, 0
	labels := map[string]bool{}
	for _, a := range attachments {
		if a.Label != "" {
			if !composerLabel(a) || labels[a.Label] {
				return nil, fmt.Errorf("附件记录无效")
			}
			labels[a.Label] = true
		}
		hash, e := hex.DecodeString(a.SHA256)
		if e != nil || len(hash) != 32 || strings.ToLower(a.SHA256) != a.SHA256 || a.Name == "" || len(a.Name) > 1024 || strings.ContainsAny(a.Name, "/\\") || strings.IndexFunc(a.Name, unicode.IsControl) >= 0 || a.Bytes < 0 || a.Bytes > 32<<20 || (a.Kind != "file" && a.Kind != "image") {
			return nil, fmt.Errorf("附件记录无效")
		}
		asset := storage.Relocate(config, a.Asset)
		assetRoot := root
		if filepath.Clean(asset) == filepath.Join(root, "v2", a.SHA256) {
			assetRoot = filepath.Join(root, "v2")
		}
		if !filepath.IsAbs(asset) || filepath.Clean(asset) != filepath.Join(assetRoot, a.SHA256) {
			return nil, fmt.Errorf("附件不属于当前配置")
		}
		total += a.Bytes
		if total > 64<<20 {
			return nil, fmt.Errorf("附件合计超过 64 MiB")
		}
		stat, e := os.Lstat(asset)
		if e != nil || !stat.Mode().IsRegular() || stat.Size() != int64(a.Bytes) {
			return nil, fmt.Errorf("附件快照缺失或大小已变化")
		}
		// Reject redirects beneath the snapshot root, including directory links.
		realRoot, e := filepath.EvalSymlinks(assetRoot)
		if e != nil {
			return nil, fmt.Errorf("附件目录不可用")
		}
		realAsset, e := filepath.EvalSymlinks(asset)
		if e != nil || filepath.Clean(realAsset) != filepath.Join(realRoot, a.SHA256) {
			return nil, fmt.Errorf("附件快照路径已变化")
		}
		f, e := os.Open(asset)
		if e != nil {
			return nil, fmt.Errorf("附件快照不可读")
		}
		data, e := io.ReadAll(io.LimitReader(f, int64(a.Bytes)+1))
		_ = f.Close()
		if e != nil || len(data) != a.Bytes || fmt.Sprintf("%x", sha256.Sum256(data)) != a.SHA256 {
			return nil, fmt.Errorf("附件快照摘要不匹配，待发送消息已保留")
		}
		if len(a.WebReference) > 0 {
			var claimed, stored map[string]any
			if a.Kind != "file" || len(data) > 60000 || json.Unmarshal(a.WebReference, &claimed) != nil || json.Unmarshal(data, &stored) != nil || claimed == nil || stored == nil {
				return nil, fmt.Errorf("网页引用快照无效")
			}
			left, _ := json.Marshal(claimed)
			right, _ := json.Marshal(stored)
			if !bytes.Equal(left, right) {
				return nil, fmt.Errorf("网页引用与保存的快照不一致")
			}
		}
		cfg, format, imageErr := image.DecodeConfig(bytes.NewReader(data))
		if a.Kind == "file" {
			if imageErr == nil || a.MIME != "application/octet-stream" {
				return nil, fmt.Errorf("图片必须作为图片附件发送")
			}
			continue
		}
		imageBytes += a.Bytes
		if imageErr != nil || (format != "png" && format != "jpeg" && format != "gif") || a.MIME != "image/"+format || a.Bytes > imageByteLimit || imageBytes > imageRequestByteLimit || cfg.Width < 1 || cfg.Height < 1 || cfg.Width > 8192 || cfg.Height > 8192 || int64(cfg.Width)*int64(cfg.Height) > 32000000 {
			return nil, fmt.Errorf("图片格式、尺寸或大小超过限制")
		}
		if _, _, err := image.Decode(bytes.NewReader(data)); err != nil {
			return nil, fmt.Errorf("图片内容不完整或损坏，请重新添加")
		}
		if SupportsToolImages(settings) {
			images = append(images, ImageAttachment{Name: a.Name, Label: a.Label, Asset: asset, SHA256: a.SHA256, MIME: a.MIME, Detail: "auto", Bytes: a.Bytes, Width: cfg.Width, Height: cfg.Height})
		}
	}
	return images, nil
}

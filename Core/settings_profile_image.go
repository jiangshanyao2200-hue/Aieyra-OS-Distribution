// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: profileImagePatch; profileImage
// Impact: python -B scripts/code-atlas.py show Core/settings_profile_image.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"github.com/aieyra/aieyra-os/contracts/storage"
	viewtool "github.com/aieyra/aieyra-os/tool/base/official/view_image"
	"image"
	"image/png"
	"io"
	"math"
	"os"
	"path/filepath"
	"strings"
)

// Decode the actual local image once and pass the same small PNG representation
// as the profile editor. The model never needs to generate or echo base64.
func profileImagePatch(args json.RawMessage, profiles ...string) (map[string]any, string, error) {
	var p struct {
		Path     string `json:"path"`
		Field    string `json:"field"`
		Expected string `json:"expected_version"`
	}
	d := json.NewDecoder(bytes.NewReader(args))
	d.DisallowUnknownFields()
	if err := d.Decode(&p); err != nil {
		return nil, "", err
	}
	if !filepath.IsAbs(p.Path) || p.Expected == "" {
		return nil, "", fmt.Errorf("头像需要绝对图片路径和 expected_version")
	}
	if p.Field == "" {
		p.Field = "eyraAvatar"
	}
	allowed := map[string]bool{"eyraAvatar": true, "avatar": true, "roles.matrix.avatar": true, "roles.project.avatar": true, "roles.execution.avatar": true, "roles.subconscious.avatar": true}
	if !allowed[p.Field] {
		return nil, "", fmt.Errorf("头像字段无效")
	}
	sourcePath := p.Path
	if len(profiles) > 0 {
		sourcePath = storage.Relocate(profiles[0], sourcePath)
	}
	f, err := os.Open(sourcePath)
	if err != nil {
		return nil, "", err
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		return nil, "", err
	}
	if !st.Mode().IsRegular() || st.Size() > 20<<20 {
		return nil, "", fmt.Errorf("头像源图片须为最多 20 MiB 的普通文件")
	}
	data, err := io.ReadAll(io.LimitReader(f, (20<<20)+1))
	if err != nil {
		return nil, "", err
	}
	config, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return nil, "", fmt.Errorf("图片格式无法读取: %w", err)
	}
	if config.Width < 1 || config.Height < 1 || int64(config.Width)*int64(config.Height) > 40_000_000 {
		return nil, "", fmt.Errorf("图片尺寸超出范围")
	}
	source, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, "", err
	}
	ratio := math.Min(1, 160/float64(max(config.Width, config.Height)))
	small := viewtool.Downscale(source, max(1, int(math.Round(float64(config.Width)*ratio))), max(1, int(math.Round(float64(config.Height)*ratio))))
	var out bytes.Buffer
	if err = png.Encode(&out, small); err != nil {
		return nil, "", err
	}
	uri := "data:image/png;base64," + base64.StdEncoding.EncodeToString(out.Bytes())
	if len(uri) > 180000 {
		return nil, "", fmt.Errorf("缩放后的头像仍超过存储大小")
	}
	patch := map[string]any{p.Field: uri}
	if strings.HasPrefix(p.Field, "roles.") {
		role := strings.Split(p.Field, ".")[1]
		patch = map[string]any{"roles": map[string]any{role: map[string]any{"avatar": uri}}}
	}
	return patch, p.Expected, nil
}

func (s *SettingsService) profileImage(ctx context.Context, session string, args json.RawMessage) (json.RawMessage, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	patch, expected, err := profileImagePatch(args, s.config)
	if err != nil {
		return nil, err
	}
	if err = ctx.Err(); err != nil {
		return nil, err
	}
	return s.callMethod(ctx, "system:settings", session, "apply", rawJSON(map[string]any{"scope": "profile", "expected_version": expected, "patch": patch}))
}

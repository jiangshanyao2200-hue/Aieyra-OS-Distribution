package viewimage

import (
	"bytes"
	"context"
	"fmt"
	"github.com/aieyra/aieyra-os/tool/base/official/view_image/contract"
	_ "golang.org/x/image/webp"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"os"
	"path/filepath"
)

const ByteLimit = 8 << 20

type PreparedImage struct {
	Data   []byte
	Format string
}

// Prepare reads and validates the exact source bytes. The host owns immutable
// asset storage, model admission and receipt commits; this function sends nothing.
func Prepare(ctx context.Context, root string, req contract.Request) (contract.Result, PreparedImage) {
	r := contract.Result{State: "rejected", Path: req.Path, Description: req.Description}
	fail := func(code, message string) (contract.Result, PreparedImage) {
		r.Error = &contract.Error{Code: code, Message: message}
		return r, PreparedImage{}
	}
	if ctx.Err() != nil {
		return fail("cancelled", "图像读取已取消")
	}
	if req.Detail == "" {
		req.Detail = "auto"
	}
	switch req.Detail {
	case "auto", "low", "high", "original":
	default:
		return fail("invalid_arguments", "detail 应为 auto、low、high 或 original")
	}
	if len(req.Description) > 256 {
		return fail("invalid_arguments", "请提供有效的本地图片路径和简短用途")
	}
	var (
		path   string
		data   []byte
		format string
		cfg    image.Config
	)
	if len(req.Paths) > 0 {
		// 多图：编号拼成一张输入；与单张 path 互斥，避免模型以为两者都会被查看。
		if req.Path != "" {
			return fail("invalid_arguments", "path 与 paths 只能二选一")
		}
		if len(req.Paths) < 2 || len(req.Paths) > composeMaxImages {
			return fail("invalid_arguments", fmt.Sprintf("paths 需要 2 到 %d 张图片；单张请用 path", composeMaxImages))
		}
		if req.Layout != "" && req.Layout != "grid" && req.Layout != "row" && req.Layout != "column" {
			return fail("invalid_arguments", "layout 应为 grid、row 或 column")
		}
		sources := make([]composeSource, 0, len(req.Paths))
		pixels, total := int64(0), 0
		for i, p := range req.Paths {
			full, raw, c, _, code, message := readToolImage(root, p, true)
			if code != "" {
				return fail(code, fmt.Sprintf("第 %d 张（%s）：%s", i+1, p, message))
			}
			pixels += int64(c.Width) * int64(c.Height)
			total += len(raw)
			if pixels > composeInputPixels || total > composeInputByteSize {
				return fail("image_dimensions", "多图总像素或总字节超限：最多 6400 万像素、48 MiB；请减少张数")
			}
			sources = append(sources, composeSource{Path: full, Data: raw, Width: c.Width, Height: c.Height})
			if ctx.Err() != nil {
				return fail("cancelled", "图像读取已取消")
			}
		}
		composed, layout, err := composeImages(req.Layout, sources)
		if err != nil {
			return fail("invalid_image", err.Error())
		}
		r.Paths, r.Layout = make([]string, len(sources)), &layout
		for i, s := range sources {
			r.Paths[i] = s.Path
		}
		data, format = composed, "jpeg"
		cfg = image.Config{Width: layout.Width, Height: layout.Height}
	} else {
		if req.Path == "" || len(req.Path) > 4096 {
			return fail("invalid_arguments", "请提供有效的本地图片路径和简短用途")
		}
		var code, message string
		path, data, cfg, format, code, message = readToolImage(root, req.Path)
		if code != "" {
			return fail(code, message)
		}
	}
	if ctx.Err() != nil {
		return fail("cancelled", "图像读取已取消")
	}

	r.Path, r.Width, r.Height, r.MIME, r.Detail = path, cfg.Width, cfg.Height, "image/"+format, req.Detail
	return r, PreparedImage{Data: data, Format: format}
}
func readToolImage(root, raw string, headerOnly ...bool) (path string, data []byte, cfg image.Config, format, code, message string) {
	if raw == "" || len(raw) > 4096 {
		return "", nil, cfg, "", "invalid_arguments", "请提供有效的本地图片路径"
	}
	path = raw
	if !filepath.IsAbs(path) {
		if filepath.VolumeName(path) != "" {
			return "", nil, cfg, "", "invalid_path", "请使用完整绝对路径或不带盘符的相对路径"
		}
		path = filepath.Join(root, path)
	}
	f, err := os.Open(path)
	if err != nil {
		return "", nil, cfg, "", "image_unavailable", err.Error()
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil || !st.Mode().IsRegular() {
		return "", nil, cfg, "", "invalid_image", "图片必须是普通文件"
	}
	data, err = io.ReadAll(io.LimitReader(f, ByteLimit+1))
	if err != nil {
		return "", nil, cfg, "", "image_unavailable", err.Error()
	}
	if len(data) > ByteLimit {
		return "", nil, cfg, "", "image_too_large", "图片超过 8 MiB，请先缩小图片"
	}
	cfg, format, err = image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return "", nil, cfg, "", "invalid_image", "无法识别图片；当前支持 PNG、JPEG、GIF、WebP"
	}
	if cfg.Width < 1 || cfg.Height < 1 || cfg.Width > 8192 || cfg.Height > 8192 || int64(cfg.Width)*int64(cfg.Height) > 32000000 {
		return "", nil, cfg, "", "image_dimensions", "图片尺寸超限：单边最多 8192，像素总数最多 3200 万"
	}
	if len(headerOnly) == 0 || !headerOnly[0] {
		if _, _, err = image.Decode(bytes.NewReader(data)); err != nil {
			return "", nil, cfg, "", "invalid_image", "图片内容不完整或损坏，请先修复文件"
		}
	}
	return path, data, cfg, format, "", ""
}

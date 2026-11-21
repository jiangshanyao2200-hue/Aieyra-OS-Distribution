package imagegen

import (
	"bytes"
	"fmt"
	"github.com/aieyra/aieyra-os/contracts/protocol"
	_ "golang.org/x/image/webp"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"os"
	"path/filepath"
)

func Inspect(data []byte) (string, error) {
	if len(data) == 0 || len(data) > protocol.GeneratedImageByteLimit {
		return "", fmt.Errorf("image must contain at most 32 MiB")
	}
	cfg, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || (format != "png" && format != "jpeg" && format != "gif" && format != "webp") {
		return "", fmt.Errorf("image must be a complete PNG, JPEG, GIF or WebP")
	}
	if cfg.Width < 1 || cfg.Height < 1 || cfg.Width > 8192 || cfg.Height > 8192 || int64(cfg.Width)*int64(cfg.Height) > 32000000 {
		return "", fmt.Errorf("image dimensions exceed the limit")
	}
	if _, _, err := image.Decode(bytes.NewReader(data)); err != nil {
		return "", fmt.Errorf("image data is incomplete")
	}
	return format, nil
}

func ReadEditInput(path string) (protocol.ImageEditInput, error) {
	ref := protocol.ImageEditInput{Path: path}
	if path == "" || len(path) > 4096 || !filepath.IsAbs(path) {
		return ref, fmt.Errorf("编辑参考图须为完整本地路径")
	}
	f, err := os.Open(path)
	if err != nil {
		return ref, fmt.Errorf("编辑参考图无法读取：%s", filepath.Base(path))
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil || !st.Mode().IsRegular() || st.Size() > protocol.GeneratedImageByteLimit {
		return ref, fmt.Errorf("编辑参考图必须是 32 MiB 以内普通文件")
	}
	data, err := io.ReadAll(io.LimitReader(f, protocol.GeneratedImageByteLimit+1))
	if err != nil {
		return ref, err
	}
	if _, err = Inspect(data); err != nil {
		return ref, err
	}
	cfg, _, _ := image.DecodeConfig(bytes.NewReader(data))
	ref.Data, ref.Width, ref.Height = data, cfg.Width, cfg.Height
	return ref, nil
}

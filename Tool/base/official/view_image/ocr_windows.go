//go:build windows

package viewimage

import (
	"bytes"
	"context"
	_ "embed"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"time"
	"unicode/utf16"
)

//go:embed ocr.ps1
var ocrScript string

func ocrExecutable() string {
	return filepath.Join(os.Getenv("SystemRoot"), "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
}

// Availability advertises the local adapter, not the presence of an OCR language.
// Missing Windows components/languages are reported by the actual operation.
func OCRAvailable() bool {
	info, err := os.Stat(ocrExecutable())
	return err == nil && !info.IsDir()
}

type OCRResult struct {
	Text      string `json:"text"`
	Language  string `json:"language"`
	Truncated bool   `json:"truncated"`
}

type ocrOutput struct{ bytes.Buffer }

func (b *ocrOutput) Write(p []byte) (int, error) {
	if b.Len()+len(p) > 256<<10 {
		return 0, fmt.Errorf("OCR output exceeds limit")
	}
	return b.Buffer.Write(p)
}

// OCR consumes the already validated immutable pixels. No user paths or text
// are interpolated into executable code, and the OS engine makes no API call.
func OCR(ctx context.Context, data []byte) (OCRResult, error) {
	var result OCRResult
	if len(data) == 0 || len(data) > ByteLimit {
		return result, fmt.Errorf("OCR image byte limit exceeded")
	}
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	units := utf16.Encode([]rune(ocrScript))
	encoded := make([]byte, len(units)*2)
	for i, u := range units {
		binary.LittleEndian.PutUint16(encoded[i*2:], u)
	}
	cmd := exec.CommandContext(ctx, ocrExecutable(), "-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", base64.StdEncoding.EncodeToString(encoded))
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
	cmd.Stdin = bytes.NewBufferString(base64.StdEncoding.EncodeToString(data))
	var output, stderr ocrOutput
	cmd.Stdout, cmd.Stderr = &output, &stderr
	if err := cmd.Run(); err != nil {
		if ctx.Err() != nil {
			return result, ctx.Err()
		}
		return result, fmt.Errorf("本机OCR不可用：请检查Windows OCR组件及识别语言（%w）", err)
	}
	if err := json.Unmarshal(bytes.TrimPrefix(output.Bytes(), []byte{0xef, 0xbb, 0xbf}), &result); err != nil || result.Language == "" || len(result.Text) > 96<<10 {
		return OCRResult{}, fmt.Errorf("本机OCR返回无效结果")
	}
	return result, nil
}

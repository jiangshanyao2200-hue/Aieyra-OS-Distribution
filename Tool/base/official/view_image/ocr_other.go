//go:build !windows

package viewimage

import (
	"context"
	"fmt"
)

type OCRResult struct {
	Text      string
	Language  string
	Truncated bool
}

func OCRAvailable() bool { return false }

func OCR(context.Context, []byte) (OCRResult, error) {
	return OCRResult{}, fmt.Errorf("当前平台未接入本机OCR；可配置已验证的视觉模型")
}

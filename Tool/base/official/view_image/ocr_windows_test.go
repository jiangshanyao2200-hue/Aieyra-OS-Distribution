//go:build windows

package viewimage

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"os/exec"
	"strings"
	"syscall"
	"testing"
)

func TestWindowsOCRTextEmptyAndCancellation(t *testing.T) {
	if !OCRAvailable() {
		t.Skip("Windows PowerShell unavailable")
	}
	img := image.NewRGBA(image.Rect(0, 0, 1000, 200))
	draw.Draw(img, img.Bounds(), image.NewUniform(color.White), image.Point{}, draw.Src)
	var blank bytes.Buffer
	if err := png.Encode(&blank, img); err != nil {
		t.Fatal(err)
	}
	// Render a normal screen font through Windows, keeping this integration
	// fixture independent of the OCR implementation and of bundled font files.
	cmd := exec.Command(ocrExecutable(), "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", `Add-Type -AssemblyName System.Drawing; $b = [Drawing.Bitmap]::new(1000,200); $g = [Drawing.Graphics]::FromImage($b); $g.Clear([Drawing.Color]::White); $f = [Drawing.Font]::new('Segoe UI',40); $g.DrawString('AIEYRA OCR 114',$f,[Drawing.Brushes]::Black,40,60); $s = [IO.MemoryStream]::new(); $b.Save($s,[Drawing.Imaging.ImageFormat]::Png); [Console]::Write([Convert]::ToBase64String($s.ToArray())); $s.Dispose(); $f.Dispose(); $g.Dispose(); $b.Dispose()`)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
	encoded, err := cmd.Output()
	if err != nil {
		t.Fatal(err)
	}
	textImage, err := base64.StdEncoding.DecodeString(string(encoded))
	if err != nil {
		t.Fatal(err)
	}
	result, err := OCR(context.Background(), textImage)
	// Recognizer tokenization varies with its installed language. Characters
	// must match exactly; spaces between recognized words may differ.
	if err != nil || strings.Join(strings.Fields(result.Text), "") != "AIEYRAOCR114" || result.Language == "" || result.Truncated {
		t.Fatalf("actual Windows OCR: %+v, %v", result, err)
	}
	result, err = OCR(context.Background(), blank.Bytes())
	if err != nil || strings.TrimSpace(result.Text) != "" {
		t.Fatalf("blank image invented text: %+v, %v", result, err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err = OCR(ctx, textImage); !errors.Is(err, context.Canceled) {
		t.Fatal("cancellation lost", err)
	}
	if _, err = OCR(context.Background(), []byte("not an image")); err == nil {
		t.Fatal("invalid image accepted")
	}
}

package viewimage

import (
	"bytes"
	"context"
	"encoding/binary"
	"hash/crc32"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"testing"

	"github.com/aieyra/aieyra-os/tool/base/official/view_image/contract"
)

func writeImage(t *testing.T, root, name string, c color.NRGBA) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, 64, 64))
	for y := 0; y < 64; y++ {
		for x := 0; x < 64; x++ {
			img.SetNRGBA(x, y, c)
		}
	}
	var data bytes.Buffer
	if err := png.Encode(&data, img); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, name), data.Bytes(), 0600); err != nil {
		t.Fatal(err)
	}
	return data.Bytes()
}

func TestPrepareSingleAndNumberedSheets(t *testing.T) {
	root := t.TempDir()
	original := writeImage(t, root, "alpha.png", color.NRGBA{R: 255, A: 128})
	writeImage(t, root, "blue.png", color.NRGBA{B: 255, A: 255})
	r, p := Prepare(context.Background(), root, contract.Request{Path: "alpha.png", Description: "inspect", Detail: "original"})
	if r.Error != nil || r.Path != filepath.Join(root, "alpha.png") || r.Width != 64 || r.Height != 64 || r.Detail != "original" || r.MIME != "image/png" || !bytes.Equal(p.Data, original) {
		t.Fatalf("single: %+v", r)
	}
	if r.OK || r.ImageID != "" {
		t.Fatal("preparation must not claim a committed asset")
	}
	for _, kind := range []string{"grid", "row", "column"} {
		t.Run(kind, func(t *testing.T) {
			r, p := Prepare(context.Background(), root, contract.Request{Paths: []string{"alpha.png", "blue.png"}, Layout: kind})
			if r.Error != nil || r.Layout == nil || len(r.Layout.Tiles) != 2 || r.MIME != "image/jpeg" {
				t.Fatalf("sheet: %+v", r)
			}
			img, _, err := image.Decode(bytes.NewReader(p.Data))
			if err != nil {
				t.Fatal(err)
			}
			for i, tile := range r.Layout.Tiles {
				if tile.Index != i+1 || tile.Path != r.Paths[i] || tile.SourceWidth != 64 || tile.SourceHeight != 64 || tile.X+tile.W > r.Width || tile.Y+tile.H > r.Height {
					t.Fatalf("mapping: %+v", tile)
				}
			}
			tile := r.Layout.Tiles[0]
			red, green, blue, _ := img.At(tile.X+tile.W-8, tile.Y+tile.H-8).RGBA()
			if red>>8 < 235 || green>>8 < 105 || green>>8 > 130 || blue>>8 < 105 || blue>>8 > 135 {
				t.Fatalf("alpha not composed over light background: %d %d %d", red>>8, green>>8, blue>>8)
			}
			if kind == "column" && r.Layout.Rows != 2 || kind == "row" && r.Layout.Columns != 2 {
				t.Fatalf("layout: %+v", r.Layout)
			}
		})
	}
}

func TestPrepareRejectsInvalidInputsAndCancellation(t *testing.T) {
	root := t.TempDir()
	data := writeImage(t, root, "ok.png", color.NRGBA{G: 255, A: 255})
	write := func(name string, raw []byte) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(root, name), raw, 0600); err != nil {
			t.Fatal(err)
		}
	}
	write("broken.png", data[:len(data)-16])
	write("large.png", make([]byte, ByteLimit+1))
	huge := append([]byte(nil), data...)
	binary.BigEndian.PutUint32(huge[16:20], 8193)
	binary.BigEndian.PutUint32(huge[29:33], crc32.ChecksumIEEE(huge[12:29]))
	write("dimensions.png", huge)
	for _, tc := range []struct {
		name string
		req  contract.Request
		code string
	}{
		{"missing", contract.Request{Path: "missing.png"}, "image_unavailable"},
		{"truncated", contract.Request{Path: "broken.png"}, "invalid_image"},
		{"truncated sheet", contract.Request{Paths: []string{"ok.png", "broken.png"}}, "invalid_image"},
		{"conflicting paths", contract.Request{Path: "ok.png", Paths: []string{"ok.png", "ok.png"}}, "invalid_arguments"},
		{"single paths", contract.Request{Paths: []string{"ok.png"}}, "invalid_arguments"},
		{"invalid layout", contract.Request{Paths: []string{"ok.png", "ok.png"}, Layout: "stack"}, "invalid_arguments"},
		{"invalid detail", contract.Request{Path: "ok.png", Detail: "unknown"}, "invalid_arguments"},
		{"directory", contract.Request{Path: "."}, "invalid_image"},
		{"byte limit", contract.Request{Path: "large.png"}, "image_too_large"},
		{"dimensions", contract.Request{Path: "dimensions.png"}, "image_dimensions"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r, p := Prepare(context.Background(), root, tc.req)
			if r.Error == nil || r.Error.Code != tc.code || len(p.Data) > 0 || r.OK {
				t.Fatalf("got %+v bytes=%d", r, len(p.Data))
			}
		})
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	r, p := Prepare(ctx, root, contract.Request{Path: "ok.png"})
	if r.Error == nil || r.Error.Code != "cancelled" || len(p.Data) > 0 {
		t.Fatalf("cancel: %+v", r)
	}
}

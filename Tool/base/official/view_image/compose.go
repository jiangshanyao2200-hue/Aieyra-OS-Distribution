package viewimage

// view_image 多图（R49）：2–12 张先各自等比缩小、再按编号拼成一张，作为一次图片输入。
// 透明区域按 Over 合成到中性浅灰底，输出不透明 JPEG（体积可控，不会因 PNG 过大被拒）；
// 返回每张的编号、来源与在拼图里的位置，细节不够时模型可再单独查看原图。
import (
	"bytes"
	"fmt"
	"github.com/aieyra/aieyra-os/tool/base/official/view_image/contract"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	"math"
)

const (
	composeMaxImages     = 12
	composeMaxEdge       = 2048
	composeGap           = 12
	composeInputPixels   = 64_000_000
	composeInputByteSize = 48 << 20
)

var composeBackground = color.RGBA{0xE9, 0xEB, 0xEF, 0xFF}

type composeSource struct {
	Path          string
	Data          []byte
	Width, Height int
}

func composeGrid(kind string, n int) (int, int) {
	switch kind {
	case "row":
		return n, 1
	case "column":
		return 1, n
	}
	cols := int(math.Ceil(math.Sqrt(float64(n))))
	return cols, (n + cols - 1) / cols
}

// composeImages 逐张解码、缩小、绘制后即释放，内存只随单张原图与输出画布增长。
func composeImages(kind string, sources []composeSource) ([]byte, contract.Layout, error) {
	if kind == "" {
		kind = "grid"
	}
	layout := contract.Layout{Kind: kind}
	if len(sources) < 2 || len(sources) > composeMaxImages {
		return nil, layout, fmt.Errorf("paths 需要 2 到 %d 张图片", composeMaxImages)
	}
	cols, rows := composeGrid(kind, len(sources))
	largest := 64
	for _, s := range sources {
		largest = max(largest, s.Width, s.Height)
	}
	cell := min((composeMaxEdge-composeGap*(cols+1))/cols, (composeMaxEdge-composeGap*(rows+1))/rows, largest)
	if cell < 16 {
		return nil, layout, fmt.Errorf("图片太多，拼图格子过小；请减少张数或改用 grid")
	}
	layout.Columns, layout.Rows = cols, rows
	layout.Width, layout.Height = composeGap+cols*(cell+composeGap), composeGap+rows*(cell+composeGap)
	canvas := image.NewRGBA(image.Rect(0, 0, layout.Width, layout.Height))
	draw.Draw(canvas, canvas.Bounds(), &image.Uniform{composeBackground}, image.Point{}, draw.Src)
	for i, s := range sources {
		decoded, _, err := image.Decode(bytes.NewReader(s.Data))
		if err != nil {
			return nil, layout, fmt.Errorf("第 %d 张图片内容不完整或损坏", i+1)
		}
		scale := min(1, float64(cell)/float64(s.Width), float64(cell)/float64(s.Height))
		w, h := max(1, int(math.Round(float64(s.Width)*scale))), max(1, int(math.Round(float64(s.Height)*scale)))
		col, row := i%cols, i/cols
		x := composeGap + col*(cell+composeGap) + (cell-w)/2
		y := composeGap + row*(cell+composeGap) + (cell-h)/2
		tile := Downscale(decoded, w, h)
		draw.Draw(canvas, image.Rect(x, y, x+w, y+h), tile, image.Point{}, draw.Over)
		drawTileNumber(canvas, composeGap+col*(cell+composeGap), composeGap+row*(cell+composeGap), i+1, cell)
		layout.Tiles = append(layout.Tiles, contract.Tile{Index: i + 1, Path: s.Path, X: x, Y: y, W: w, H: h, SourceWidth: s.Width, SourceHeight: s.Height})
	}
	var out bytes.Buffer
	if err := jpeg.Encode(&out, canvas, &jpeg.Options{Quality: 90}); err != nil {
		return nil, layout, err
	}
	if out.Len() > ByteLimit {
		return nil, layout, fmt.Errorf("拼图超过 8 MiB，请减少张数")
	}
	return out.Bytes(), layout, nil
}

// downscale 用面积平均缩小（预乘 alpha 下求平均，透明边缘不会发黑）；目标不大于原图。
func Downscale(src image.Image, w, h int) *image.RGBA {
	b := src.Bounds()
	rgba, ok := src.(*image.RGBA)
	if !ok || rgba.Rect.Min != (image.Point{}) {
		rgba = image.NewRGBA(image.Rect(0, 0, b.Dx(), b.Dy()))
		draw.Draw(rgba, rgba.Bounds(), src, b.Min, draw.Src)
	}
	sw, sh := rgba.Rect.Dx(), rgba.Rect.Dy()
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	if sw == w && sh == h {
		copy(dst.Pix, rgba.Pix)
		return dst
	}
	for dy := 0; dy < h; dy++ {
		y0, y1 := dy*sh/h, max(dy*sh/h+1, (dy+1)*sh/h)
		for dx := 0; dx < w; dx++ {
			x0, x1 := dx*sw/w, max(dx*sw/w+1, (dx+1)*sw/w)
			var r, g, bl, a, n uint64
			for y := y0; y < y1; y++ {
				p := rgba.Pix[y*rgba.Stride+x0*4 : y*rgba.Stride+x1*4]
				for i := 0; i < len(p); i += 4 {
					r, g, bl, a = r+uint64(p[i]), g+uint64(p[i+1]), bl+uint64(p[i+2]), a+uint64(p[i+3])
					n++
				}
			}
			o := dy*dst.Stride + dx*4
			dst.Pix[o], dst.Pix[o+1], dst.Pix[o+2], dst.Pix[o+3] = uint8(r/n), uint8(g/n), uint8(bl/n), uint8(a/n)
		}
	}
	return dst
}

// 3×5 位图数字，按格子大小放大；深色底块上画白字，放在格子左上角。
var composeDigits = [10][5]string{
	{"111", "101", "101", "101", "111"}, {"010", "110", "010", "010", "111"}, {"111", "001", "111", "100", "111"},
	{"111", "001", "111", "001", "111"}, {"101", "101", "111", "001", "001"}, {"111", "100", "111", "001", "111"},
	{"111", "100", "111", "101", "111"}, {"111", "001", "001", "001", "001"}, {"111", "101", "111", "101", "111"},
	{"111", "101", "111", "001", "111"},
}

func drawTileNumber(canvas *image.RGBA, x, y, n, cell int) {
	scale := min(5, max(2, cell/64))
	text := fmt.Sprint(n)
	pad := scale * 2
	w := len(text)*4*scale - scale + pad*2
	h := 5*scale + pad*2
	draw.Draw(canvas, image.Rect(x, y, x+w, y+h), &image.Uniform{color.RGBA{0x1B, 0x1F, 0x27, 0xE6}}, image.Point{}, draw.Over)
	white := &image.Uniform{color.RGBA{0xFF, 0xFF, 0xFF, 0xFF}}
	for i, ch := range text {
		glyph := composeDigits[ch-'0']
		for row, line := range glyph {
			for col, bit := range line {
				if bit != '1' {
					continue
				}
				px, py := x+pad+(i*4+col)*scale, y+pad+row*scale
				draw.Draw(canvas, image.Rect(px, py, px+scale, py+scale), white, image.Point{}, draw.Src)
			}
		}
	}
}

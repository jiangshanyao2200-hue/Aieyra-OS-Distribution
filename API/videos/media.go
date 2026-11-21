// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: API/videos/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: Media; InspectMP4
// Impact: python -B scripts/code-atlas.py show API/videos/media.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package videos

import (
	"encoding/binary"
	"fmt"
	"io"
	"math"

	"github.com/aieyra/aieyra-os/contracts/protocol"
)

type Media struct {
	MIME    string  `json:"mime"`
	Width   int     `json:"width"`
	Height  int     `json:"height"`
	Seconds float64 `json:"duration_seconds"`
	Codec   string  `json:"codec"`
}

// InspectMP4 checks box bounds and reads actual movie/track metadata without
// loading the media body into memory or executing an external codec. Decoding
// every frame and playback compatibility remain separate GUI validation.
func InspectMP4(source io.ReaderAt, size int64) (Media, error) {
	var media Media
	if source == nil || size < 24 || size > protocol.GeneratedVideoByteLimit {
		return media, fmt.Errorf("视频文件为空、截断或过大")
	}
	read := func(at int64, n int) ([]byte, error) {
		b := make([]byte, n)
		_, err := source.ReadAt(b, at)
		return b, err
	}
	ftyp, movie, payload := false, false, false
	boxes := 0
	var walk func(int64, int64, int, *Media) error
	walk = func(start, end int64, depth int, track *Media) error {
		if depth > 6 {
			return fmt.Errorf("视频容器层级异常")
		}
		for at := start; at < end; {
			boxes++
			if boxes > 10000 || end-at < 8 {
				return fmt.Errorf("视频容器结构无效")
			}
			header, err := read(at, 8)
			if err != nil {
				return fmt.Errorf("视频文件截断")
			}
			length, offset := int64(binary.BigEndian.Uint32(header)), int64(8)
			kind := string(header[4:8])
			if length == 1 {
				if end-at < 16 {
					return fmt.Errorf("视频扩展容器头截断")
				}
				large, e := read(at+8, 8)
				if e != nil || binary.BigEndian.Uint64(large) > uint64(end-at) {
					return fmt.Errorf("视频容器长度越界")
				}
				length, offset = int64(binary.BigEndian.Uint64(large)), 16
			} else if length == 0 {
				length = end - at
			}
			if length < offset || length > end-at {
				return fmt.Errorf("视频容器长度越界")
			}
			content, limit := at+offset, at+length
			switch {
			case depth == 0 && kind == "ftyp":
				if at != 0 || limit-content < 8 {
					return fmt.Errorf("视频缺少有效MP4标识")
				}
				ftyp = true
			case depth == 0 && kind == "mdat":
				payload = payload || limit-content > 0
			case depth == 0 && kind == "moov":
				movie = true
				if err = walk(content, limit, depth+1, nil); err != nil {
					return err
				}
			case depth == 1 && kind == "mvhd":
				if limit-content < 20 {
					return fmt.Errorf("视频时长信息截断")
				}
				b, e := read(content, int(min(limit-content, 32)))
				if e != nil {
					return fmt.Errorf("视频时长信息不可读")
				}
				var scale uint32
				var duration uint64
				if b[0] == 0 {
					scale, duration = binary.BigEndian.Uint32(b[12:16]), uint64(binary.BigEndian.Uint32(b[16:20]))
				} else if b[0] == 1 && len(b) >= 32 {
					scale, duration = binary.BigEndian.Uint32(b[20:24]), binary.BigEndian.Uint64(b[24:32])
				} else {
					return fmt.Errorf("视频时长版本尚不支持")
				}
				if scale == 0 || duration == 0 || duration == math.MaxUint32 || duration == math.MaxUint64 {
					return fmt.Errorf("视频时长未知，原文件保留待核对")
				}
				media.Seconds = float64(duration) / float64(scale)
			case depth == 1 && kind == "trak":
				t := &Media{}
				if err = walk(content, limit, depth+1, t); err != nil {
					return err
				}
				if t.Width > 0 && t.Height > 0 && t.Codec != "" && media.Width == 0 {
					media.Width, media.Height, media.Codec = t.Width, t.Height, t.Codec
				}
			case track != nil && kind == "tkhd":
				if limit-content < 84 {
					return fmt.Errorf("视频尺寸信息截断")
				}
				b, e := read(content, int(min(limit-content, 96)))
				if e != nil {
					return fmt.Errorf("视频尺寸信息不可读")
				}
				i := 76
				if b[0] == 1 && len(b) >= 96 {
					i = 88
				} else if b[0] != 0 {
					return fmt.Errorf("视频尺寸版本尚不支持")
				}
				track.Width = int(binary.BigEndian.Uint32(b[i:i+4]) >> 16)
				track.Height = int(binary.BigEndian.Uint32(b[i+4:i+8]) >> 16)
			case track != nil && (kind == "mdia" || kind == "minf" || kind == "stbl"):
				if err = walk(content, limit, depth+1, track); err != nil {
					return err
				}
			case track != nil && kind == "stsd":
				if limit-content < 16 {
					return fmt.Errorf("视频编码信息截断")
				}
				b, e := read(content, 16)
				if e != nil || binary.BigEndian.Uint32(b[4:8]) == 0 || binary.BigEndian.Uint32(b[8:12]) < 8 || int64(binary.BigEndian.Uint32(b[8:12])) > limit-content-8 {
					return fmt.Errorf("视频编码信息无效")
				}
				switch codec := string(b[12:16]); codec {
				case "avc1", "avc3", "hev1", "hvc1", "av01", "vp09":
					track.Codec = codec
				}
			}
			at = limit
		}
		return nil
	}
	if err := walk(0, size, 0, nil); err != nil {
		return media, err
	}
	if !ftyp || !movie || !payload || media.Width == 0 || media.Height == 0 || media.Codec == "" || media.Seconds <= 0 {
		return media, fmt.Errorf("视频缺少可识别的媒体、尺寸、时长或编码，原文件保留待核对")
	}
	media.MIME = "video/mp4"
	return media, nil
}

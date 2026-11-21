// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: API/videos/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: mediaBox; TestMP4InspectionReadsActualMetadataAndRejectsBrokenContainer
// Impact: python -B scripts/code-atlas.py show API/videos/media_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package videos

import (
	"bytes"
	"encoding/binary"
	"testing"
)

func mediaBox(kind string, content ...[]byte) []byte {
	body := bytes.Join(content, nil)
	box := make([]byte, 8, 8+len(body))
	binary.BigEndian.PutUint32(box, uint32(len(body)+8))
	copy(box[4:], kind)
	return append(box, body...)
}

func TestMP4InspectionReadsActualMetadataAndRejectsBrokenContainer(t *testing.T) {
	movie := make([]byte, 20)
	binary.BigEndian.PutUint32(movie[12:16], 1000)
	binary.BigEndian.PutUint32(movie[16:20], 7230)
	track := make([]byte, 84)
	binary.BigEndian.PutUint32(track[76:80], 960<<16)
	binary.BigEndian.PutUint32(track[80:84], 540<<16)
	samples := make([]byte, 8)
	binary.BigEndian.PutUint32(samples[4:], 1)
	file := bytes.Join([][]byte{
		mediaBox("ftyp", []byte("isom\x00\x00\x00\x00")),
		mediaBox("mdat", []byte("fixture media")),
		mediaBox("moov", mediaBox("mvhd", movie), mediaBox("trak", mediaBox("tkhd", track), mediaBox("mdia", mediaBox("minf", mediaBox("stbl", mediaBox("stsd", samples, mediaBox("avc1"))))))),
	}, nil)
	m, err := InspectMP4(bytes.NewReader(file), int64(len(file)))
	if err != nil || m.Width != 960 || m.Height != 540 || m.Seconds != 7.23 || m.Codec != "avc1" || m.MIME != "video/mp4" {
		t.Fatal("actual video metadata missing", m, err)
	}
	broken := append([]byte(nil), file...)
	binary.BigEndian.PutUint32(broken[:4], uint32(len(file)+100))
	for _, data := range [][]byte{file[:len(file)-1], broken, []byte("<html>not a movie</html>"), mediaBox("ftyp", []byte("isom\x00\x00\x00\x00"))} {
		if _, err := InspectMP4(bytes.NewReader(data), int64(len(data))); err == nil {
			t.Fatal("corrupt or incomplete video was accepted")
		}
	}
}

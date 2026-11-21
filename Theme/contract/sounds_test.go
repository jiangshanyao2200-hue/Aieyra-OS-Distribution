// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Theme/contract/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: TestSoundAssetsAdmission
// Impact: python -B scripts/code-atlas.py show Theme/contract/sounds_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package contract

import (
	"encoding/binary"
	"os"
	"path/filepath"
	"testing"
)

func TestSoundAssetsAdmission(t *testing.T) {
	root := filepath.Join("..", "..", "SDK", "examples", "theme-sounds")
	raw, err := os.ReadFile(filepath.Join(root, "theme.json"))
	if err != nil {
		t.Fatal(err)
	}
	p, err := Decode(raw)
	if err != nil {
		t.Fatal(err)
	}
	files := map[string][]byte{}
	for _, asset := range p.Assets {
		files[asset.Path], err = os.ReadFile(filepath.Join(root, filepath.FromSlash(asset.Path)))
		if err != nil {
			t.Fatal(err)
		}
	}
	if err = p.ValidateFiles(files); err != nil {
		t.Fatal(err)
	}
	sample := files["assets/complete.wav"]
	for name, corrupt := range map[string]func([]byte) []byte{
		"truncated":      func(b []byte) []byte { return b[:len(b)-1] },
		"trailing":       func(b []byte) []byte { return append(b, 0) },
		"compressed":     func(b []byte) []byte { b[20] = 3; return b },
		"channels":       func(b []byte) []byte { b[22] = 3; return b },
		"rate":           func(b []byte) []byte { binary.LittleEndian.PutUint32(b[24:28], 192000); return b },
		"byte rate":      func(b []byte) []byte { b[28] = 1; return b },
		"alignment":      func(b []byte) []byte { b[32] = 1; return b },
		"bits":           func(b []byte) []byte { b[34] = 32; return b },
		"chunk overflow": func(b []byte) []byte { binary.LittleEndian.PutUint32(b[40:44], 0xffffffff); return b },
		"duration": func(b []byte) []byte {
			b = append(b[:44], make([]byte, 16000*2*4)...)
			binary.LittleEndian.PutUint32(b[4:8], uint32(len(b)-8))
			binary.LittleEndian.PutUint32(b[40:44], uint32(len(b)-44))
			return b
		},
		"duplicate data": func(b []byte) []byte {
			b = append(b, b[36:]...)
			binary.LittleEndian.PutUint32(b[4:8], uint32(len(b)-8))
			return b
		},
	} {
		t.Run(name, func(t *testing.T) {
			files["assets/complete.wav"] = corrupt(append([]byte(nil), sample...))
			if p.ValidateFiles(files) == nil {
				t.Fatal("accepted invalid sound")
			}
		})
	}
	for _, sounds := range []string{`null`, `[]`, `{"click":"complete"}`, `{"task.completed":"missing"}`, `{"task.completed":false}`} {
		if _, err = Decode([]byte(`{"schema":"aieyra.theme/1","elements":"1.0.0","sounds":` + sounds + `}`)); err == nil {
			t.Fatal("accepted invalid sound binding", sounds)
		}
	}
}

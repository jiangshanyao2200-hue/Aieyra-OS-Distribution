// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Theme/contract/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: validateSounds; validateSoundWAV
// Impact: python -B scripts/code-atlas.py show Theme/contract/sounds.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package contract

import (
	"encoding/binary"
	"fmt"
)

func validateSounds(sounds map[string]string, assets map[string]Asset) error {
	for event, id := range sounds {
		if event != "task.completed" && event != "task.failed" && event != "attention.pending" {
			return fmt.Errorf("unknown theme sound event: %s", event)
		}
		if !assetID.MatchString(id) || assets[id].MIME != "audio/wav" {
			return fmt.Errorf("theme sound needs a declared WAV asset: %s", event)
		}
	}
	return nil
}

// Short uncompressed PCM only: at most three seconds, two channels, 48 kHz.
// Admission validates the complete container before Chromium receives bytes.
func validateSoundWAV(raw []byte) error {
	bad := func() error {
		return fmt.Errorf("expected bounded 16-bit PCM WAV (up to 3 seconds, 8–48 kHz, mono/stereo)")
	}
	if len(raw) < 44 || len(raw) > 3*48000*4+4096 || string(raw[:4]) != "RIFF" || string(raw[8:12]) != "WAVE" || uint64(binary.LittleEndian.Uint32(raw[4:8]))+8 != uint64(len(raw)) {
		return bad()
	}
	var format []byte
	dataBytes := -1
	for pos := 12; pos < len(raw); {
		if len(raw)-pos < 8 {
			return bad()
		}
		n := uint64(binary.LittleEndian.Uint32(raw[pos+4 : pos+8]))
		end := uint64(pos) + 8 + n
		if end+(n%2) > uint64(len(raw)) {
			return bad()
		}
		switch string(raw[pos : pos+4]) {
		case "fmt ":
			if format != nil || n != 16 {
				return bad()
			}
			format = raw[pos+8 : int(end)]
		case "data":
			if dataBytes >= 0 {
				return bad()
			}
			dataBytes = int(n)
		}
		pos = int(end + n%2)
	}
	if format == nil || dataBytes <= 0 {
		return bad()
	}
	encoding := binary.LittleEndian.Uint16(format[:2])
	channels := uint32(binary.LittleEndian.Uint16(format[2:4]))
	rate := binary.LittleEndian.Uint32(format[4:8])
	bytesPerSecond := binary.LittleEndian.Uint32(format[8:12])
	align := uint32(binary.LittleEndian.Uint16(format[12:14]))
	bits := binary.LittleEndian.Uint16(format[14:16])
	if encoding != 1 || channels < 1 || channels > 2 || rate < 8000 || rate > 48000 || bits != 16 || align != channels*2 || bytesPerSecond != rate*align || uint32(dataBytes)%align != 0 || uint32(dataBytes) > bytesPerSecond*3 {
		return bad()
	}
	return nil
}

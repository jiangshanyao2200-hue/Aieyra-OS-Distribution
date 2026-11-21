// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Theme/contract/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: Asset; assetID; assetPath; assetRef; assetCall; validateAssets; assetProperty; ValidateFiles
// Impact: python -B scripts/code-atlas.py show Theme/contract/assets.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package contract

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"regexp"
	"strings"
)

// Assets are inert package resources. URLs and executable formats are never
// authored into CSS; the host binds references to an admitted package digest.
type Asset struct {
	Path     string `json:"path"`
	MIME     string `json:"mime"`
	Fallback string `json:"fallback,omitempty"`
}

var assetID = regexp.MustCompile(`^[a-z][a-z0-9-]{0,47}$`)
var assetPath = regexp.MustCompile(`^assets/(?:[a-zA-Z0-9_-]+/)*[a-zA-Z0-9_-]+\.(?:png|jpg|jpeg|woff2|wav)$`)
var assetRef = regexp.MustCompile(`^asset\(([a-z][a-z0-9-]{0,47})\)$`)
var assetCall = regexp.MustCompile(`(?i)asset\s*\(`)

func validateAssets(assets map[string]Asset) error {
	if len(assets) > 64 {
		return fmt.Errorf("theme has too many assets")
	}
	for id, a := range assets {
		if !assetID.MatchString(id) || len(a.Path) > 240 || !assetPath.MatchString(a.Path) {
			return fmt.Errorf("invalid theme asset: %s", id)
		}
		valid := a.MIME == "image/png" && strings.HasSuffix(a.Path, ".png") || a.MIME == "image/jpeg" && (strings.HasSuffix(a.Path, ".jpg") || strings.HasSuffix(a.Path, ".jpeg")) || a.MIME == "font/woff2" && strings.HasSuffix(a.Path, ".woff2") || a.MIME == "audio/wav" && strings.HasSuffix(a.Path, ".wav")
		if !valid || a.MIME != "font/woff2" && a.Fallback != "" || a.Fallback != "" && a.Fallback != "sans-serif" && a.Fallback != "serif" && a.Fallback != "monospace" {
			return fmt.Errorf("unsupported theme asset format: %s", id)
		}
	}
	return nil
}

func assetProperty(property, value string, assets map[string]Asset) bool {
	if !assetCall.MatchString(value) {
		return true
	}
	ref := assetRef.FindStringSubmatch(value)
	if ref == nil {
		return false
	}
	a, ok := assets[ref[1]]
	if !ok {
		return false
	}
	return property == "font-family" && a.MIME == "font/woff2" || (property == "background" || property == "background-image") && strings.HasPrefix(a.MIME, "image/")
}

// ValidateFiles runs on inspected/installed bytes after the common package
// manifest's path, size and SHA checks. No caller supplies filesystem paths.
func (p Definition) ValidateFiles(files map[string][]byte) error {
	total, pixels, fonts := 0, 0, uint64(0)
	for id, a := range p.Assets {
		raw := files[a.Path]
		total += len(raw)
		if len(raw) == 0 || len(raw) > 8*1024*1024 || total > 24*1024*1024 {
			return fmt.Errorf("theme asset missing or exceeds byte budget: %s", id)
		}
		if a.MIME == "audio/wav" {
			if err := validateSoundWAV(raw); err != nil {
				return fmt.Errorf("invalid theme sound %s: %w", id, err)
			}
			continue
		}
		if a.MIME == "font/woff2" {
			if len(raw) < 48 || string(raw[:4]) != "wOF2" || binary.BigEndian.Uint32(raw[8:12]) != uint32(len(raw)) || binary.BigEndian.Uint16(raw[12:14]) == 0 || binary.BigEndian.Uint16(raw[12:14]) > 256 || binary.BigEndian.Uint16(raw[14:16]) != 0 || binary.BigEndian.Uint32(raw[16:20]) > 32*1024*1024 || binary.BigEndian.Uint32(raw[16:20]) < 12 || binary.BigEndian.Uint32(raw[20:24]) == 0 || uint64(binary.BigEndian.Uint32(raw[20:24]))+48 > uint64(len(raw)) {
				return fmt.Errorf("invalid WOFF2 theme asset: %s", id)
			}
			fonts += uint64(binary.BigEndian.Uint32(raw[16:20]))
			if fonts > 32*1024*1024 {
				return fmt.Errorf("theme fonts exceed decoded byte budget")
			}
			// Chromium's OpenType sanitizer validates tables before font activation.
			continue
		}
		cfg, format, err := image.DecodeConfig(bytes.NewReader(raw))
		if err != nil || "image/"+format != a.MIME || cfg.Width < 1 || cfg.Height < 1 || cfg.Width > 4096 || cfg.Height > 4096 || cfg.Width*cfg.Height > 16*1024*1024 {
			return fmt.Errorf("invalid theme image or dimensions: %s", id)
		}
		pixels += cfg.Width * cfg.Height
		if pixels > 16*1024*1024 {
			return fmt.Errorf("theme images exceed pixel budget")
		}
		if _, _, err = image.Decode(bytes.NewReader(raw)); err != nil {
			return fmt.Errorf("corrupt theme image: %s", id)
		}
	}
	return nil
}

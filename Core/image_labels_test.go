// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestUserImagesCarryTheirNames; TestComposerLabelsAreStable
// Impact: python -B scripts/code-atlas.py show Core/image_labels_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// A named user image is introduced by its [图N] label right before the image,
// so "@name" and "@图N" in the text resolve; unnamed history stays as it was.
func TestUserImagesCarryTheirNames(t *testing.T) {
	png, _ := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBp0AAAAASUVORK5CYII=")
	file := filepath.Join(t.TempDir(), "a")
	if err := os.WriteFile(file, png, 0600); err != nil {
		t.Fatal(err)
	}
	image := ImageAttachment{Name: "A.png", Asset: file, SHA256: fmt.Sprintf("%x", sha256.Sum256(png)), MIME: "image/png", Detail: "auto", Bytes: len(png), Width: 1, Height: 1}
	plain := image
	plain.Name = ""
	s := Defaults()
	s.APIProtocol = ProtocolResponses
	r := BuildResponsesRequest(s, []Message{{Role: RoleUser, Content: "@A 换成蓝色背景", Images: []ImageAttachment{image, plain}}}, false, nil)
	raw, _ := json.Marshal(r.Input)
	text := string(raw)
	label := strings.Index(text, `"text":"[图1] A.png"`)
	picture := strings.Index(text, `"type":"input_image"`)
	if label < 0 || picture < label {
		t.Fatalf("label missing or after the image: %s", text[:min(len(text), 400)])
	}
	if strings.Count(text, "[图") != 1 {
		t.Fatal("unnamed image was labelled")
	}
}

// A composer label is kept on the image, so "@图2" still means the same picture
// after the first one was removed; a malformed label is refused.
func TestComposerLabelsAreStable(t *testing.T) {
	if got := imageLabel(0, ImageAttachment{Name: "B.png", Label: "图2"}); got != "[图2] B.png" {
		t.Fatalf("label = %q", got)
	}
	for label, ok := range map[string]bool{"图1": true, "图99": true, "图0": false, "图100": false, "文件1": false, "图": false, "图1a": false} {
		if composerLabel(ComposerAttachment{Kind: "image", Label: label}) != ok {
			t.Fatalf("composerLabel(%q) != %v", label, ok)
		}
	}
	if !composerLabel(ComposerAttachment{Kind: "file", Label: "文件3"}) {
		t.Fatal("file label refused")
	}
	sum := strings.Repeat("a", 64)
	_, err := prepareComposerAttachments(t.TempDir(), []ComposerAttachment{{Name: "a", SHA256: sum, Kind: "image", Label: "文件1"}}, nil)
	if err == nil || !strings.Contains(err.Error(), "附件记录无效") {
		t.Fatalf("malformed label: %v", err)
	}
}

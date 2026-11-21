// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Theme/official/AGENTS.md | ring 3
// Chains: module-local; query impact before editing
// Regions: bundledMedia; Avatar; RandomAvatar
// Impact: python -B scripts/code-atlas.py show Theme/official/media.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package official

import (
	"crypto/rand"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math/big"
	"strings"
)

// The Go host and desktop media service consume the same bundled catalogue.
// Initial identity media is local and does not depend on account/network state.
//
//go:embed default/library/media.json default/library/avatars/*.png
var bundledMedia embed.FS

type Avatar struct {
	ID     string
	Digest string
	Data   []byte
}

func RandomAvatar() (Avatar, error) {
	var catalogue struct {
		Items []struct {
			ID, Category, File, SHA256 string
			Size                       int
		}
	}
	raw, err := bundledMedia.ReadFile("default/library/media.json")
	if err != nil {
		return Avatar{}, err
	}
	if err = json.Unmarshal(raw, &catalogue); err != nil {
		return Avatar{}, err
	}
	var choices []int
	for i, item := range catalogue.Items {
		if item.Category == "avatar" {
			choices = append(choices, i)
		}
	}
	if len(choices) == 0 {
		return Avatar{}, fmt.Errorf("bundled avatar catalogue is empty")
	}
	index, err := rand.Int(rand.Reader, big.NewInt(int64(len(choices))))
	if err != nil {
		return Avatar{}, err
	}
	item := catalogue.Items[choices[index.Int64()]]
	if !strings.HasPrefix(item.File, "avatars/") || strings.Contains(item.File, "..") || !strings.HasSuffix(item.File, ".png") {
		return Avatar{}, fmt.Errorf("invalid bundled avatar path")
	}
	data, err := bundledMedia.ReadFile("default/library/" + item.File)
	if err != nil {
		return Avatar{}, err
	}
	digest := sha256.Sum256(data)
	if len(data) != item.Size || hex.EncodeToString(digest[:]) != item.SHA256 {
		return Avatar{}, fmt.Errorf("bundled avatar integrity mismatch")
	}
	return Avatar{ID: item.ID, Digest: item.SHA256, Data: data}, nil
}

// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: contactMediaID; contactMediaDigest; cleanContactAvatarRotation; contactAvatarRevision; initializeContactAvatar
// Impact: python -B scripts/code-atlas.py show Core/conversation_avatar.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"regexp"
	"time"

	thememedia "github.com/aieyra/aieyra-os/theme/official"
)

var contactMediaID = regexp.MustCompile(`^[a-z][a-z0-9_-]{0,47}\.[a-z][a-z0-9_-]{0,63}$`)
var contactMediaDigest = regexp.MustCompile(`^[a-f0-9]{64}$`)

// Keep the persisted shape identical to Theme/runtime/media-preferences.cjs.
// Scheduling belongs to the shared media service; Core only validates and commits.
func cleanContactAvatarRotation(raw json.RawMessage) (json.RawMessage, error) {
	if len(raw) == 0 {
		return nil, nil
	}
	var value struct {
		Mode            string `json:"mode"`
		IntervalSeconds int    `json:"intervalSeconds"`
		NextAt          int64  `json:"nextAt"`
		ID              string `json:"id"`
		Digest          string `json:"digest"`
	}
	value.Mode, value.IntervalSeconds = "custom", 900
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return nil, fmt.Errorf("图像模式无效")
	}
	if err := dec.Decode(&value); err != nil {
		return nil, fmt.Errorf("图像模式无效: %w", err)
	}
	if err := dec.Decode(new(any)); err != io.EOF {
		return nil, fmt.Errorf("图像模式无效")
	}
	switch value.Mode {
	case "custom", "theme", "random", "off":
	default:
		return nil, fmt.Errorf("图像模式无效")
	}
	if value.IntervalSeconds < 60 || value.IntervalSeconds > 604800 {
		return nil, fmt.Errorf("随机时间须为 1 分钟至 7 天")
	}
	if value.NextAt < 0 || value.NextAt > 9007199254740991 {
		return nil, fmt.Errorf("随机时间无效")
	}
	if (value.ID != "" && !contactMediaID.MatchString(value.ID)) || (value.Digest != "" && !contactMediaDigest.MatchString(value.Digest)) || (value.ID == "") != (value.Digest == "") {
		return nil, fmt.Errorf("主题资源标识无效")
	}
	if value.Mode != "random" {
		value.NextAt = 0
	}
	return json.Marshal(value)
}

func contactAvatarRevision(c conversationContact) int { return max(c.AvatarRevision, c.AvatarRev) }

// A zero revision with no media preference means never configured. Explicit
// removal already increments the revision, so reopening cannot undo it.
func (m *AgentManager) initializeContactAvatar(c *conversationContact) (bool, error) {
	if c.Builtin != "" || c.Deleted || contactAvatarRevision(*c) != 0 || len(c.AvatarRotation) != 0 {
		return false, nil
	}
	image, err := thememedia.RandomAvatar()
	if err != nil {
		return false, err
	}
	if err = m.writeAvatar(c.ID, image.Data); err != nil {
		return false, err
	}
	c.AvatarRev, c.AvatarRevision, c.AvatarType = 1, 1, "image/png"
	c.AvatarRotation = rawJSON(map[string]any{"mode": "random", "intervalSeconds": 900, "nextAt": time.Now().Add(15 * time.Minute).UnixMilli(), "id": image.ID, "digest": image.Digest})
	return true, nil
}

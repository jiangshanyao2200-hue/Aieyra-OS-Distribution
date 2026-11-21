// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Tool/contract/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: CustomTool; customName; customID; CustomDigest; ValidCustomID; ValidateCustom
// Impact: python -B scripts/code-atlas.py show Tool/contract/custom.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Package contract defines compatibility checks shared by custom tools and their hosts.
package contract

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"github.com/aieyra/aieyra-os/contracts/protocol"
	"regexp"
	"strings"
)

type CustomTool struct {
	Presentation *protocol.ToolPresentation `json:"presentation,omitempty"`
	ID           string                     `json:"id"`
	Name         string                     `json:"name"`
	Description  string                     `json:"description"`
	Code         string                     `json:"code"`
	Schema       map[string]any             `json:"schema"`
	Capabilities []string                   `json:"capabilities"`
}

var customName = regexp.MustCompile(`^[a-z][a-z0-9_]{0,39}$`)
var customID = regexp.MustCompile(`^custom:[a-z][a-z0-9_]{0,39}\.[a-f0-9]{16}$`)

func CustomDigest(v CustomTool) (string, error) {
	v.ID = ""
	b, err := json.Marshal(v)
	if err != nil {
		return "", fmt.Errorf("custom tool is not JSON serializable: %w", err)
	}
	sum := sha256.Sum256(b)
	return "custom:" + v.Name + "." + hex.EncodeToString(sum[:8]), nil
}

func ValidCustomID(id string) bool { return customID.MatchString(id) }
func ValidateCustom(v CustomTool, requirePresentation bool) error {
	if !customName.MatchString(v.Name) || strings.TrimSpace(v.Description) == "" || len(v.Description) > 1000 || strings.TrimSpace(v.Code) == "" || len(v.Code) > 64<<10 {
		return fmt.Errorf("invalid tool name, description or code")
	}
	if err := ValidateSchema(v.Schema); err != nil {
		return err
	}
	if v.Schema["type"] != "object" {
		return fmt.Errorf("tool schema must describe an object")
	}
	if requirePresentation && v.Presentation == nil {
		return fmt.Errorf("tool presentation is required")
	}
	return ValidatePresentation(v.Presentation)
}

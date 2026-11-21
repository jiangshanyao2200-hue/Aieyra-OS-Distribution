// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Tool/contract/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: PackageTool; packageID; ParsePackageID; ValidPackageID; VersionedID; BaseCapability; strictJSON; DecodePackage
// Impact: python -B scripts/code-atlas.py show Tool/contract/package.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package contract

import (
	"bytes"
	"encoding/json"
	"fmt"
	"github.com/aieyra/aieyra-os/contracts/protocol"
	"io"
	"regexp"
	"strings"
	"unicode/utf8"
)

// PackageTool is an immutable implementation resolved from a verified Mod.
// Host permissions, storage and execution remain outside this contract.
type PackageTool struct {
	CustomTool
	Manual string
	Kind   string
	Native string
}

var packageID = regexp.MustCompile(`^mod:([a-z][a-z0-9_-]{0,47}(?:\.[a-z][a-z0-9_-]{0,63})+)@([a-f0-9]{64})$`)

func ParsePackageID(id string) (string, string, bool) {
	p := packageID.FindStringSubmatch(id)
	if p == nil {
		return "", "", false
	}
	return p[1], p[2], true
}
func ValidPackageID(id string) bool { _, _, ok := ParsePackageID(id); return ok }
func VersionedID(id string) bool    { return ValidCustomID(id) || ValidPackageID(id) }

func BaseCapability(name string) bool {
	switch name {
	case "terminal", "exec_command", "write_stdin", "read_shell_output", "apply_patch", "view_image":
		return true
	}
	return false
}

func strictJSON(raw []byte, value any) error {
	if len(raw) == 0 || len(raw) > 128<<10 || !utf8.Valid(raw) {
		return fmt.Errorf("invalid or oversized tool definition")
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if err := d.Decode(value); err != nil {
		return err
	}
	if d.Decode(new(any)) != io.EOF {
		return fmt.Errorf("trailing tool definition data")
	}
	return nil
}

// DecodePackage binds both client presentations to the same execution output.
// Arbitrary renderer code is not a supported view contract.
func DecodePackage(files map[string][]byte, entry, manual, desktop, text string) (PackageTool, error) {
	var definition struct {
		Schema       string         `json:"schema"`
		Executor     string         `json:"executor"`
		Name         string         `json:"name"`
		Description  string         `json:"description"`
		Entry        string         `json:"entry"`
		Input        map[string]any `json:"input"`
		Capabilities []string       `json:"capabilities"`
	}
	var result PackageTool
	if err := strictJSON(files[entry], &definition); err != nil {
		return result, err
	}
	if definition.Schema != "aieyra.tool/1" || definition.Executor != "javascript/1" {
		return result, fmt.Errorf("unsupported tool execution contract")
	}
	code, ok := files[definition.Entry]
	if !ok || !utf8.Valid(code) {
		return result, fmt.Errorf("tool implementation missing or not UTF-8")
	}
	manualBytes, ok := files[manual]
	if !ok || len(manualBytes) > 32<<10 || !utf8.Valid(manualBytes) || strings.TrimSpace(string(manualBytes)) == "" {
		return result, fmt.Errorf("bounded tool manual is required")
	}
	var view struct {
		Schema string                     `json:"schema"`
		Result string                     `json:"result"`
		View   *protocol.ToolPresentation `json:"view"`
	}
	if err := strictJSON(files[desktop], &view); err != nil {
		return result, err
	}
	if view.Schema != "aieyra.tool-view/1" || view.Result != "output" || view.View == nil || view.View.Kind != "cards" && view.View.Kind != "table" || view.View.Kind == "table" && len(view.View.Columns) == 0 {
		return result, fmt.Errorf("unsupported desktop result binding")
	}
	var fallback struct {
		Schema string `json:"schema"`
		Result string `json:"result"`
		Format string `json:"format"`
	}
	if err := strictJSON(files[text], &fallback); err != nil {
		return result, err
	}
	if fallback.Schema != "aieyra.tool-text/1" || fallback.Result != "output" || fallback.Format != "json" {
		return result, fmt.Errorf("unsupported CLI result binding")
	}
	seen := map[string]bool{}
	for _, cap := range definition.Capabilities {
		if !BaseCapability(cap) || seen[cap] {
			return result, fmt.Errorf("unsupported or duplicate tool capability: %s", cap)
		}
		seen[cap] = true
	}
	result.CustomTool = CustomTool{Name: definition.Name, Description: definition.Description, Code: string(code), Schema: definition.Input, Capabilities: definition.Capabilities, Presentation: view.View}
	result.Manual = string(manualBytes)
	return result, ValidateCustom(result.CustomTool, true)
}

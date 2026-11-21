package viewimage

import (
	_ "embed"
	"github.com/aieyra/aieyra-os/contracts/protocol"
	"strings"
)

//go:embed manual.txt
var manual string

func Definition() protocol.ToolDefinition {
	return protocol.ToolDefinition{Type: "function", Name: "view_image", Description: strings.TrimSpace(manual), Parameters: protocol.SchemaObject(map[string]any{"path": protocol.SchemaString(), "paths": map[string]any{"type": "array", "items": protocol.SchemaString(), "minItems": 2, "maxItems": composeMaxImages}, "layout": protocol.SchemaEnum("grid", "row", "column"), "detail": protocol.SchemaEnum("auto", "low", "high", "original"), "description": protocol.SchemaString()})}
}

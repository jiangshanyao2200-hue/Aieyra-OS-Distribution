package videogen

import (
	_ "embed"
	"github.com/aieyra/aieyra-os/contracts/protocol"
)

//go:embed manual.txt
var Manual string

func Definition(manual string) protocol.ToolDefinition {
	return protocol.ToolDefinition{Type: "function", Name: "video_gen", Description: manual, Parameters: protocol.SchemaObject(map[string]any{
		"action":     protocol.SchemaEnum("create", "submit", "status", "query", "download", "recover", "list"),
		"request_id": protocol.SchemaString(), "profile_id": protocol.SchemaString(), "prompt": protocol.SchemaString(),
		"duration": map[string]any{"type": "integer", "minimum": 1, "maximum": 30},
		"size":     protocol.SchemaEnum("1280x720", "720x1280", "1024x1024"),
		"offset":   map[string]any{"type": "integer", "minimum": 0}, "limit": map[string]any{"type": "integer", "minimum": 1, "maximum": 100},
	}, "action")}
}

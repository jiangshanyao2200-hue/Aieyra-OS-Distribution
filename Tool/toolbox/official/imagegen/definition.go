package imagegen

import (
	_ "embed"
	"github.com/aieyra/aieyra-os/contracts/protocol"
)

//go:embed manual.txt
var Manual string

func Definition(manual string) protocol.ToolDefinition {
	return protocol.ToolDefinition{Type: "function", Name: "image_gen", Description: manual, Parameters: protocol.SchemaObject(map[string]any{
		"action": protocol.SchemaEnum("generate", "create", "run", "status", "list", "recover"), "batch_id": protocol.SchemaString(), "request_id": protocol.SchemaString(),
		"operation": protocol.SchemaEnum("generate", "edit"), "prompt": protocol.SchemaString(), "profile_id": protocol.SchemaString(),
		"count":       map[string]any{"type": "integer", "minimum": 1, "maximum": 100},
		"items":       map[string]any{"type": "array", "maxItems": 100, "items": map[string]any{"type": "object", "additionalProperties": true}},
		"concurrency": map[string]any{"type": "integer", "minimum": 1, "maximum": 4},
		"max_items":   map[string]any{"type": "integer", "minimum": 1, "maximum": 20},
		"offset":      map[string]any{"type": "integer", "minimum": 0}, "limit": map[string]any{"type": "integer", "minimum": 1, "maximum": 100},
		"quality_reason": protocol.SchemaString(),
		"size":           protocol.SchemaEnum("auto", "1024x1024", "1536x1024", "1024x1536"), "quality": protocol.SchemaEnum("auto", "low", "medium", "high"),
		"images": map[string]any{"type": "array", "items": protocol.SchemaString(), "minItems": 1, "maxItems": 8}, "mask": protocol.SchemaString(),
	})}
}

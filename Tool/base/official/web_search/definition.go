package websearch

import (
	_ "embed"
	"github.com/aieyra/aieyra-os/contracts/protocol"
)

//go:embed manual/purpose.txt
var purpose string

//go:embed manual/method.txt
var method string

//go:embed manual/result.txt
var result string

func Definition() protocol.ToolDefinition {
	return protocol.ToolDefinition{Type: "function", Name: "web_search", Description: purpose + method + result, Parameters: protocol.SchemaObject(map[string]any{"query": protocol.SchemaString(), "description": protocol.SchemaString()}, "query")}
}

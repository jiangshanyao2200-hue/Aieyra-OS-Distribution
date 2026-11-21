// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: emptyGoogleTextPart; stringValue; numeric; nativeMessage; parseAnthropic; readAnthropic; parseGoogle; readGoogle; anthropicUsage; googleUsage; sseNative; chatIdentity; readChatTools; responseEnvelope; usage; message; reasoningEvents; readResponseStream
// Impact: python -B scripts/code-atlas.py show Core/provider_codec.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"github.com/aieyra/aieyra-os/api/codec"
	"io"
)

func emptyGoogleTextPart(p map[string]any) bool { return codec.EmptyGoogleTextPart(p) }
func stringValue(v any) string                  { return codec.StringValue(v) }
func numeric(v any) int                         { return codec.Numeric(v) }
func nativeMessage(id, finish string, parts []map[string]any, google bool) (Message, error) {
	return codec.NativeMessage(id, finish, parts, google)
}
func parseAnthropic(data []byte, send func(Event) error) (Message, *Usage, error) {
	return codec.ParseAnthropic(data, send)
}
func readAnthropic(reader io.Reader, send func(Event) error) (Message, *Usage, error) {
	return codec.ReadAnthropic(reader, send)
}
func parseGoogle(data []byte, send func(Event) error) (Message, *Usage, error) {
	return codec.ParseGoogle(data, send)
}
func readGoogle(reader io.Reader, send func(Event) error) (Message, *Usage, error) {
	return codec.ReadGoogle(reader, send)
}
func anthropicUsage(u map[string]any) *Usage { return codec.AnthropicUsage(u) }
func googleUsage(u map[string]any) *Usage    { return codec.GoogleUsage(u) }
func sseNative(reader io.Reader, dispatch func([]byte) error) error {
	return codec.ReadSSE(reader, dispatch)
}
func chatIdentity(m *Message) error { return codec.ChatIdentity(m) }
func readChatTools(reader io.Reader, send func(Event) error) error {
	return codec.ReadChatTools(reader, send)
}

// Core retains compatibility names while codecs own parsing and validation.
type responseEnvelope codec.ResponseEnvelope

func (r responseEnvelope) usage() *Usage             { return codec.ResponseEnvelope(r).UsageValue() }
func (r responseEnvelope) message() (Message, error) { return codec.ResponseEnvelope(r).Message() }
func (r responseEnvelope) reasoningEvents() []Event {
	return codec.ResponseEnvelope(r).ReasoningEvents()
}
func readResponseStream(reader io.Reader, send func(Event) error) error {
	return codec.ReadResponseStream(reader, send)
}

// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Contracts/protocol/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: ComposerAttachment
// Impact: python -B scripts/code-atlas.py show Contracts/protocol/attachment.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package protocol

import "encoding/json"

// ComposerAttachment references a content-addressed local snapshot, never the
// mutable source selected in the picker. No file bytes pass through desktop RPC.
type ComposerAttachment struct {
	Name   string `json:"name"`
	Asset  string `json:"asset"`
	SHA256 string `json:"sha256"`
	Bytes  int    `json:"bytes"`
	Kind   string `json:"kind"`
	MIME   string `json:"mime"`
	// 图N / 文件N, given when the attachment was added and kept while others are
	// removed, so "@图2" in the text still means the same picture.
	Label        string          `json:"label,omitempty"`
	WebReference json.RawMessage `json:"web_reference,omitempty"`
}

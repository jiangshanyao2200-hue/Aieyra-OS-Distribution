// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: ComposerAttachment
// Impact: python -B scripts/code-atlas.py show Core/attachment_contract.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import "github.com/aieyra/aieyra-os/contracts/protocol"

// Public attachment identity; the owning host still validates and reads assets.
type ComposerAttachment = protocol.ComposerAttachment

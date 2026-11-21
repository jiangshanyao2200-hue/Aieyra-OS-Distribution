// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/extensionhost/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: loadSource
// Impact: python -B scripts/code-atlas.py show Core/extensionhost/legacy.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package extensionhost

import (
	"bytes"
	"context"
	"path/filepath"
	"strings"

	"github.com/aieyra/aieyra-os/CORE/modules"
	program "github.com/aieyra/aieyra-os/program/contract"
)

func loadSource(ctx context.Context, source string) (*modules.Package, error) {
	if !strings.EqualFold(filepath.Ext(source), ".aieyra") {
		return modules.Load(ctx, source)
	}
	raw, err := modules.ReadSourceFile(ctx, source, modules.MaxBytes)
	if err != nil {
		return nil, err
	}
	// A modern ZIP may retain the historical suffix. Its exact modern manifest
	// and signature remain authoritative; do not reinterpret it as a JSON bundle.
	if bytes.HasPrefix(raw, []byte("PK")) {
		return modules.Load(ctx, source)
	}
	meta, err := modules.ReadSourceFile(ctx, source+".manifest.json", modules.MaxManifest)
	if err != nil {
		return nil, err
	}
	files, err := program.ConvertLegacy(meta, raw)
	if err != nil {
		return nil, err
	}
	return modules.FromFiles(files)
}

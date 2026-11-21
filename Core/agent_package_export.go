// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: maxAgentTemplateBytes; agentTemplateExport; exportAgentTemplate; archiveAgentTemplate
// Impact: python -B scripts/code-atlas.py show Core/agent_package_export.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sort"

	"github.com/aieyra/aieyra-os/CORE/extensionhost"
	"github.com/aieyra/aieyra-os/CORE/modules"
	tool "github.com/aieyra/aieyra-os/tool/contract"
)

// Keep the archive and its base64 envelope within the shared CLI RPC budget.
const maxAgentTemplateBytes = 2 << 20

type agentTemplateExport struct {
	Package  string `json:"package"`
	Filename string `json:"filename"`
	SHA256   string `json:"sha256"`
	Archive  []byte `json:"archive"`
}

func (m *AgentManager) exportAgentTemplate(ctx context.Context, actor string, p agentPackageCommand) (agentTemplateExport, error) {
	var out agentTemplateExport
	if actor != m.owner {
		return out, fmt.Errorf("only the user can export an Agent template")
	}
	identity := p.Package
	if p.ID != "" {
		r, err := m.Status(actor, p.ID)
		if err != nil {
			return out, err
		}
		if r.Instance == nil || identity != "" && identity != r.Instance.Current.Package {
			return out, fmt.Errorf("Agent template does not match the selected instance")
		}
		identity = r.Instance.Current.Package
	}
	name, digest, ok := tool.ParsePackageID(identity)
	if !ok {
		return out, fmt.Errorf("complete Agent package identity is required")
	}
	compiled, err := compiledAgentPackages()
	if err != nil {
		return out, err
	}
	source := compiled[name]
	if source == nil || source.Digest != digest {
		source, err = m.toolPackages().LoadObject(ctx, name, digest)
		if err != nil {
			return out, err
		}
	}
	if source.Digest != digest {
		return out, fmt.Errorf("exact original Agent source is unavailable")
	}
	// Only immutable public package files cross this boundary. Never reconstruct
	// a template from InstanceDefinition, Spec, overrides or the Memory service.
	archive, err := archiveAgentTemplate(ctx, source)
	if err != nil {
		return out, err
	}
	sum := sha256.Sum256(archive)
	return agentTemplateExport{Package: identity, Filename: name + "-" + source.Manifest.Version + ".zip", SHA256: hex.EncodeToString(sum[:]), Archive: archive}, nil
}

func archiveAgentTemplate(ctx context.Context, source *modules.Package) ([]byte, error) {
	p, err := modules.FromFiles(source.Files)
	if err != nil {
		return nil, err
	}
	if p.Digest != source.Digest {
		return nil, fmt.Errorf("Agent template content changed")
	}
	if _, err = extensionhost.Agent(p); err != nil {
		return nil, err
	}
	names := make([]string, 0, len(p.Files))
	total := 0
	for name, data := range p.Files {
		total += len(data)
		if total > maxAgentTemplateBytes {
			return nil, fmt.Errorf("public Agent template exceeds the 2 MiB export limit")
		}
		names = append(names, name)
	}
	sort.Strings(names)
	var buffer bytes.Buffer
	w := zip.NewWriter(&buffer)
	for _, name := range names {
		if err = ctx.Err(); err != nil {
			return nil, err
		}
		file, e := w.CreateHeader(&zip.FileHeader{Name: name, Method: zip.Deflate})
		if e != nil {
			return nil, e
		}
		if _, e = file.Write(p.Files[name]); e != nil {
			return nil, e
		}
	}
	if err = w.Close(); err != nil {
		return nil, err
	}
	if buffer.Len() > maxAgentTemplateBytes {
		return nil, fmt.Errorf("public Agent archive exceeds the 2 MiB export limit")
	}
	return buffer.Bytes(), nil
}

// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: apiAdapterSelection; sameAdapter; resolveAPIAdapter; modelRequest
// Impact: python -B scripts/code-atlas.py show Core/api_adapter.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"fmt"
	"net/http"

	"github.com/aieyra/aieyra-os/CORE/extensionhost"
	"github.com/aieyra/aieyra-os/CORE/modules"
	"github.com/aieyra/aieyra-os/CORE/platform"
	"github.com/aieyra/aieyra-os/api/adapter"
	"github.com/aieyra/aieyra-os/api/transport"
)

func (s *Settings) apiAdapterSelection() *adapter.Selection {
	if p := s.activePoolProfile(); p != nil && p.AdapterPackage != nil {
		v := *p.AdapterPackage
		return &v
	}
	return nil
}

func sameAdapter(a, b *adapter.Selection) bool {
	return a == nil && b == nil || a != nil && b != nil && *a == *b
}

// Admission checks the common registry before each HTTP request. An admitted
// request owns its decoded value; updates and disable affect subsequent calls.
func resolveAPIAdapter(ctx context.Context, config string, choice *adapter.Selection) (*adapter.Definition, error) {
	if choice == nil {
		return nil, nil
	}
	if err := choice.Validate(); err != nil {
		return nil, err
	}
	if config == "" {
		return nil, fmt.Errorf("API adapter requires a configuration owner")
	}
	layout := platform.ResolveLayout(platform.AppRoot(), config, "")
	m := extensionhost.New(layout.Packages, extensionhost.Desktop())
	r, err := m.Call(ctx, modules.Request{Action: "resolve", ID: choice.ID})
	if err != nil {
		return nil, fmt.Errorf("API适配包不可用，请重新核对或恢复内置适配：%w", err)
	}
	if r.Item == nil || r.Item.Digest != choice.Digest || r.Item.Manifest.Kind != "api" {
		return nil, fmt.Errorf("API适配包版本已变化，请重新核对后应用")
	}
	p, err := modules.Load(ctx, r.Directory)
	if err != nil {
		return nil, err
	}
	if p.Digest != choice.Digest {
		return nil, fmt.Errorf("API adapter changed during resolution")
	}
	d, err := adapter.Decode(p.Files[p.Manifest.Entrypoints["adapter"]])
	if err != nil {
		return nil, err
	}
	after, err := m.Call(ctx, modules.Request{Action: "resolve", ID: choice.ID})
	if err != nil || after.Revision != r.Revision || after.Item == nil || after.Item.Digest != choice.Digest {
		return nil, fmt.Errorf("API adapter registry changed during admission")
	}
	return &d, nil
}

func (c *Client) modelRequest(ctx context.Context, kind, model string, body any, stream bool) (*http.Request, error) {
	definition := c.adapterSnapshot
	var err error
	if definition == nil {
		definition, err = resolveAPIAdapter(ctx, c.configPath, c.adapterSelection)
	}
	if err != nil {
		return nil, err
	}
	return transport.NewRequest(ctx, transport.Connection{BaseURL: c.baseURL, Protocol: kind, Model: model, APIKey: c.apiKey, Adapter: definition}, body, stream)
}

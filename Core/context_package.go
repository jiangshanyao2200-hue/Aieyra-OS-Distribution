// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: contextPackageRegistry; resolveContextPackage; availableContextProviders
// Impact: python -B scripts/code-atlas.py show Core/context_package.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"fmt"

	"github.com/aieyra/aieyra-os/CORE/extensionhost"
	"github.com/aieyra/aieyra-os/CORE/modules"
	"github.com/aieyra/aieyra-os/CORE/platform"
	"github.com/aieyra/aieyra-os/agent/context/contract"
	"github.com/aieyra/aieyra-os/agent/context/packaged"
	port "github.com/aieyra/aieyra-os/contracts/context"
)

func contextPackageRegistry(config string) *modules.Manager {
	layout := platform.ResolveLayout(platform.AppRoot(), config, "")
	return extensionhost.New(layout.Packages, extensionhost.Desktop())
}

func resolveContextPackage(ctx context.Context, config string, ref port.Reference) (contract.Provider, error) {
	if config == "" || ref.Digest == "" {
		return nil, fmt.Errorf("Context包需要资料所有者和精确摘要；请读取可用提供者后选择")
	}
	m := contextPackageRegistry(config)
	r, err := m.Call(ctx, modules.Request{Action: "resolve", ID: ref.ID})
	if err != nil {
		return nil, fmt.Errorf("Context包不可用，原档案保留；可恢复包或显式切换提供者：%w", err)
	}
	if r.Item == nil || r.Item.Digest != ref.Digest || r.Item.Manifest.Kind != "context" || r.Item.Manifest.Version != ref.Version {
		return nil, fmt.Errorf("Context包版本已改变；请显式迁移或回滚，原档案保留")
	}
	p, err := modules.Load(ctx, r.Directory)
	if err != nil {
		return nil, err
	}
	if p.Digest != ref.Digest {
		return nil, fmt.Errorf("Context package content changed during admission")
	}
	d, err := extensionhost.Context(p)
	if err != nil {
		return nil, err
	}
	if d.StateSchema != ref.StateSchema {
		return nil, fmt.Errorf("Context state schema does not match its package")
	}
	provider, err := packaged.New(d, p.Digest)
	if err != nil {
		return nil, err
	}
	after, err := m.Call(ctx, modules.Request{Action: "resolve", ID: ref.ID})
	if err != nil || after.Revision != r.Revision || after.Item == nil || after.Item.Digest != ref.Digest {
		return nil, fmt.Errorf("Context registry changed during admission")
	}
	return provider, nil
}

func availableContextProviders(config string) ([]contract.Provider, error) {
	providers := contextProviders()
	if config == "" {
		return providers, nil
	}
	r, err := contextPackageRegistry(config).Call(context.Background(), modules.Request{Action: "list"})
	if err != nil {
		return providers, err
	}
	for _, item := range r.Items {
		if !item.Enabled || item.Manifest.Kind != "context" {
			continue
		}
		ref := port.Reference{ID: item.Manifest.ID, Version: item.Manifest.Version, StateSchema: item.Manifest.Data.Schema, Digest: item.Digest}
		provider, err := resolveContextProvider(ref, config)
		if err == nil {
			providers = append(providers, provider)
		}
	}
	return providers, nil
}

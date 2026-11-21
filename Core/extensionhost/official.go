// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/extensionhost/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: OfficialPackages; shippedPackages; officialDigests
// Impact: python -B scripts/code-atlas.py show Core/extensionhost/official.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package extensionhost

import (
	"fmt"
	"sync"

	"github.com/aieyra/aieyra-os/CORE/modules"
	agent "github.com/aieyra/aieyra-os/agent/official"
	halo "github.com/aieyra/aieyra-os/halo/official"
	program "github.com/aieyra/aieyra-os/program/official"
	toolowner "github.com/aieyra/aieyra-os/tool"
)

// OfficialPackages returns the public packages embedded by their owning modules.
// Every call decodes fresh manifests and copies every file; callers may retain
// or modify their snapshots without changing the compiled trust catalog.
func OfficialPackages() ([]*modules.Package, error) {
	classic, err := modules.FromFiles(halo.ClassicPackage())
	if err != nil {
		return nil, fmt.Errorf("invalid shipped Halo package: %w", err)
	}
	packages := []*modules.Package{classic}
	for _, id := range agent.PackageIDs() {
		files, err := agent.PackageFiles(id)
		if err != nil {
			return nil, fmt.Errorf("read shipped Agent %s: %w", id, err)
		}
		pkg, err := modules.FromFiles(files)
		if err != nil {
			return nil, fmt.Errorf("invalid shipped Agent %s: %w", id, err)
		}
		if pkg.Manifest.ID != id {
			return nil, fmt.Errorf("shipped Agent identity differs from its owner: %s", id)
		}
		if _, err := Agent(pkg); err != nil {
			return nil, fmt.Errorf("invalid shipped Agent %s: %w", id, err)
		}
		packages = append(packages, pkg)
	}
	for _, folder := range program.Folders() {
		files, err := program.PackageFiles(folder)
		if err != nil {
			return nil, err
		}
		pkg, err := modules.FromFiles(files)
		if err != nil {
			return nil, fmt.Errorf("invalid shipped Program %s: %w", folder, err)
		}
		packages = append(packages, pkg)
	}
	for _, row := range toolowner.Officials() {
		files, err := toolowner.PackageFiles(row.ID)
		if err != nil {
			return nil, err
		}
		pkg, err := modules.FromFiles(files)
		if err != nil {
			return nil, fmt.Errorf("invalid shipped tool %s: %w", row.ID, err)
		}
		if pkg.Manifest.ID != row.ID {
			return nil, fmt.Errorf("shipped tool identity differs from owner")
		}
		packages = append(packages, pkg)
	}
	return packages, nil
}

// Entries are compiled from the owning modules, never supplied by an importer.
// Keep previously supported digests here when introducing an official update
// that is intended to retain rollback compatibility.
var shippedPackages = sync.OnceValues(func() (map[string][]string, error) {
	packages, err := OfficialPackages()
	if err != nil {
		return nil, err
	}
	digests := make(map[string][]string, len(packages))
	for _, pkg := range packages {
		if _, exists := digests[pkg.Manifest.ID]; exists {
			return nil, fmt.Errorf("duplicate shipped package identity: %s", pkg.Manifest.ID)
		}
		digests[pkg.Manifest.ID] = []string{pkg.Digest}
	}
	for id, versions := range program.CompatibleDigests() {
		digests[id] = append(digests[id], versions...)
	}
	// Eyra 1.1.11 before distinguishing fault reproduction from repair experience.
	digests["aieyra.eyra"] = append(digests["aieyra.eyra"],
		"38ed36eba840a2f8ab320563e85c6b0cc9bf18a229795e1a0ab62372d5fa425e",
		"f6c4be5546d90458f45b672b3970e2ad8c29d1c4363439e7af5f3f555ca8bb91")
	// Eyra 1.1.7 from the completed R28/R29 builds. Both exact public
	// payloads remain bound to existing installations; host updates must not
	// replace their prompts or require users to reinstall before sending.
	digests["aieyra.eyra"] = append(digests["aieyra.eyra"],
		"090bd68b57e457c7ffba7db261c7b4a01465cb30cd76f620007820b3360b7e1d",
		"9304911dc9f699985b1eeb12a355ff5cae05edf3ef3feb59aac9203bead256c2")
	// Keep the previous exact Eyra package for existing bindings after Notes withdrawal.
	digests["aieyra.eyra"] = append(digests["aieyra.eyra"], "7e0ed7d337e53f1cdc7c0067fb5af22fde31dec7fb11ac17a2852a21a47028c4")
	// Eyra 1.0.0 before public prompt consolidation. Keep the exact shipped
	// identity for installed instances, disabled bindings and explicit rollback.
	digests["aieyra.eyra"] = append(digests["aieyra.eyra"], "23f1f4b3da2f2a23b53b08f3e9d68207d922bc41d3a4f22008645bbeb5351338")
	// Eyra 1.1.4 before round 100's two public prompt removals. Keep existing
	// installed bindings and explicit rollback without replacing their payloads.
	digests["aieyra.eyra"] = append(digests["aieyra.eyra"], "79f926c986df60a5df61f1b57de532f9dd0286296f4bd1e5433d6b4d035e4309")
	// Eyra 1.1.4 before the retired Notes manual was removed in round 103.
	// Existing Agent bindings are not automatically replaced by host updates.
	digests["aieyra.eyra"] = append(digests["aieyra.eyra"], "d5cf1cb6a508c5024434c1f83bebd549740b8f5647832ffa0bd9b39d7dba7750")
	// Eyra 1.1.4 before the owner's four-layer prompts became the official defaults
	// (2026-11-10). Installed bindings keep their payload until explicitly updated.
	digests["aieyra.eyra"] = append(digests["aieyra.eyra"], "70cee234ba2ed6773cac163d7d83d1c128575e9dfdacd40f3914bb2952907066")
	// Eyra 1.1.4 before the Workspace software API manual changed in round 107.
	// All 178 payload files match the prior completed build; keep installed
	// bindings without substituting prompts, re-enabling or reinstalling them.
	digests["aieyra.eyra"] = append(digests["aieyra.eyra"], "b189d8fcd519aa40ffd586b06417737abee7617a7eda35018ec991a1912d63db")
	// Eyra 1.1.4 before round 109 documented Coding delegation in the agents
	// manual. Installed bindings keep their payload until explicitly updated.
	digests["aieyra.eyra"] = append(digests["aieyra.eyra"], "067d40914e7e9d644adc30459c54993644e567e8d9f6343ce75d2856a5c46c66")
	// Pre-round-87 bindings remain valid; a role redesign must not silently
	// replace installed instances, discard their context or revive a disable.
	digests["aieyra.eyra"] = append(digests["aieyra.eyra"], "32ae07a68a17edb45ee3f8dba82f45960089b702475431f1a83ff878b748129f")
	digests["aieyra.cota"] = append(digests["aieyra.cota"], "9c2ef6da12fa4827f345211c8e3bd9b8148adb80b413917c459f778610c41cbb")
	digests["aieyra.vaya"] = append(digests["aieyra.vaya"], "0516016734ebe09c98db08f78f6c482f74af093bce44dbbd7657bbca9ff358a2")
	// Exact Cota/Vaya 1.1.2 packages before round 114 added common memory.
	// Existing Agent bindings are preserved, so their dependency digests must
	// remain admissible without replacing private prompts or reviving disables.
	digests["aieyra.cota"] = append(digests["aieyra.cota"], "c66908a52bd6d5bb74b40a0250321bcd29e3900bbe261b644f4da7aa8350fc70")
	// Cota 1.1.3 before the shared report default; existing bindings remain exact.
	digests["aieyra.cota"] = append(digests["aieyra.cota"], "e41eafc72125e8cd56cbb8acef1f58bfd223dff00897fb5368b9dfc0c0b134a3")
	digests["aieyra.vaya"] = append(digests["aieyra.vaya"], "6a62d5a7c3296a47073f94d4fbd2033d10e099ddac185545e7a63dc1a1781603")
	// Keep the previously shipped Agent payloads used by existing bindings.
	// The canonical manifests and all declared files match the recorded packages.
	digests["aieyra.cota"] = append(digests["aieyra.cota"], "96c60a193966eebd794104e62b877e2aba0d0959b779fc9f51af5f2f44f968be")
	digests["aieyra.vaya"] = append(digests["aieyra.vaya"], "47c5dbd2925b04b2aee23a867a9762f1cd81cb27fbe199f8512486f021c5e58a")
	digests["aieyra.eyra"] = append(digests["aieyra.eyra"], "47fb5e8d7a89f496ef6f823d862ab17f3dc046a5acd91b7c695b0fefad2432e6")
	return digests, nil
})

func officialDigests() (map[string][]string, error) {
	shipped, err := shippedPackages()
	copy := make(map[string][]string, len(shipped))
	for id, digests := range shipped {
		copy[id] = append([]string(nil), digests...)
	}
	return copy, err
}

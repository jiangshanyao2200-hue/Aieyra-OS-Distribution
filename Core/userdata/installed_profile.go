// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/userdata/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: installedProfileFile; installationProfile; installedProfile; PrepareInstalledProfile
// Impact: python -B scripts/code-atlas.py show Core/userdata/installed_profile.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package userdata

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/aieyra/aieyra-os/contracts/storage"
)

const installedProfileFile = ".aieyra-installation.json"

type installationProfile struct {
	Schema int    `json:"schema"`
	Root   string `json:"dataRoot"`
	ID     string `json:"profileId"`
}

func installedProfile(root string) (storage.Profile, bool, error) {
	file := filepath.Join(root, installedProfileFile)
	info, err := os.Lstat(file)
	if os.IsNotExist(err) {
		return storage.Profile{}, false, nil
	}
	if err != nil {
		return storage.Profile{}, true, err
	}
	if !info.Mode().IsRegular() || info.Size() > 8192 {
		return storage.Profile{}, true, fmt.Errorf("安装资料声明无效")
	}
	raw, err := os.ReadFile(file)
	var binding installationProfile
	if err != nil || json.Unmarshal(raw, &binding) != nil || binding.Schema != 1 ||
		!filepath.IsAbs(binding.Root) || binding.ID == "" {
		return storage.Profile{}, true, fmt.Errorf("安装资料声明无法读取")
	}
	if err := ordinary(binding.Root); err != nil {
		return storage.Profile{}, true, err
	}
	marker, err := storage.ReadMarker(binding.Root)
	if err != nil || marker == nil || marker.ID != binding.ID || marker.State == "initializing" {
		return storage.Profile{}, true, fmt.Errorf("找不到安装时选定的资料，请检查资料目录：%s", binding.Root)
	}
	config, err := storage.ResolveConfig(filepath.Join(binding.Root, marker.Config))
	if err != nil {
		return storage.Profile{}, true, err
	}
	if err := validateConfig(config); err != nil {
		return storage.Profile{}, true, err
	}
	profile, err := storage.Bind(config)
	return profile, true, err
}

// PrepareInstalledProfile binds a fresh product directory to the selected
// private profile. The default in-installation Data directory needs no pointer.
func PrepareInstalledProfile(stage, finalRoot, dataRoot string) error {
	if strings.EqualFold(dataRoot, filepath.Join(finalRoot, "Data")) {
		_, err := Init(filepath.Join(stage, "Data"))
		return err
	}
	profile, err := Init(dataRoot)
	if err != nil {
		return err
	}
	if err := validateConfig(profile.Config); err != nil {
		return err
	}
	marker, err := storage.ReadMarker(dataRoot)
	if err != nil {
		return err
	}
	if marker == nil || marker.State != "ready" {
		return fmt.Errorf("用户资料尚未就绪")
	}
	data, err := json.Marshal(installationProfile{Schema: 1, Root: dataRoot, ID: marker.ID})
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(stage, installedProfileFile), data, 0600)
}

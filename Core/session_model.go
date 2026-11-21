// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: SessionModelPath; ApplySessionModel
// Impact: python -B scripts/code-atlas.py show Core/session_model.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

// 与 Client/Desktop/session-model.cjs 共用路径；只保存模型 ID，不复制连接或密钥。
func SessionModelPath(config, session string) string {
	if config == "" || session == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(session))
	return filepath.Join(config+".sessions", hex.EncodeToString(sum[:])+".json")
}

func ApplySessionModel(s *Settings, session string) error {
	path := SessionModelPath(s.Path(), session)
	if path == "" {
		return nil
	}
	raw, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("无法读取会话模型选择：%w", err)
	}
	var selection struct {
		Version int     `json:"schema_version"`
		Profile *string `json:"profile_id"`
	}
	if json.Unmarshal(raw, &selection) != nil || selection.Version != 1 || selection.Profile == nil {
		return fmt.Errorf("会话模型选择文件损坏，请检查后重新选择；未回退到其他模型")
	}
	if *selection.Profile == "" {
		return nil
	}
	if s.ModelPoolVersion != 1 {
		// 旧格式读后仅在内存升级；会话选择不把用户全局配置顺便改写。
		s.ModelPoolVersion = 1
		for i := range s.APIProfiles {
			p := &s.APIProfiles[i]
			if p.ConnectionID == "" {
				p.ConnectionID = "legacy-session-" + p.ID
				s.ProviderConnections = append(s.ProviderConnections, ProviderConnection{ID: p.ConnectionID, BaseURL: p.BaseURL, APIKey: p.APIKey, APIKeyHistory: p.APIKeyHistory, RequestTimeout: s.RequestTimeout})
			}
		}
	}
	s.ActiveProfile = *selection.Profile
	s.applyPoolProfile()
	return s.ValidatePoolRequest()
}

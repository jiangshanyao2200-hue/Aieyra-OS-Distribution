// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: saveConversationResult; conversationResult
// Impact: python -B scripts/code-atlas.py show Core/conversation_results.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"fmt"
	"os"
	"path/filepath"
	"unicode/utf8"
)

// Agent records keep a bounded summary. A conversation's complete final result
// is a separate immutable artifact so group previews cannot lose its tail.
func (m *AgentManager) saveConversationResult(id string, generation int, text string) error {
	if len(text) <= 64<<10 {
		return nil
	}
	dir := filepath.Join(m.dir, "results", id)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	return atomicWorkspaceFile(dir, fmt.Sprintf("%d.txt", generation), []byte(text))
}
func (m *AgentManager) conversationResult(id string, generation int, fallback string) (string, error) {
	if !sessionIDPattern.MatchString(id) || generation < 1 {
		return fallback, nil
	}
	file := filepath.Join(m.dir, "results", id, fmt.Sprintf("%d.txt", generation))
	info, err := os.Stat(file)
	if os.IsNotExist(err) {
		return fallback, nil
	}
	if err != nil {
		return "", err
	}
	if !info.Mode().IsRegular() || info.Size() > 8<<20 {
		return "", fmt.Errorf("完整结果超过单次展示的 8 MiB 上限，原文件保留：%s", file)
	}
	data, err := os.ReadFile(file)
	if err != nil {
		return "", err
	}
	if !utf8.Valid(data) {
		return "", fmt.Errorf("完整结果不是有效 UTF-8，原文件保留")
	}
	return string(data), nil
}

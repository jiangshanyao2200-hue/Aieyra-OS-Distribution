// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: childPromptID; childPromptFile; loadChildPrompt
// Impact: python -B scripts/code-atlas.py show Core/child_prompts.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"fmt"
	"github.com/aieyra/aieyra-os/contracts/storage"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"unicode/utf8"
)

var childPromptID = regexp.MustCompile(`^[a-f0-9]{32}$`)

func childPromptFile(config, id string) (string, error) {
	if !childPromptID.MatchString(id) {
		return "", fmt.Errorf("子代提示词 ID 无效")
	}
	profile, err := storage.Bind(config)
	if err != nil {
		return "", err
	}
	base := profile.Overrides
	return filepath.Join(base, "Prompt", "子代", id, "提示词.txt"), nil
}

func loadChildPrompt(config, id, original string) (string, error) {
	file, err := childPromptFile(config, id)
	if err != nil {
		return "", err
	}
	if _, err := os.Stat(file); os.IsNotExist(err) {
		template, err := readPromptResource("子代/模板/提示词.txt")
		if err != nil {
			return "", err
		}
		if err := os.MkdirAll(filepath.Dir(file), 0700); err != nil {
			return "", err
		}
		out, err := os.OpenFile(file, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if err != nil && !os.IsExist(err) {
			return "", err
		}
		if err == nil {
			_, writeErr := io.WriteString(out, template+"\n\n"+original)
			closeErr := out.Close()
			if writeErr != nil {
				_ = os.Remove(file)
				return "", writeErr
			}
			if closeErr != nil {
				_ = os.Remove(file)
				return "", closeErr
			}
		}
	}
	info, err := os.Stat(file)
	if err != nil || !info.Mode().IsRegular() || info.Size() > 256<<10 {
		return "", fmt.Errorf("子代提示词缺失或无效：%s", file)
	}
	data, err := os.ReadFile(file)
	if err != nil || !utf8.Valid(data) {
		return "", fmt.Errorf("子代提示词读取失败或不是 UTF-8")
	}
	return NormalizePrompt(string(data)), nil
}

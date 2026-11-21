// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: ResourceRoot; readPromptResource; runtimePrompt; formatPromptText; jsonResourceCache; jsonResource; catalogResource; catalogResourceCache; currentCatalog; configResource; ReadRuntimeConfig; validatePromptResources; validateRuntimeResources; DataDir; UsePrivateProfile; ValidatePrivateProfile; PrivatePaths
// Impact: python -B scripts/code-atlas.py show Core/runtime_resources.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"bytes"
	"encoding/json"
	"fmt"
	"github.com/aieyra/aieyra-os/CORE/platform"
	"github.com/aieyra/aieyra-os/api/catalog"
	"github.com/aieyra/aieyra-os/contracts/storage"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"unicode/utf8"
)

// ResourceRoot separates readable configuration/prompts from executable code.
// Source lookup is limited to Go test binaries; installed applications use their
// actual installation (or an explicitly supplied root), never an old checkout.
func ResourceRoot() string {
	if root := strings.TrimSpace(os.Getenv("AIEYRA_RESOURCE_ROOT")); root != "" {
		return filepath.Clean(root)
	}
	root := platform.AppRoot()
	if strings.HasSuffix(os.Args[0], ".test") || strings.HasSuffix(os.Args[0], ".test.exe") {
		if _, err := os.Stat(filepath.Join(root, "Config", "提示词索引.json")); err != nil {
			_, source, _, _ := runtime.Caller(0)
			candidate := filepath.Dir(filepath.Dir(source))
			if _, err := os.Stat(filepath.Join(candidate, "Config", "提示词索引.json")); err == nil {
				return candidate
			}
		}
	}
	return root
}

func readPromptResource(name string) (string, error) {
	parts := strings.SplitN(name, "#", 2)
	if filepath.IsAbs(parts[0]) || strings.Contains(parts[0], "..") {
		return "", fmt.Errorf("提示词资源路径无效：%s", name)
	}
	file, err := promptResourcePath(name)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(file)
	if err != nil {
		return "", fmt.Errorf("读取提示词 %s：%w", name, err)
	}
	if !info.Mode().IsRegular() || info.Size() > 256<<10 {
		return "", fmt.Errorf("提示词 %s 必须是最多 256 KiB 的普通文件", name)
	}
	data, err := os.ReadFile(file)
	if err != nil || !utf8.Valid(data) {
		return "", fmt.Errorf("提示词 %s 读取失败或不是 UTF-8", name)
	}
	text := strings.ReplaceAll(strings.TrimPrefix(string(data), "\uFEFF"), "\r\n", "\n")
	if len(parts) == 2 && strings.TrimSpace(text) != "" {
		marker := "## " + parts[1] + "\n"
		start := strings.Index(text, marker)
		if start < 0 {
			return "", fmt.Errorf("提示词 %s 缺少分节", name)
		}
		text = text[start+len(marker):]
		if end := strings.Index(text, "\n## "); end >= 0 {
			text = text[:end]
		} else {
			text = strings.TrimSuffix(text, "\n")
		}
	}
	return text, nil
}

// Request assembly reads fresh files. Validation reports unavailable resources
// before a model request, so missing files cannot silently change behaviour.
func runtimePrompt(name string) string { text, _ := readPromptResource(name); return text }

// External prose may omit slots or contain literal percentages. Only the
// documented %s/%d/%v/%q slots consume arguments; user text is never a format
// program, and unused values do not appear as Go formatting diagnostics.
func formatPromptText(text string, args ...any) string {
	var out strings.Builder
	arg := 0
	for i := 0; i < len(text); i++ {
		if text[i] == '%' && i+1 < len(text) {
			if text[i+1] == '%' {
				out.WriteByte('%')
				i++
				continue
			}
			if strings.ContainsRune("sdvq", rune(text[i+1])) && arg < len(args) {
				out.WriteString(fmt.Sprintf(text[i:i+2], args[arg]))
				arg++
				i++
				continue
			}
		}
		out.WriteByte(text[i])
	}
	return out.String()
}

var jsonResourceCache = struct {
	sync.Mutex
	rows map[string]jsonResource
}{rows: map[string]jsonResource{}}

type jsonResource struct {
	stamp string
	data  []byte
}

type catalogResource = catalog.Catalog

var catalogResourceCache = struct {
	sync.Mutex
	source []byte
	value  catalogResource
}{}

func currentCatalog() catalogResource {
	data, err := configResource("模型目录.json")
	if err != nil {
		return catalogResource{}
	}
	catalogResourceCache.Lock()
	defer catalogResourceCache.Unlock()
	// The generic cache reuses the backing bytes until an atomic file change.
	if len(catalogResourceCache.source) != len(data) || len(data) > 0 && &catalogResourceCache.source[0] != &data[0] {
		next, err := catalog.Parse(data)
		if err != nil {
			return catalogResource{}
		}
		catalogResourceCache.source, catalogResourceCache.value = data, next
	}
	return catalogResourceCache.value
}

func configResource(name string) ([]byte, error) {
	if filepath.IsAbs(name) || strings.Contains(name, "..") {
		return nil, fmt.Errorf("配置资源路径无效：%s", name)
	}
	file := filepath.Join(ResourceRoot(), "Config", name)
	info, err := os.Stat(file)
	if err != nil {
		return nil, fmt.Errorf("配置资源 %s 不可用：%w", name, err)
	}
	if !info.Mode().IsRegular() || info.Size() > 16<<20 {
		return nil, fmt.Errorf("配置资源 %s 无效或过大", name)
	}
	stamp := fmt.Sprintf("%d:%d", info.ModTime().UnixNano(), info.Size())
	jsonResourceCache.Lock()
	defer jsonResourceCache.Unlock()
	if old, ok := jsonResourceCache.rows[file]; ok && old.stamp == stamp {
		return old.data, nil
	}
	data, err := os.ReadFile(file)
	data = bytes.TrimPrefix(data, []byte{0xef, 0xbb, 0xbf})
	if err != nil || !utf8.Valid(data) || !json.Valid(data) {
		return nil, fmt.Errorf("配置资源 %s 不是有效的 UTF-8 JSON", name)
	}
	jsonResourceCache.rows[file] = jsonResource{stamp, data}
	return data, nil
}

// ReadRuntimeConfig loads the same external JSON for engine and CLI consumers.
// Decoded values cannot mutate the shared byte cache.
func ReadRuntimeConfig(name string, target any) error {
	data, err := configResource(name)
	if err != nil {
		return err
	}
	if err := json.Unmarshal(data, target); err != nil {
		return fmt.Errorf("配置资源 %s 内容无效：%w", name, err)
	}
	return nil
}

func validatePromptResources() error {
	data, err := configResource("提示词索引.json")
	if err != nil {
		return fmt.Errorf("提示词索引不可用：%w", err)
	}
	var index struct {
		Resources []struct {
			File string `json:"file"`
		} `json:"resources"`
	}
	if err := json.Unmarshal(data, &index); err != nil {
		return fmt.Errorf("提示词索引无效：%w", err)
	}
	if len(index.Resources) == 0 {
		return fmt.Errorf("提示词索引没有资源")
	}
	for _, row := range index.Resources {
		if _, err := readPromptResource(row.File); err != nil {
			return err
		}
	}
	return nil
}

func validateRuntimeResources() error {
	for _, name := range []string{"默认设置.json", "运行参数.json", "模型资料.json", "OpenCode模型.json"} {
		if _, err := configResource(name); err != nil {
			return err
		}
	}
	_, err := configResource("模型目录.json")
	if err != nil {
		return err
	}
	if currentCatalog().Count() == 0 {
		return fmt.Errorf("模型目录缺少有效的 models 数据")
	}
	return validatePromptResources()
}

// Canonical configurations use Config/, while mutable history lives in Data/.
// Explicit configurations elsewhere retain their existing adjacent data paths.
func DataDir(config string) string {
	return storage.Bound(config).Root
}

// UsePrivateProfile pins process-level prompt resources until its host exits.
func UsePrivateProfile(config string) (func(), error) { return storage.Use(config) }

// ValidatePrivateProfile must precede filesystem effects in public services.
func ValidatePrivateProfile(config string) error { _, err := storage.Bind(config); return err }

// PrivatePaths resolves declared ownership areas without accessing or moving data.
func PrivatePaths(config string) storage.Paths { return storage.Resolve(DataDir(config)) }

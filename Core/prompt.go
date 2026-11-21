// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: Layer; Empty; LayerIDs; layerSpec; PromptLayer; promptLayerFile; LoadPromptLayers; DefaultPromptResourceDir; LoadPromptLayersWithDefaults; loadPromptLayers; AssemblePrompt; NormalizePrompt; ResolvePromptDir; DefaultPromptDir; PromptStatus; LoadPrompts; MissingPromptFiles; matrixPromptDir
// Impact: python -B scripts/code-atlas.py show Core/prompt.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"fmt"
	"github.com/aieyra/aieyra-os/contracts/storage"
	"io"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"
)

// 提示词层的文件名。它们从外部目录读取，**不内嵌进二进制**。
//
// 设计原则：程序里不写死任何人格、边界或基调文案。所有基准提示词都是运行时可替换的
// 外部文件，这样程序变大以后，用户仍能在不改代码、不重新编译的前提下自定义人格。
const (
	PromptFileBase     = "基础.txt"
	PromptFileThinking = "思考方式.txt"
	PromptFileSelf     = "自我.txt"
	PromptFileWork     = "工作.txt"
	PromptFileBoundary = "边界.txt"
)

// Layer 描述一份提示词文件及其加载结果。
type Layer struct {
	ID     string // self / work / boundary / thinking
	File   string
	Title  string
	Path   string // 实际读到的绝对路径；为空表示未找到
	Body   string // 已清理的正文；为空表示该层没有内容
	Source string // custom / default / missing
}

// Empty 表示该层没有内容（文件缺失或为空），拼装时会整层跳过。
func (l Layer) Empty() bool { return strings.TrimSpace(l.Body) == "" }

// 四类默认与自定义一一对应；旧基础文件保留在磁盘但不再参与请求。
func LayerIDs() []string { return []string{"self", "work", "boundary", "thinking"} }

// layerSpec 是层定义的内部表。
func layerSpec(id string) (file, title string, ok bool) {
	switch id {
	case "thinking":
		return PromptFileThinking, "思考方式", true
	case "self":
		return PromptFileSelf, "人格与沟通", true
	case "work":
		return PromptFileWork, "执行与工作", true
	case "boundary":
		return PromptFileBoundary, "安全与边界", true
	}
	return "", "", false
}

// PromptLayer 读取单层内容。
func PromptLayer(dir, id string) (Layer, error) {
	return promptLayerFile(id, func(file string) (string, error) {
		if strings.TrimSpace(dir) == "" {
			return "", nil
		}
		return filepath.Join(dir, file), nil
	})
}

func promptLayerFile(id string, locate func(string) (string, error)) (Layer, error) {
	file, title, ok := layerSpec(id)
	if !ok {
		return Layer{}, fmt.Errorf("未知提示词层 %q", id)
	}
	l := Layer{ID: id, File: file, Title: title}
	path, err := locate(file)
	if err != nil {
		return l, err
	}
	if path == "" {
		return l, nil
	}
	f, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			// 文件不存在不是错误：该层就是空的，拼装时跳过。
			return l, nil
		}
		return l, fmt.Errorf("读取提示词 %s 失败: %w", path, err)
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() > 256<<10 {
		return l, fmt.Errorf("提示词 %s 必须是最多 256 KiB 的普通 UTF-8 文件", path)
	}
	data, err := io.ReadAll(io.LimitReader(f, (256<<10)+1))
	if err != nil || len(data) > 256<<10 || !utf8.Valid(data) {
		return l, fmt.Errorf("提示词 %s 读取失败、过大或不是 UTF-8", path)
	}
	l.Path = path
	l.Body = NormalizePrompt(string(data))
	return l, nil
}

// LoadPromptLayers 按固定顺序读取全部提示词层。
func LoadPromptLayers(dir string) ([]Layer, error) {
	ids := LayerIDs()
	out := make([]Layer, 0, len(ids))
	for _, id := range ids {
		l, err := PromptLayer(dir, id)
		if err != nil {
			return out, err
		}
		out = append(out, l)
	}
	return out, nil
}

// DefaultPromptResourceDir is the legacy location for explicit directory callers.
// Runtime defaults resolve each logical layer through the shared resource index.
func DefaultPromptResourceDir() string {
	return filepath.Join(ResourceRoot(), "Prompt", "Matrix", "默认")
}

func LoadPromptLayersWithDefaults(dir, defaults string) ([]Layer, error) {
	return loadPromptLayers(dir, func(id string) (Layer, error) { return PromptLayer(defaults, id) })
}

// A missing personal layer may fall back; an intentionally empty file may not.
func loadPromptLayers(dir string, fallbackLayer func(string) (Layer, error)) ([]Layer, error) {
	layers, err := LoadPromptLayers(dir)
	if err != nil {
		return layers, err
	}
	for i := range layers {
		layers[i].Source = "custom"
		if layers[i].Path != "" {
			continue
		}
		fallback, e := fallbackLayer(layers[i].ID)
		if e != nil {
			return layers, e
		}
		fallback.Source = "default"
		if fallback.Path == "" {
			fallback.Source = "missing"
		}
		layers[i] = fallback
	}
	return layers, nil
}

// AssemblePrompt 把各层拼装成一份完整提示词。
//
// 空层整层跳过（连标题也不输出）：用户在补齐文件之前不会看到空章节。
func AssemblePrompt(layers []Layer) string {
	var sections []string
	for _, l := range layers {
		if l.Empty() {
			continue
		}
		sections = append(sections, l.Body)
	}
	return strings.Join(sections, "\n\n")
}

// NormalizePrompt 清理正文：统一换行、去掉文件头的说明注释、整理首尾空白。
//
// 约定：以 <!-- ... --> 开头的块是给人看的说明，不进入提示词。
func NormalizePrompt(raw string) string {
	// BOM 会污染 system 首字，先剥掉（TrimSpace 去不掉 U+FEFF）。
	s := strings.TrimPrefix(raw, "\uFEFF")
	s = strings.ReplaceAll(s, "\r\n", "\n")
	s = strings.ReplaceAll(s, "\r", "\n")
	s = strings.TrimSpace(s)
	for strings.HasPrefix(s, "<!--") {
		end := strings.Index(s, "-->")
		if end < 0 {
			break
		}
		s = strings.TrimSpace(s[end+3:])
	}
	return s
}

// ResolvePromptDir 按优先级找到一个存在的提示词目录。
//
// 顺序：显式指定 > 已归属角色的私人目录 > 旧 Prompt/ > 用户配置目录 Prompt/。
// 此函数只确定个人目录；LoadPrompts 为缺失层加载独立的官方默认资源。
func ResolvePromptDir(explicit string) string {
	if p, ok := storage.Active(); ok && explicit != "" {
		explicit = p.Relocate(explicit)
	}
	if strings.TrimSpace(explicit) != "" {
		if abs, err := filepath.Abs(explicit); err == nil {
			return matrixPromptDir(abs)
		}
		return matrixPromptDir(explicit)
	}
	if p, ok := storage.Active(); ok {
		role := filepath.Join(storage.Resolve(p.Root).Agents, "Eyra", "prompts")
		if info, err := os.Stat(role); err == nil && info.IsDir() {
			return role
		}
		if p.Unified {
			return filepath.Join(p.Overrides, "Prompt", "Matrix")
		}
	}
	var candidates []string
	if exe, err := os.Executable(); err == nil {
		base := filepath.Dir(exe)
		candidates = append(candidates, filepath.Join(base, "Data", "Agents", "Eyra", "prompts"), filepath.Join(base, "Prompt"))
	}
	if cwd, err := os.Getwd(); err == nil {
		candidates = append(candidates, filepath.Join(cwd, "Data", "Agents", "Eyra", "prompts"), filepath.Join(cwd, "Prompt"))
	}
	candidates = append(candidates, DefaultPromptDir())

	for _, c := range candidates {
		if info, err := os.Stat(c); err == nil && info.IsDir() {
			return matrixPromptDir(c)
		}
	}
	// 首次保存写入用户目录，不写安装目录；只读装载不创建文件。
	return DefaultPromptDir()
}

// DefaultPromptDir 返回用户配置目录下的 Prompt 路径。
func DefaultPromptDir() string {
	dir, err := os.UserConfigDir()
	if err != nil {
		if home, herr := os.UserHomeDir(); herr == nil {
			dir = filepath.Join(home, ".config")
		} else {
			dir = "."
		}
	}
	return filepath.Join(dir, "AieyraOS", "Prompt", "Matrix")
}

// PromptStatus 是对外暴露的提示词装载概况，供界面与命令行展示。
type PromptStatus struct {
	Dir    string
	Layers []Layer
	Text   string
}

// LoadPrompts 是加载提示词的总入口。
//
// 返回的 error 只表示「读取过程出错」（如权限、IO）；文件缺失属于正常情况，
// 会体现在各层的 Empty() 上（TestLoadPromptsMissingDir 锁定此行为）。
// 命令行显式 --prompt-dir 打错路径的响亮报错在 app.LoadPrompts 做，
// 这里保持宽容以免误伤库调用方。
func LoadPrompts(dir string) (PromptStatus, error) {
	resolved := ResolvePromptDir(dir)
	layers, err := loadPromptLayers(resolved, func(id string) (Layer, error) {
		return promptLayerFile(id, func(file string) (string, error) {
			return promptResourcePath("Matrix/默认/" + file)
		})
	})
	st := PromptStatus{Dir: resolved, Layers: layers, Text: AssemblePrompt(layers)}
	if err != nil {
		return st, err
	}
	return st, nil
}

// MissingPromptFiles 返回在给定目录下缺失的层文件名。
// 只有“文件不存在”算缺失：权限等 IO 错误不再混入，
// 否则用户会去补文件而不是修权限（M3/G10 同类）。
// 如需区分 IO 错误，请直接调 PromptLayer 看 error。
func MissingPromptFiles(dir string) []string {
	var out []string
	for _, id := range LayerIDs() {
		file, _, ok := layerSpec(id)
		if !ok {
			continue
		}
		if strings.TrimSpace(dir) == "" {
			out = append(out, file)
			continue
		}
		data, err := os.ReadFile(filepath.Join(dir, file))
		if err != nil {
			if os.IsNotExist(err) {
				out = append(out, file)
			}
			// 非 IsNotExist 的错误（权限等）不算“缺失”，调用方另行处理。
			continue
		}
		if strings.TrimSpace(NormalizePrompt(string(data))) == "" {
			out = append(out, file)
		}
	}
	return out
}

// A legacy explicit flat directory stays usable; canonical installs use Matrix/.
func matrixPromptDir(dir string) string {
	child := filepath.Join(dir, "Matrix")
	if info, err := os.Stat(child); err == nil && info.IsDir() {
		return child
	}
	return dir
}

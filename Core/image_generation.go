// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: imageGenTaskKey; ImageGenToolDefinition; readEditInput; inspectGeneratedImage; generatedIndex; imageIndexLocks; imageIndexLock; readLegacyGeneratedIndex; saveGeneratedImage; runImageGenImmediate
// Impact: python -B scripts/code-atlas.py show Core/image_generation.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/aieyra/aieyra-os/CORE/internal/privatefile"
	"github.com/aieyra/aieyra-os/contracts/storage"
	"github.com/aieyra/aieyra-os/tool/toolbox/official/imagegen"
	"image"
	"io"
	"os"
	"path/filepath"
	"sync"
)

type imageGenTaskKey struct{}

func ImageGenToolDefinition() ToolDefinition            { return imagegen.Definition(ImageGenManual()) }
func readEditInput(path string) (imageEditInput, error) { return imagegen.ReadEditInput(path) }
func inspectGeneratedImage(data []byte) (string, error) { return imagegen.Inspect(data) }

type generatedIndex struct {
	Version int              `json:"version"`
	Images  []generatedImage `json:"images"`
}

var imageIndexLocks sync.Map

func imageIndexLock(dir string) *sync.Mutex {
	v, _ := imageIndexLocks.LoadOrStore(filepath.Clean(dir), &sync.Mutex{})
	return v.(*sync.Mutex)
}
func readLegacyGeneratedIndex(dir string) (generatedIndex, error) {
	index := generatedIndex{Version: 1, Images: []generatedImage{}}
	f, err := os.Open(filepath.Join(dir, "index.json"))
	if errors.Is(err, os.ErrNotExist) {
		return index, nil
	}
	if err != nil {
		return index, err
	}
	defer f.Close()
	raw, err := io.ReadAll(io.LimitReader(f, 8*1024*1024+1))
	if err != nil {
		return index, err
	}
	index = generatedIndex{}
	if len(raw) > 8*1024*1024 || json.Unmarshal(raw, &index) != nil || index.Version != 1 || index.Images == nil {
		return index, fmt.Errorf("生成图片索引损坏，请保留 index.json 并恢复备份后重试；原图不会被删除")
	}
	return index, nil
}
func saveGeneratedImage(dir string, data []byte, item generatedImage) (generatedImage, error) {
	lock := imageIndexLock(dir)
	lock.Lock()
	defer lock.Unlock()
	_, err := readLegacyGeneratedIndex(dir)
	if err != nil {
		return item, err
	}
	format, err := inspectGeneratedImage(data)
	if err != nil {
		return item, err
	}
	sum := sha256.Sum256(data)
	item.ID = hex.EncodeToString(sum[:])
	item.Path = filepath.Join(dir, item.ID+"."+format)
	item.MIME = "image/" + format
	cfg, _, _ := image.DecodeConfig(bytes.NewReader(data))
	item.Width, item.Height = cfg.Width, cfg.Height
	if old, err := os.ReadFile(item.Path); err == nil {
		if !bytes.Equal(old, data) {
			return item, fmt.Errorf("生成图片原件损坏，请保留文件并检查磁盘")
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return item, err
	} else if err = privatefile.Write(item.Path, data); err != nil {
		return item, err
	}
	// Each immutable image owns one metadata file. Long-running production no
	// longer rewrites a growing 4000-image JSON document for every new output.
	entries := filepath.Join(dir, "entries")
	if err := os.MkdirAll(entries, 0700); err != nil {
		return item, err
	}
	meta := filepath.Join(entries, item.ID+".json")
	if _, err := os.Stat(meta); err == nil {
		return item, nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return item, err
	}
	raw, err := json.Marshal(item)
	if err != nil {
		return item, err
	}
	if err = privatefile.Write(meta, raw); err != nil {
		return item, err
	}
	return item, nil
}

func runImageGenImmediate(ctx context.Context, config string, raw json.RawMessage) (imageGenResult, error) {
	releaseOwner, err := storage.Enter(config)
	if err != nil {
		return imageGenResult{State: "rejected"}, err
	}
	defer releaseOwner()
	if err := ValidatePrivateProfile(config); err != nil {
		return imageGenResult{State: "rejected"}, err
	}
	var selected imageGenChoice
	var generate imageGenFunc
	dir := PrivatePaths(config).GeneratedImages
	task, _ := ctx.Value(imageGenTaskKey{}).(string)
	invocation, _ := ctx.Value(toolInvocationKey{}).(string)
	writer, _ := ctx.Value(imageUsageWriterKey{}).(func(AgentUsage) error)
	return imagegen.Execute(ctx, raw, imagegen.Host{
		TaskID: task, InvocationID: invocation, WriteUsage: writer,
		ReadInput: func(file string) (imageEditInput, error) { return readEditInput(storage.Relocate(config, file)) },
		Resolve: func(profile string) (imagegen.Choice, error) {
			selected = resolveImageGenChoice(config, profile)
			if !selected.Ready {
				return imagegen.Choice{}, fmt.Errorf("%s：%s", selected.Reason, imageGenSetupHint)
			}
			if expected, _ := ctx.Value(imageExpectedRouteKey{}).(string); expected != "" && expected != imageChoiceFingerprint(selected) {
				return imagegen.Choice{}, fmt.Errorf("批次的模型或连接地址已变化，未提交；请核对原配置")
			}
			return imagegen.Choice{Model: selected.Model, Name: selected.Name, ProfileID: selected.ProfileID}, nil
		},
		Prepare: func() error {
			if err := os.MkdirAll(dir, 0700); err != nil {
				return err
			}
			lock := imageIndexLock(dir)
			lock.Lock()
			_, err := readLegacyGeneratedIndex(dir)
			lock.Unlock()
			if err != nil {
				return err
			}
			generate, err = imageGenFactory(selected)
			return err
		},
		Generate: func(callCtx context.Context, request imageGenRequest, observe func(*AgentUsage) error) ([]byte, error) {
			return generate(context.WithValue(callCtx, imageUsageObserverKey{}, observe), request)
		},
		Save: func(data []byte, item generatedImage) (generatedImage, error) {
			return saveGeneratedImage(dir, data, item)
		},
		Recovery: func(state string) string {
			names := map[string]string{"unknown": "未知结果", "persistence_failed": "保存失败", "cancelled": "停止结果", "accounting_failed": "用量失败", "partial": "部分完成", "failed": "请求失败", "rejected": "未提交"}
			if name := names[state]; name != "" {
				return runtimePrompt("Matrix/辅助指令/生图" + name + ".txt")
			}
			return ""
		},
	})
}

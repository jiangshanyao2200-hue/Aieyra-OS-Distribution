// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: listImageBatches; imageRecoveryOrigin; recoverImageBatch
// Impact: python -B scripts/code-atlas.py show Core/image_batch_actions.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	apiimages "github.com/aieyra/aieyra-os/api/images"
	"github.com/aieyra/aieyra-os/contracts/protocol"
)

func listImageBatches(dir string, offset, limit int) (imageGenResult, error) {
	result := imageGenResult{OK: true, State: "completed", Paths: []string{}, Images: []generatedImage{}, Batches: []imageBatchSummary{}}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return result, err
	}
	type file struct {
		name     string
		modified time.Time
	}
	var files []file
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		info, e := entry.Info()
		if e != nil {
			return result, e
		}
		files = append(files, file{entry.Name(), info.ModTime()})
	}
	sort.Slice(files, func(i, j int) bool { return files[i].modified.After(files[j].modified) })
	end := min(len(files), offset+limit)
	if offset < len(files) {
		for _, entry := range files[offset:end] {
			b, e := loadImageBatch(filepath.Join(dir, entry.name))
			if e != nil {
				return result, e
			}
			r := summarizeImageBatch(b, 0, 1)
			result.Batches = append(result.Batches, imageBatchSummary{ID: b.ID, CreatedAt: b.CreatedAt, Requested: r.Requested, Completed: r.Completed, State: r.State})
		}
	}
	if end < len(files) {
		result.NextOffset = end
	}
	return result, nil
}

func imageRecoveryOrigin(config string, b *imageBatch, input imageBatchInput) string {
	if origin := b.Routes[input.RouteFingerprint]; origin != "" && input.RouteFingerprint != "" && imageChoiceFingerprint(imageGenChoice{ProfileID: input.ProfileID, Model: input.Model, baseURL: origin}) == input.RouteFingerprint {
		return origin
	}
	// Version 1 batches written before origin snapshots can still use the
	// exact, unchanged route. An unknown origin never supplies trusted usage.
	choice := resolveImageGenChoice(config, input.ProfileID)
	if input.RouteFingerprint != "" && imageChoiceFingerprint(choice) == input.RouteFingerprint {
		return choice.baseURL
	}
	return ""
}

// Repair the existing paid response and its original accounting sample. A URL
// can only be downloaded through its still-admitted original route; no POST is
// ever sent. Failed accounting retains the response and the already-saved image.
func recoverImageBatch(ctx context.Context, config, dir, file string, b *imageBatch, offset, limit int) (imageGenResult, error) {
	for i := range b.Items {
		if ctx.Err() != nil {
			return summarizeImageBatch(b, offset, limit), ctx.Err()
		}
		item := &b.Items[i]
		if item.State != "unknown" && item.State != "persistence_failed" && item.State != "accounting_failed" {
			continue
		}
		p := filepath.Join(dir, b.ID, item.RequestID+".response.json")
		f, err := os.Open(p)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return summarizeImageBatch(b, offset, limit), err
		}
		data, err := io.ReadAll(io.LimitReader(f, apiimages.PaidResponseByteLimit+1))
		f.Close()
		if err != nil {
			return summarizeImageBatch(b, offset, limit), err
		}
		in := item.Input
		origin := imageRecoveryOrigin(config, b, in)
		usage := AgentUsage{Kind: "image_gen", Request: 1}
		if item.Usage != nil {
			usage = *item.Usage
		}
		usage.Kind, usage.Request, usage.SourceID = "image_gen", 1, "batch:"+b.ID+":"+item.RequestID+":image:1"
		observe := func(u protocol.ImageUsage) {
			usage.Reported, usage.Input, usage.Output = true, u.Input, u.Output
		}
		result := item.Result
		if result == nil {
			result = &imageGenResult{Requested: 1, Submitted: 1, State: item.State, Paths: []string{}, Images: []generatedImage{}, Model: in.Model, ProfileID: in.ProfileID, Operation: in.Operation}
			item.Result = result
		}
		saved := result.Completed == 1 && len(result.Images) == 1 && len(result.Paths) == 1
		var original []byte
		var recoveryErr error
		if saved {
			if u := apiimages.ReceiptUsage(data, origin, in.Model); u != nil {
				observe(*u)
			}
		} else {
			original, recoveryErr = apiimages.Recover(ctx, data, apiimages.Recovery{
				BaseURL: origin, Model: in.Model, Inspect: inspectGeneratedImage, Usage: observe,
				BeforeDownload: func() error {
					choice := resolveImageGenChoice(config, in.ProfileID)
					if !choice.Ready || origin == "" || choice.baseURL != origin || imageChoiceFingerprint(choice) != in.RouteFingerprint {
						return fmt.Errorf("原图片模型或连接已停用/变化，未下载；请恢复原连接后重试recover，勿重新生成")
					}
					return ctx.Err()
				},
			})
		}
		item.Usage = &usage
		result.Usage = []AgentUsage{usage}
		result.AccountingError = recoverImageUsage(ctx, b, b.AccountingOwners[item.RequestID], usage, result.AccountingError)
		if recoveryErr != nil {
			item.Error = recoveryErr.Error()
			if err := saveImageBatch(file, b); err != nil {
				return summarizeImageBatch(b, offset, limit), err
			}
			if ctx.Err() != nil {
				return summarizeImageBatch(b, offset, limit), ctx.Err()
			}
			continue
		}
		if !saved {
			im, e := saveGeneratedImage(PrivatePaths(config).GeneratedImages, original, generatedImage{CreatedAt: b.CreatedAt, TaskID: b.TaskID, Model: in.Model, ProfileID: in.ProfileID, Operation: in.Operation, Prompt: in.Prompt, SourcePaths: in.Images, MaskPath: in.Mask, Quality: in.Quality, RequestedSize: in.Size, QualityReview: "pending_visual_review"})
			if e != nil {
				item.State, item.Error = "persistence_failed", "修复入册失败，原始响应保留"
				result.State = item.State
				if err := saveImageBatch(file, b); err != nil {
					return summarizeImageBatch(b, offset, limit), err
				}
				return summarizeImageBatch(b, offset, limit), fmt.Errorf("%s：%w", item.Error, e)
			}
			result.Paths, result.Images = []string{im.Path}, []generatedImage{im}
		}
		result.OK, result.Unknown, result.Completed, result.Unsubmitted = true, false, 1, 0
		result.Failed = nil
		item.State, item.Error = "completed", ""
		if result.AccountingError != "" {
			item.State, item.Error = "accounting_failed", result.AccountingError
		}
		result.State = item.State
		if err = saveImageBatch(file, b); err != nil {
			return summarizeImageBatch(b, offset, limit), err
		}
		if item.State == "completed" {
			_ = os.Remove(p) // Image and original ledger are both committed.
		}
	}
	return summarizeImageBatch(b, offset, limit), nil
}

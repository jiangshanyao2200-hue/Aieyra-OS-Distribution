// Package imagegen owns image creation/editing policy and attempt receipts.
// Provider credentials, persistent records and task identities are supplied by the host.
package imagegen

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/aieyra/aieyra-os/contracts/protocol"
	"github.com/aieyra/aieyra-os/tool/toolbox/official/imagegen/contract"
	"image"
	"os"
	"strings"
	"time"
)

type Choice struct{ Model, Name, ProfileID string }
type Host struct {
	ReadInput            func(string) (protocol.ImageEditInput, error)
	Resolve              func(profile string) (Choice, error)
	Prepare              func() error
	Generate             func(context.Context, protocol.ImageRequest, func(*protocol.AgentUsage) error) ([]byte, error)
	Save                 func([]byte, contract.Image) (contract.Image, error)
	WriteUsage           func(protocol.AgentUsage) error
	Recovery             func(state string) string
	TaskID, InvocationID string
}

func (h Host) recovery(state string) string {
	if h.Recovery != nil {
		return h.Recovery(state)
	}
	return ""
}

func Execute(ctx context.Context, raw json.RawMessage, host Host) (result contract.Result, resultErr error) {
	if host.Resolve == nil || host.Prepare == nil || host.Generate == nil || host.Save == nil {
		return result, fmt.Errorf("image tool host is incomplete")
	}
	defer func() {
		result.Completed = len(result.Images)
		result.Unsubmitted = max(0, result.Requested-result.Submitted)
		result.State = "rejected"
		switch {
		case result.Unknown:
			result.State = "unknown"
			result.Recovery = host.recovery("unknown")
		case len(result.Failed) > 0 && result.Failed[0].State == "persistence_failed":
			result.State = "persistence_failed"
			result.Recovery = host.recovery("persistence_failed")
		case ctx.Err() != nil:
			result.State = "cancelled"
			result.Recovery = host.recovery("cancelled")
		case result.AccountingError != "":
			result.State = "accounting_failed"
			result.Recovery = host.recovery("accounting_failed")
		case result.Completed == result.Requested && result.Requested > 0:
			result.State = "completed"
		case result.Completed > 0:
			result.State = "partial"
			result.Recovery = host.recovery("partial")
		case result.Submitted > 0:
			result.State = "failed"
			result.Recovery = host.recovery("failed")
		default:
			result.Recovery = host.recovery("rejected")
		}
	}()
	var args struct {
		contract.BatchInput
		Count int `json:"count"`
	}

	result = contract.Result{Paths: []string{}, Images: []contract.Image{}}
	if len(bytes.TrimSpace(raw)) == 0 || json.Unmarshal(raw, &args) != nil || bytes.TrimSpace(raw)[0] != '{' {
		return result, fmt.Errorf("arguments 必须为对象")
	}
	if args.Operation == "" {
		args.Operation = "generate"
	}
	if args.Operation != "generate" && args.Operation != "edit" {
		return result, fmt.Errorf("operation 应为 generate 或 edit")
	}
	if args.Count == 0 {
		args.Count = 1
	}
	if args.Count < 1 || args.Count > 4 {
		return result, fmt.Errorf("count 应为 1–4；请明确所需张数")
	}
	result.Requested = args.Count
	if args.Size == "" {
		args.Size = "1536x1024"
	}
	if args.Quality == "" || args.Quality == "auto" {
		args.Quality = "high"
	}
	if (args.Quality == "low" || args.Quality == "medium") && strings.TrimSpace(args.QualityReason) == "" {
		return result, fmt.Errorf("默认最高质量；中低质量需要 quality_reason 引用用户明确的降质要求")
	}
	if args.Quality != "" && args.Quality != "auto" && args.Quality != "low" && args.Quality != "medium" && args.Quality != "high" && args.Quality != "xhigh" && args.Quality != "max" {
		return result, fmt.Errorf("quality 无效")
	}
	choice, err := host.Resolve(args.ProfileID)
	if err != nil {
		return result, err
	}
	if args.OutputFormat == "" {
		args.OutputFormat = "png"
	}
	request := protocol.ImageRequest{Operation: args.Operation, Prompt: args.Prompt, Model: choice.Model, Size: args.Size, Quality: args.Quality, OutputFormat: args.OutputFormat, OutputCompression: args.OutputCompression, Background: args.Background, Moderation: args.Moderation, InputFidelity: args.InputFidelity}
	if err := request.Validate(); err != nil {
		return result, err
	}
	if args.Operation == "generate" && (len(args.Images) > 0 || args.Mask != "") {
		return result, fmt.Errorf("参考图片和mask请使用 edit")
	}
	if args.Operation == "edit" {
		if len(args.Images) < 1 || len(args.Images) > 8 {
			return result, fmt.Errorf("edit 需要 1–8 张参考图")
		}
		total := 0
		for _, path := range args.Images {
			if ctx.Err() != nil {
				return result, ctx.Err()
			}
			read := host.ReadInput
			if read == nil {
				read = ReadEditInput
			}
			ref, err := read(path)
			if err != nil {
				return result, err
			}
			total += len(ref.Data)
			if total > protocol.ImageEditByteLimit {
				return result, fmt.Errorf("编辑参考图合计最多 96 MiB")
			}
			request.Images = append(request.Images, ref)
		}
		if args.Mask != "" {
			read := host.ReadInput
			if read == nil {
				read = ReadEditInput
			}
			mask, err := read(args.Mask)
			if err != nil {
				return result, err
			}
			img, format, err := image.Decode(bytes.NewReader(mask.Data))
			if err != nil || format != "png" || mask.Width != request.Images[0].Width || mask.Height != request.Images[0].Height {
				return result, fmt.Errorf("mask 必须是与第一张参考图尺寸相同的透明 PNG")
			}
			transparent := false
			for y := 0; y < mask.Height && !transparent; y++ {
				for x := 0; x < mask.Width; x++ {
					_, _, _, a := img.At(x, y).RGBA()
					if a < 65535 {
						transparent = true
						break
					}
				}
			}
			if !transparent {
				return result, fmt.Errorf("mask 需包含透明区域，透明处表示需要编辑")
			}
			request.Mask = &mask
		}
	}
	if err := host.Prepare(); err != nil {
		return result, err
	}
	result.Model, result.ProfileID, result.Operation = choice.Name, choice.ProfileID, args.Operation
	for i := 0; i < args.Count; i++ {
		if ctx.Err() != nil {
			result.Failed = append(result.Failed, contract.Failure{Index: i + 1, State: "cancelled", Message: "操作已取消，未提交后续图片"})
			break
		}
		started := time.Now()
		sample := -1
		key := host.InvocationID
		observe := func(u *protocol.AgentUsage) error {
			row := protocol.AgentUsage{Kind: "image_gen", Request: i + 1, DurationMS: time.Since(started).Milliseconds()}
			if u != nil {
				row = *u
				row.Request = i + 1
				row.DurationMS = time.Since(started).Milliseconds()
			}
			if key != "" {
				row.SourceID = fmt.Sprintf("%s:image:%d", key, i+1)
			}
			if sample < 0 {
				if writer := host.WriteUsage; writer != nil {
					if err := writer(row); err != nil {
						return err
					}
				}
				sample = len(result.Usage)
				result.Usage = append(result.Usage, row)
				result.Submitted++
			} else {
				result.Usage[sample] = row
				if writer := host.WriteUsage; writer != nil {
					if err := writer(row); err != nil {
						result.AccountingError = err.Error()
						return err
					}
				}
			}
			return nil
		}
		data, err := host.Generate(ctx, request, observe)
		if err != nil {
			unknown := false
			var providerError *protocol.ImageProviderError
			if errors.As(err, &providerError) {
				unknown = providerError.Unknown
			}
			state := "failed"
			if unknown {
				state = "unknown"
				result.Unknown = true
			}
			result.Failed = append(result.Failed, contract.Failure{Index: i + 1, State: state, Message: err.Error()})
			break
		}
		item := contract.Image{CreatedAt: time.Now().UTC().Format(time.RFC3339Nano), Model: choice.Model, ProfileID: choice.ProfileID, TaskID: host.TaskID, Operation: args.Operation, Prompt: args.Prompt, SourcePaths: args.Images, MaskPath: args.Mask, Quality: args.Quality, RequestedSize: args.Size, QualityReview: "pending_visual_review"}
		saved, err := host.Save(data, item)
		if err != nil {
			result.Failed = append(result.Failed, contract.Failure{Index: i + 1, State: "persistence_failed", Message: "图片已经返回，请勿重发：" + err.Error()})
			if saved.Path != "" {
				if original, readErr := os.ReadFile(saved.Path); readErr == nil && bytes.Equal(original, data) {
					result.Paths = append(result.Paths, saved.Path)
				}
			}
			break
		}
		result.Paths = append(result.Paths, saved.Path)
		result.Images = append(result.Images, saved)
		if result.AccountingError != "" {
			break
		}
	}
	result.OK = len(result.Images) > 0
	if !result.OK {
		reason := "没有生成图片"
		if len(result.Failed) > 0 {
			reason = result.Failed[0].Message
		}
		return result, fmt.Errorf("%s", reason)
	}
	return result, nil
}

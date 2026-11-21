// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: imageBatchArgs; imageBatch; imageBatchID; imageRequestIdentityKey; imagePaidResponseKey; imageExpectedRouteKey; imageChoiceFingerprint; imageBatchToken; saveImageBatch; loadImageBatch; normalizeImageBatchInput; runImageGen; summarizeImageBatch
// Impact: python -B scripts/code-atlas.py show Core/image_batches.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/aieyra/aieyra-os/contracts/storage"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/aieyra/aieyra-os/CORE/internal/privatefile"
)

type imageBatchArgs struct {
	imageBatchInput
	Action      string            `json:"action,omitempty"`
	BatchID     string            `json:"batch_id,omitempty"`
	RequestID   string            `json:"request_id,omitempty"`
	Count       int               `json:"count,omitempty"`
	Items       []imageBatchInput `json:"items,omitempty"`
	Concurrency int               `json:"concurrency,omitempty"`
	MaxItems    int               `json:"max_items,omitempty"`
	Offset      int               `json:"offset,omitempty"`
	Limit       int               `json:"limit,omitempty"`
}
type imageBatch struct {
	Version          int               `json:"version"`
	ID               string            `json:"id"`
	CreatedAt        string            `json:"created_at"`
	TaskID           string            `json:"task_id,omitempty"`
	AccountingOwners map[string]string `json:"accounting_owners,omitempty"`
	Routes           map[string]string `json:"routes,omitempty"`
	Digest           string            `json:"digest"`
	Items            []imageBatchItem  `json:"items"`
}

var imageBatchID = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$`)

type imageRequestIdentityKey struct{}
type imagePaidResponseKey struct{}
type imageExpectedRouteKey struct{}

func imageChoiceFingerprint(choice imageGenChoice) string {
	sum := sha256.Sum256([]byte(choice.ProfileID + "\n" + choice.Model + "\n" + choice.baseURL))
	return hex.EncodeToString(sum[:])
}

func imageBatchToken() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b[:])
}
func saveImageBatch(file string, batch *imageBatch) error {
	data, err := json.Marshal(batch)
	if err != nil {
		return err
	}
	return privatefile.Write(file, data)
}
func loadImageBatch(file string) (*imageBatch, error) {
	f, err := os.Open(file)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, (16<<20)+1))
	if err != nil {
		return nil, err
	}
	var b imageBatch
	if len(data) > 16<<20 || json.Unmarshal(data, &b) != nil || b.Version != 1 || !imageBatchID.MatchString(b.ID) || len(b.Items) < 1 || len(b.Items) > 100 {
		return nil, fmt.Errorf("图片批次记录损坏，保留原件，禁止重新提交")
	}
	for i, item := range b.Items {
		if item.Index != i+1 || !imageBatchID.MatchString(item.RequestID) {
			return nil, fmt.Errorf("图片批次身份无效")
		}
	}
	return &b, nil
}
func normalizeImageBatchInput(config string, in imageBatchInput) (imageBatchInput, map[string]string, string, error) {
	if in.Operation == "" {
		in.Operation = "generate"
	}
	if in.Size == "" {
		in.Size = "1536x1024"
	}
	if in.Quality == "" || in.Quality == "auto" {
		in.Quality = "high"
	}
	if in.Operation != "generate" && in.Operation != "edit" {
		return in, nil, "", fmt.Errorf("operation 应为 generate 或 edit")
	}
	if in.Quality != "high" && in.Quality != "medium" && in.Quality != "low" && in.Quality != "xhigh" && in.Quality != "max" {
		return in, nil, "", fmt.Errorf("quality 无效")
	}
	if (in.Quality == "medium" || in.Quality == "low") && strings.TrimSpace(in.QualityReason) == "" {
		return in, nil, "", fmt.Errorf("默认最高质量；quality_reason 必须引用用户明确的中低质量要求")
	}
	if len(in.QualityReason) > 2000 {
		return in, nil, "", fmt.Errorf("quality_reason 太长")
	}
	choice := resolveImageGenChoice(config, in.ProfileID)
	if !choice.Ready {
		return in, nil, "", fmt.Errorf("%s：%s", choice.Reason, imageGenSetupHint)
	}
	in.ProfileID = choice.ProfileID
	in.Model = choice.Model
	in.RouteFingerprint = imageChoiceFingerprint(choice)
	if err := (imageGenRequest{Model: choice.Model, Prompt: in.Prompt, Size: in.Size, OutputFormat: in.OutputFormat, OutputCompression: in.OutputCompression, Background: in.Background, Moderation: in.Moderation, InputFidelity: in.InputFidelity}).Validate(); err != nil {
		return in, nil, "", err
	}
	if in.Operation == "generate" && (len(in.Images) > 0 || in.Mask != "") {
		return in, nil, "", fmt.Errorf("参考图与mask需要edit")
	}
	if in.Operation == "edit" && (len(in.Images) < 1 || len(in.Images) > 8) {
		return in, nil, "", fmt.Errorf("edit需要1–8张参考图")
	}
	hashes := map[string]string{}
	total := 0
	for _, p := range append(append([]string{}, in.Images...), in.Mask) {
		if p == "" {
			continue
		}
		ref, err := readEditInput(storage.Relocate(config, p))
		if err != nil {
			return in, nil, "", err
		}
		total += len(ref.Data)
		if total > imageEditByteLimit {
			return in, nil, "", fmt.Errorf("编辑参考图合计过大")
		}
		sum := sha256.Sum256(ref.Data)
		hashes[p] = hex.EncodeToString(sum[:])
	}
	return in, hashes, choice.baseURL, nil
}

// create is free of provider calls. run dispatches a bounded group and never
// replays in-flight/unknown/failed records. The AI chooses the next group after
// inspecting current receipts and images; there is no automatic endless loop.
func runImageGen(ctx context.Context, config string, raw json.RawMessage) (imageGenResult, error) {
	ctx = context.WithValue(ctx, officialToolConfigKey{}, config)
	if err := admitOfficialToolCall(ctx, ToolCall{Function: FunctionCall{Name: "image_gen", Arguments: string(raw)}}); err != nil {
		return imageGenResult{State: "rejected"}, err
	}
	releaseOwner, err := storage.Enter(config)
	if err != nil {
		return imageGenResult{State: "rejected"}, err
	}
	defer releaseOwner()
	if err := ValidatePrivateProfile(config); err != nil {
		return imageGenResult{State: "rejected"}, err
	}
	empty := imageGenResult{Paths: []string{}, Images: []generatedImage{}, State: "rejected"}
	var a imageBatchArgs
	if len(raw) > 4<<20 || len(bytes.TrimSpace(raw)) == 0 || bytes.TrimSpace(raw)[0] != '{' || json.Unmarshal(raw, &a) != nil {
		return empty, fmt.Errorf("arguments 必须为有效对象")
	}
	if a.Action == "" {
		a.Action = "generate"
	}
	if a.Action != "generate" && a.Action != "create" && a.Action != "run" && a.Action != "status" && a.Action != "list" && a.Action != "recover" {
		return empty, fmt.Errorf("action 应为 generate/create/run/status/list/recover")
	}
	if a.Concurrency == 0 {
		a.Concurrency = 1
	}
	if a.Concurrency < 1 || a.Concurrency > 4 {
		return empty, fmt.Errorf("concurrency 应为1–4")
	}
	if a.MaxItems == 0 {
		a.MaxItems = 8
	}
	if a.MaxItems < 1 || a.MaxItems > 20 {
		return empty, fmt.Errorf("max_items 应为1–20；分组持续完成大批次")
	}
	if a.Limit == 0 {
		a.Limit = 20
	}
	if a.Offset < 0 || a.Limit < 1 || a.Limit > 100 {
		return empty, fmt.Errorf("分页无效")
	}
	if ctx.Err() != nil {
		return empty, ctx.Err()
	}
	dir := PrivatePaths(config).ImageBatches
	if err := os.MkdirAll(dir, 0700); err != nil {
		return empty, err
	}
	if a.Action == "list" {
		return listImageBatches(dir, a.Offset, a.Limit)
	}
	creating := a.Action == "create" || a.Action == "generate"
	id := a.BatchID
	if creating {
		if id != "" {
			return empty, fmt.Errorf("新批次使用request_id，恢复原批次使用action=run和batch_id")
		}
		id = a.RequestID
		if id == "" {
			key, _ := ctx.Value(toolInvocationKey{}).(string)
			if key != "" {
				sum := sha256.Sum256([]byte(key))
				id = "b-" + hex.EncodeToString(sum[:16])
			} else {
				id = "b-" + imageBatchToken()
			}
		}
	}
	if !imageBatchID.MatchString(id) {
		return empty, fmt.Errorf("batch_id/request_id 无效")
	}
	empty.BatchID = id
	file := filepath.Join(dir, id+".json")
	lock, err := os.OpenFile(filepath.Join(dir, id+".lock"), os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return empty, err
	}
	defer lock.Close()
	if err = lockImageBatch(lock); err != nil {
		if a.Action == "status" {
			batch, e := loadImageBatch(file)
			if e != nil {
				return empty, e
			}
			return summarizeImageBatch(batch, a.Offset, a.Limit), nil
		}
		return empty, fmt.Errorf("该图片批次正在执行；使用同一batch_id查询，勿新建重复批次")
	}
	batch, err := loadImageBatch(file)
	existed := err == nil
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return empty, err
	}
	if creating {
		inputs := a.Items
		if len(inputs) > 0 && (a.Count != 0 || a.Prompt != "") {
			return empty, fmt.Errorf("items 与 prompt/count 二选一")
		}
		if len(inputs) == 0 {
			if a.Count == 0 {
				a.Count = 1
			}
			if a.Count < 1 || a.Count > 100 {
				return empty, fmt.Errorf("count 应为1–100；更长任务分批创建")
			}
			for i := 0; i < a.Count; i++ {
				inputs = append(inputs, a.imageBatchInput)
			}
		}
		if len(inputs) > 100 {
			return empty, fmt.Errorf("items最多100项")
		}
		normalized := make([]imageBatchItem, 0, len(inputs))
		routes := map[string]string{}
		for i, in := range inputs {
			if len(a.Items) > 0 {
				if in.ProfileID == "" {
					in.ProfileID = a.ProfileID
				}
				if in.Quality == "" {
					in.Quality = a.Quality
				}
				if in.QualityReason == "" {
					in.QualityReason = a.QualityReason
				}
				if in.Size == "" {
					in.Size = a.Size
				}
			}
			input, hashes, baseURL, e := normalizeImageBatchInput(config, in)
			if e != nil {
				return empty, fmt.Errorf("第%d项：%w", i+1, e)
			}
			normalized = append(normalized, imageBatchItem{Index: i + 1, State: "prepared", Input: input, InputSHA: hashes})
			routes[input.RouteFingerprint] = baseURL
		}
		digest := sha256.Sum256(rawJSON(normalized))
		identity := hex.EncodeToString(digest[:])
		if existed {
			if batch.Digest != identity {
				return empty, fmt.Errorf("request_id 已用于不同参数；先查看原批次")
			}
		} else {
			task, _ := ctx.Value(imageGenTaskKey{}).(string)
			batch = &imageBatch{Version: 1, ID: id, CreatedAt: time.Now().UTC().Format(time.RFC3339Nano), TaskID: task, Routes: routes, Digest: identity, Items: normalized}
			for i := range batch.Items {
				batch.Items[i].RequestID = "img-" + imageBatchToken()
			}
			if err = saveImageBatch(file, batch); err != nil {
				return empty, err
			}
		}
	} else if !existed {
		return empty, fmt.Errorf("图片批次不存在")
	}
	// A kernel lock proves no other producer remains. Interrupted dispatches are
	// unknown even when no response or charge was recorded locally.
	changed := false
	for i := range batch.Items {
		if batch.Items[i].State == "in_flight" {
			batch.Items[i].State = "unknown"
			batch.Items[i].Error = "上次提交被中断；先核对结果，不自动重发"
			changed = true
		}
	}
	if changed {
		if err = saveImageBatch(file, batch); err != nil {
			return empty, err
		}
	}
	if a.Action == "create" || a.Action == "status" || existed && a.Action == "generate" {
		return summarizeImageBatch(batch, a.Offset, a.Limit), nil
	}
	if a.Action == "recover" {
		return recoverImageBatch(ctx, config, dir, file, batch, a.Offset, a.Limit)
	}
	var mu sync.Mutex
	next, dispatched := 0, 0
	halted := false
	var persistErr error
	var wg sync.WaitGroup
	for worker := 0; worker < a.Concurrency; worker++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				mu.Lock()
				for next < len(batch.Items) && batch.Items[next].State != "prepared" {
					next++
				}
				if halted || ctx.Err() != nil || dispatched >= a.MaxItems || next >= len(batch.Items) {
					mu.Unlock()
					return
				}
				index := next
				next++
				dispatched++
				item := batch.Items[index]
				mu.Unlock()
				var inputErr error
				for p, want := range item.InputSHA {
					ref, e := readEditInput(storage.Relocate(config, p))
					if e != nil {
						inputErr = e
						break
					}
					sum := sha256.Sum256(ref.Data)
					if hex.EncodeToString(sum[:]) != want {
						inputErr = fmt.Errorf("参考图已变化：%s", p)
						break
					}
				}
				one := context.WithValue(ctx, toolInvocationKey{}, "batch:"+id+":"+item.RequestID)
				one = context.WithValue(one, imageRequestIdentityKey{}, item.RequestID)
				one = context.WithValue(one, imageExpectedRouteKey{}, item.Input.RouteFingerprint)
				one = context.WithValue(one, imagePaidResponseKey{}, func(data []byte) error {
					dest := filepath.Join(dir, id, item.RequestID+".response.json")
					if err := os.MkdirAll(filepath.Dir(dest), 0700); err != nil {
						return err
					}
					return privatefile.Write(dest, data)
				})
				one = context.WithValue(one, imageUsageWriterKey{}, func(u AgentUsage) error {
					mu.Lock()
					defer mu.Unlock()
					if owner, _ := ctx.Value(imageUsageOwnerKey{}).(string); owner != "" {
						if batch.AccountingOwners == nil {
							batch.AccountingOwners = map[string]string{}
						}
						batch.AccountingOwners[item.RequestID] = owner
					}
					if writer, ok := ctx.Value(imageUsageWriterKey{}).(func(AgentUsage) error); ok {
						if e := writer(u); e != nil {
							return e
						}
					}
					target := &batch.Items[index]
					target.State = "in_flight"
					copy := u
					target.Usage = &copy
					if e := saveImageBatch(file, batch); e != nil {
						halted = true
						persistErr = e
						return e
					}
					return nil
				})
				var result imageGenResult
				e := inputErr
				if e == nil {
					result, e = runImageGenImmediate(one, config, rawJSON(item.Input))
				}
				mu.Lock()
				target := &batch.Items[index]
				target.Result = &result
				target.State = result.State
				if target.State == "" {
					target.State = "rejected"
				}
				if e != nil {
					target.Error = e.Error()
				}
				// Usage received even when the task accounting writer fails remains in the batch.
				if len(result.Usage) > 0 {
					copy := result.Usage[0]
					target.Usage = &copy
				}
				if target.State != "completed" {
					halted = true
				}
				if e = saveImageBatch(file, batch); e != nil {
					persistErr = e
					halted = true
				}
				if e == nil && target.State == "completed" {
					_ = os.Remove(filepath.Join(dir, id, item.RequestID+".response.json"))
				}
				mu.Unlock()
			}
		}()
	}
	wg.Wait()
	result := summarizeImageBatch(batch, a.Offset, a.Limit)
	if persistErr != nil {
		result.State = "persistence_failed"
		result.OK = false
		return result, fmt.Errorf("图片批次保存失败，保留原请求身份与已有图片，勿重新生成：%w", persistErr)
	}
	if result.Completed == 0 && result.Submitted == 0 {
		return result, fmt.Errorf("图片请求未提交；查看批次逐项错误")
	}
	if result.Completed == 0 && len(result.Failed) > 0 {
		return result, fmt.Errorf("%s", result.Failed[0].Message)
	}
	return result, nil
}

func summarizeImageBatch(b *imageBatch, offset, limit int) imageGenResult {
	r := imageGenResult{BatchID: b.ID, Requested: len(b.Items), Paths: []string{}, Images: []generatedImage{}, State: "prepared"}
	running := false
	for i, item := range b.Items {
		if item.Result != nil {
			r.Model, r.ProfileID, r.Operation = item.Result.Model, item.Result.ProfileID, item.Result.Operation
			if i >= offset && i < offset+limit {
				for _, im := range item.Result.Images {
					im.Prompt = utf8Prefix(im.Prompt, 512)
					r.Images = append(r.Images, im)
				}
				r.Paths = append(r.Paths, item.Result.Paths...)
			}
			if item.Result.AccountingError != "" {
				r.AccountingError = item.Result.AccountingError
			}
			r.Completed += item.Result.Completed
		}
		if item.Usage != nil {
			r.Usage = append(r.Usage, *item.Usage)
			r.Submitted++
		}
		if item.State == "unknown" {
			r.Unknown = true
		}
		if item.State == "in_flight" {
			running = true
		}
		if item.State != "completed" && item.State != "prepared" && item.State != "in_flight" {
			message := item.Error
			if message == "" && item.Result != nil && len(item.Result.Failed) > 0 {
				message = item.Result.Failed[0].Message
			}
			r.Failed = append(r.Failed, imageGenFailure{Index: item.Index, State: item.State, Message: message})
		}
	}
	r.Unsubmitted = max(0, r.Requested-r.Submitted)
	r.OK = r.Completed > 0 || len(r.Failed) == 0
	switch {
	case running:
		r.State = "running"
	case r.Unknown:
		r.State = "unknown"
	case r.AccountingError != "":
		r.State = "accounting_failed"
	case r.Completed == r.Requested:
		r.State = "completed"
	case r.Completed > 0:
		r.State = "partial"
	case len(r.Failed) > 0:
		r.State = "failed"
	}
	r.Recovery = runtimePrompt("Matrix/辅助指令/生图批次继续.txt")
	end := min(len(b.Items), offset+limit)
	if offset < len(b.Items) {
		for _, item := range b.Items[offset:end] {
			item.Result = nil
			item.InputSHA = nil
			item.Input.Prompt = utf8Prefix(item.Input.Prompt, 512)
			r.Items = append(r.Items, item)
		}
	}
	if end < len(b.Items) {
		r.NextOffset = end
	}
	return r
}

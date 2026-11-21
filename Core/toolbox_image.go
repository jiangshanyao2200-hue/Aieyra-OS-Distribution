// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: ImageGenManual; newImageGenerator; imageGenChoice; imageGenSetupHint; readImageGenKeys; resolveImageGenChoice; resolveImageGenSettings; imageGenFactory
// Impact: python -B scripts/code-atlas.py show Core/toolbox_image.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	apiimages "github.com/aieyra/aieyra-os/api/images"
	"github.com/aieyra/aieyra-os/contracts/protocol"
	"github.com/aieyra/aieyra-os/tool/toolbox/official/imagegen"
	"net/http"
	"os"
	"strings"
)

func ImageGenManual() string {
	if text, err := readPromptResource("Matrix/工具说明/生图.txt"); err == nil {
		return text
	}
	return imagegen.Manual
}

func newImageGenerator(baseURL, apiKey string, client *http.Client) (imageGenFunc, error) {
	generate, err := apiimages.NewGenerator(baseURL, apiKey, client, imagegen.Inspect)
	if err != nil {
		return nil, err
	}
	return func(ctx context.Context, request imageGenRequest) ([]byte, error) {
		requestID, _ := ctx.Value(imageRequestIdentityKey{}).(string)
		preserve, _ := ctx.Value(imagePaidResponseKey{}).(func([]byte) error)
		return generate(ctx, request, apiimages.Hooks{
			RequestID: requestID, PreserveResponse: preserve,
			BeforeSubmit: func() error { return observeImageUsage(ctx, nil) },
			Usage: func(usage protocol.ImageUsage) {
				_ = observeImageUsage(ctx, &AgentUsage{Kind: "image_gen", Reported: true, Input: usage.Input, Output: usage.Output})
			},
		})
	}, nil
}

// imageGenChoice 是解析后的生图模型；apiKey 不导出、不序列化。
type imageGenChoice struct {
	Ready     bool
	ProfileID string
	Name      string
	Model     string
	Reason    string
	baseURL   string
	apiKey    string
}

const imageGenSetupHint = "请用户在 设置 → 模型连接 里从模型池选择一个默认生图模型"

// 生图键由共享设置服务（Client/Desktop/src/spec.cjs）写入，Go 的 Settings 不带这两项，这里按原始 JSON 读。
func readImageGenKeys(path string) (profiles []string, enabled bool) {
	var raw struct {
		ImageProfiles []json.RawMessage `json:"image_profiles"`
	}
	data, err := os.ReadFile(path)
	if err != nil || json.Unmarshal(data, &raw) != nil {
		return nil, false
	}
	for _, row := range raw.ImageProfiles {
		var id string
		if json.Unmarshal(row, &id) == nil && strings.TrimSpace(id) != "" && len(profiles) < 16 {
			profiles = append(profiles, strings.TrimSpace(id))
		}
	}
	if len(profiles) > 1 {
		profiles = profiles[:1]
	}
	return profiles, len(profiles) > 0
}

func resolveImageGenChoice(path string, selected ...string) imageGenChoice {
	profiles, enabled := readImageGenKeys(path)
	s, err := Load(path)
	if err != nil {
		if len(profiles) == 0 {
			return imageGenChoice{Reason: "还没有选生图模型"}
		}
		return imageGenChoice{Reason: "配置暂时无法读取"}
	}
	return resolveImageGenSettings(s, profiles, enabled, selected...)
}

func resolveImageGenSettings(s *Settings, profiles []string, _ bool, selected ...string) imageGenChoice {
	result := imageGenChoice{}
	if len(profiles) == 0 {
		result.Reason = "还没有选生图模型"
		return result
	}
	result.ProfileID = profiles[0]
	if len(selected) > 0 && selected[0] != "" {
		result.ProfileID = selected[0]
	}
	var profile *APIProfile
	for i := range s.APIProfiles {
		if s.APIProfiles[i].ID == result.ProfileID {
			profile = &s.APIProfiles[i]
			break
		}
	}
	if profile == nil {
		result.Reason = "所选生图模型已不在模型池"
		return result
	}
	result.Name, result.Model = profile.Name, profile.Model
	if result.Name == "" {
		result.Name = profile.Model
	}
	if ready, reason, _ := modelConfigurationReady(s, *profile); !ready {
		result.Reason = reason
		return result
	}
	if profile.Enabled != nil && !*profile.Enabled {
		result.Reason = "所选生图模型已停用"
		return result
	}
	for _, c := range s.ProviderConnections {
		if c.ID != profile.ConnectionID {
			continue
		}
		if c.Enabled != nil && !*c.Enabled {
			result.Reason = "所选生图模型的 Key 已停用"
			return result
		}
		result.baseURL = profile.BaseURL
		if strings.TrimSpace(result.baseURL) == "" {
			result.baseURL = c.BaseURL
		} else if NormalizeBaseURL(c.BaseURL) != NormalizeBaseURL(profile.BaseURL) {
			continue
		}
		result.apiKey = strings.TrimSpace(c.APIKey)
		break
	}
	switch {
	case result.Model == "" || result.baseURL == "":
		result.Reason = "所选生图模型缺少地址或型号"
	case result.apiKey == "":
		result.Reason = "所选生图模型的连接没有密钥"
	default:
		result.Ready = true
	}
	return result
}

// 测试可替换生成器；生产按配置构造 HTTP 生成器。
var imageGenFactory = func(choice imageGenChoice) (imageGenFunc, error) {
	return newImageGenerator(choice.baseURL, choice.apiKey, nil)
}

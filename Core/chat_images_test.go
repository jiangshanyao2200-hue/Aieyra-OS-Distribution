// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: goImageSettings; TestImageCapabilityRequiresVerifiedEndpointModelProtocol; TestBailianImageCapabilityRequiresVerifiedCombination; TestChatImageToolBatchOrderSnapshotPrefixAndReasoning; TestImageSnapshotMetadataDetailAndByteLimits; TestChatImagesFollowMergedSystemHistory
// Impact: python -B scripts/code-atlas.py show Core/chat_images_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"bytes"
	"context"
	"encoding/json"
	"net/url"
	"os"
	"strings"
	"testing"
)

func goImageSettings(model string) *Settings {
	s := Defaults()
	s.Adapter, s.BaseURL, s.Model, s.APIProtocol = "openai", "https://opencode.ai/zen/go/v1", model, ProtocolChat
	return s
}

func TestImageCapabilityRequiresVerifiedEndpointModelProtocol(t *testing.T) {
	for _, model := range []string{"deepseek-v4-flash-vision-exp", "mimo-v2.6-flash"} {
		s := goImageSettings(model)
		if !SupportsToolImages(s) {
			t.Fatal("verified Go model disabled", model)
		}
		for _, change := range []func(*Settings){
			func(s *Settings) { s.BaseURL = "https://opencode.ai/zen/v1" },
			func(s *Settings) { s.BaseURL += ".untrusted" },
			func(s *Settings) { s.APIProtocol = ProtocolResponses },
			func(s *Settings) { s.Model = "Muse"; s.ModelVision = true },
			func(s *Settings) { s.APIProtocol = ProtocolMessages },
		} {
			copy := s.Clone()
			change(copy)
			if SupportsToolImages(copy) {
				t.Fatal("unverified combination enabled", copy.ProviderIdentity())
			}
		}
	}
	if SupportsToolImages(nil) || !SupportsToolImages(Defaults()) {
		t.Fatal("legacy capability changed")
	}
}

func TestBailianImageCapabilityRequiresVerifiedCombination(t *testing.T) {
	s := goImageSettings("qwen3.8-flash")
	s.BaseURL = "https://fixture.cn-beijing.maas.aliyuncs.com/compatible-mode/v1"
	credentialed, err := url.Parse(s.BaseURL)
	if err != nil {
		t.Fatal(err)
	}
	credentialed.User = url.User("fixture")
	for _, endpoint := range []string{s.BaseURL, s.BaseURL + "/", "https://fixture.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1", "https://dashscope.aliyuncs.com/compatible-mode/v1", "https://dashscope-intl.aliyuncs.com:443/compatible-mode/v1"} {
		copy := s.Clone()
		copy.BaseURL = endpoint
		if !SupportsToolImages(copy) {
			t.Fatal("verified Bailian combination disabled", endpoint)
		}
	}
	for _, endpoint := range []string{
		"http://fixture.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
		"https://fixture.cn-beijing.maas.aliyuncs.com.evil.test/compatible-mode/v1",
		"https://fixture.cn-beijing.maas.aliyuncs.com:8443/compatible-mode/v1",
		credentialed.String(),
		"https://dashscope.aliyuncs.com/compatible-mode/v1?route=other",
		"https://dashscope.aliyuncs.com/compatible-mode/v1#other",
		"https://dashscope.aliyuncs.com/api/v1",
		"https://bad_region.maas.aliyuncs.com/compatible-mode/v1",
		"https://dashscope.aliyuncs.com/compatible-mode%2fv1",
	} {
		copy := s.Clone()
		copy.BaseURL = endpoint
		if SupportsToolImages(copy) {
			t.Fatal("unverified endpoint enabled", endpoint)
		}
	}
	for _, change := range []func(*Settings){
		func(s *Settings) { s.Model = "qwen3.8-max"; s.ModelVision = true },
		func(s *Settings) { s.APIProtocol = ProtocolResponses },
		func(s *Settings) { s.APIProtocol = ProtocolMessages },
		func(s *Settings) { s.Adapter = "deepseek" },
	} {
		copy := s.Clone()
		change(copy)
		if SupportsToolImages(copy) {
			t.Fatal("unverified model or protocol enabled")
		}
	}
}

func TestChatImageToolBatchOrderSnapshotPrefixAndReasoning(t *testing.T) {
	m := shellTestManager(t)
	path := imageFixture(t, m)
	s := goImageSettings("mimo-v2.6-flash")
	s.APIProfiles = []APIProfile{{ID: "go", ReasoningField: "reasoning_content"}}
	s.ActiveProfile = "go"
	response := Message{Role: RoleAssistant, Provider: s.ProviderIdentity(), ToolCalls: []ToolCall{
		executionCall("view_image", ImageRequest{Path: path, Detail: "original"}),
		executionCall("view_image", ImageRequest{Path: path, Detail: "high"}),
	}}
	response.ToolCalls[0].ID, response.ToolCalls[1].ID = "picture-a", "picture-b"
	var saved []byte
	turn, err := ExecuteToolTurn(WithToolImages(context.Background(), SupportsToolImages(s)), &PlanEngine{}, m, response, "image-turn", func(kind string, v any) error {
		if kind == "tool_turn" {
			saved, _ = json.Marshal(v)
		}
		return nil
	})
	if err != nil || len(turn.Messages) != 3 || len(turn.Messages[1].Images) != 1 {
		t.Fatalf("tool turn: %v %+v", err, turn)
	}
	if len(saved) == 0 || bytes.Contains(saved, []byte("base64")) {
		t.Fatal("archive missing or contains image bytes")
	}
	msgs := append([]Message{{Role: RoleSystem, Content: "fixed system"}, {Role: RoleUser, Content: "inspect"}}, turn.Messages...)
	req := BuildRequest(s, msgs, false)
	wire, err := json.Marshal(req)
	if err != nil {
		t.Fatal(err)
	}
	var parsed struct {
		Messages []map[string]json.RawMessage `json:"messages"`
	}
	if err = json.Unmarshal(wire, &parsed); err != nil {
		t.Fatal(err)
	}
	if len(parsed.Messages) != 6 {
		t.Fatalf("wire messages: %s", wire)
	}
	for i, want := range []string{"system", "user", "assistant", "tool", "tool", "user"} {
		if string(parsed.Messages[i]["role"]) != `"`+want+`"` {
			t.Fatalf("broken tool batch: %s", wire)
		}
	}
	if string(parsed.Messages[2]["reasoning_content"]) != `""` {
		t.Fatalf("empty reasoning lost: %s", wire)
	}
	if strings.Count(string(wire), "data:image/png;base64,") != 2 || strings.Contains(string(wire), "image_attachments") || !strings.Contains(string(wire), "picture-b") {
		t.Fatalf("image mapping: %s", wire)
	}
	if strings.Contains(string(parsed.Messages[5]["content"]), `"detail"`) {
		t.Fatal("unverified Go detail parameter sent")
	}
	// 同一请求序列化和重试不重读文件，下一请求重新核对快照。
	if err = os.WriteFile(turn.Messages[1].Images[0].Asset, []byte("tampered"), 0600); err != nil {
		t.Fatal(err)
	}
	wireAgain, _ := json.Marshal(req)
	if !bytes.Equal(wire, wireAgain) {
		t.Fatal("request snapshot changed during retry")
	}
	broken, _ := json.Marshal(BuildRequest(s, msgs, false))
	if bytes.Contains(broken, []byte("data:image")) || !bytes.Contains(broken, []byte("hash mismatch")) {
		t.Fatal("corrupted snapshot sent")
	}
	if len(msgs[3].Images) != 1 || strings.Contains(msgs[3].Content, "omitted") {
		t.Fatal("request construction mutated archive")
	}
	// 图片历史以相同前缀重建，新增用户消息不改前面的纯文本/工具序列。
	more := append(append([]Message(nil), msgs...), Message{Role: RoleUser, Content: "continue"})
	x, _ := json.Marshal(BuildRequest(s, more, false))
	var next struct {
		Messages []json.RawMessage `json:"messages"`
	}
	var old struct {
		Messages []json.RawMessage `json:"messages"`
	}
	json.Unmarshal(x, &next)
	json.Unmarshal(broken, &old)
	for i := range old.Messages {
		if !bytes.Equal(old.Messages[i], next.Messages[i]) {
			t.Fatal("historical prefix changed", i)
		}
	}
	s.Model = "Muse"
	s.ModelVision = true
	denied, _ := json.Marshal(BuildRequest(s, msgs, false))
	if bytes.Contains(denied, []byte("data:image")) || !bytes.Contains(denied, []byte("omitted")) {
		t.Fatal("model switch leaked image input")
	}
}

func TestImageSnapshotMetadataDetailAndByteLimits(t *testing.T) {
	m := shellTestManager(t)
	path := imageFixture(t, m)
	r, images := m.viewImage(WithToolImages(context.Background(), true), executionCall("view_image", ImageRequest{Path: path, Detail: "original"}))
	if !r.OK {
		t.Fatal(r)
	}
	a := images[0]
	budget := a.Bytes
	part := readRequestImage(a, &budget)
	if part.DataURL == "" || part.Detail != "auto" || budget != 0 {
		t.Fatal(part, budget)
	}
	for _, change := range []func(*ImageAttachment){func(a *ImageAttachment) { a.MIME = "image/svg+xml" }, func(a *ImageAttachment) { a.Width = 8193 }, func(a *ImageAttachment) { a.Detail = "invalid" }, func(a *ImageAttachment) { a.Bytes = imageByteLimit + 1 }} {
		bad := a
		change(&bad)
		budget = imageRequestByteLimit
		if readRequestImage(bad, &budget).Text == "" {
			t.Fatal("bad snapshot accepted", bad)
		}
	}
	budget = a.Bytes - 1
	if readRequestImage(a, &budget).Text == "" {
		t.Fatal("aggregate budget bypassed")
	}
}

func TestChatImagesFollowMergedSystemHistory(t *testing.T) {
	m := shellTestManager(t)
	path := imageFixture(t, m)
	r, images := m.viewImage(WithToolImages(context.Background(), true), executionCall("view_image", ImageRequest{Path: path}))
	if !r.OK || len(images) != 1 {
		t.Fatal("image fixture failed", r)
	}
	s := goImageSettings("mimo-v2.6-flash")
	for _, role := range []string{RoleUser, RoleTool} {
		t.Run(role, func(t *testing.T) {
			messages := []Message{{Role: RoleSystem, Content: "identity"}, {Role: RoleSystem, Content: "instructions"}}
			if role == RoleTool {
				call := executionCall("view_image", ImageRequest{Path: path})
				call.ID = "image-call"
				messages = append(messages, Message{Role: RoleAssistant, ToolCalls: []ToolCall{call}})
			}
			messages = append(messages, Message{Role: role, Content: "inspect this image", Name: "view_image", ToolCallID: "image-call", Images: images})
			wire, err := json.Marshal(BuildRequest(s, messages, false))
			if err != nil {
				t.Fatal(err)
			}
			var body struct {
				Messages []struct {
					Role    string
					Content json.RawMessage
				}
			}
			if err = json.Unmarshal(wire, &body); err != nil {
				t.Fatal(err)
			}
			last := body.Messages[len(body.Messages)-1]
			if last.Role != RoleUser || !bytes.Contains(last.Content, []byte("data:image/png;base64,")) || strings.Count(string(wire), "data:image/png;base64,") != 1 {
				t.Fatal("image lost or attached to wrong turn after system merge", string(wire))
			}
			if role == RoleUser && len(body.Messages) != 2 || role == RoleTool && (len(body.Messages) != 4 || body.Messages[2].Role != RoleTool) {
				t.Fatal("message order changed", string(wire))
			}
		})
	}
}

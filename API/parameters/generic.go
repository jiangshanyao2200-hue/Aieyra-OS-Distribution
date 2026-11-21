// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: API/parameters/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: Sampling; stripSamplingOptions; ApplyGeneric; upperASCII
// Impact: python -B scripts/code-atlas.py show API/parameters/generic.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package parameters

func Sampling(key string) bool {
	switch key {
	case "temperature", "top_p", "top_k", "min_p", "frequency_penalty", "presence_penalty", "repetition_penalty", "seed", "stop", "stop_sequences", "logprobs", "top_logprobs":
		return true
	}
	return false
}

// Legacy selections remain readable, but the supplier owns sampling defaults.
func stripSamplingOptions(body map[string]any) {
	for key := range body {
		if Sampling(key) {
			delete(body, key)
		}
	}
	if g, ok := body["generationConfig"].(map[string]any); ok {
		for _, key := range []string{"temperature", "topP", "topK", "seed", "stopSequences", "presencePenalty", "frequencyPenalty"} {
			delete(g, key)
		}
	}
}

// 只有显式选择的通用模型参数才会发送；此映射与 Desktop 的请求预览共享验收样例。
func ApplyGeneric(s Profile, body map[string]any, stream bool) {
	defer stripSamplingOptions(body)
	if !s.Generic {
		return
	}
	if ApplyCatalog(s, body, stream) {
		return
	}
	// 序列化可能在异步流中发生；请求选项必须与设置热更新隔离。
	o := cloneOptions(s.Options)
	reasoning, _ := body["reasoning"].(map[string]any)
	if reasoning == nil {
		reasoning = map[string]any{}
	}
	for key, dest := range map[string]string{"reasoning_effort": "effort", "reasoning_enabled": "enabled", "reasoning_budget": "max_tokens"} {
		if value, ok := o[key]; ok {
			reasoning[dest] = value
		}
	}
	if s.Protocol == ProtocolGoogle {
		g, _ := body["generationConfig"].(map[string]any)
		if g == nil {
			g = map[string]any{}
		}
		if s.ResponseFormat == "json_object" {
			g["responseMimeType"] = "application/json"
		}
		thinking := map[string]any{"includeThoughts": true}
		_, effort := o["reasoning_effort"]
		_, budget := o["reasoning_budget"]
		if value, ok := o["reasoning_effort"].(string); ok {
			thinking["thinkingLevel"] = upperASCII(value)
		}
		if value, ok := o["reasoning_budget"]; ok {
			thinking["thinkingBudget"] = value
		}
		if effort || budget || s.Reasoning {
			g["thinkingConfig"] = thinking
		}
		if len(g) > 0 {
			body["generationConfig"] = g
		}
		return
	}
	if s.Protocol == ProtocolMessages {
		if value, ok := o["reasoning_budget"]; ok {
			body["thinking"] = map[string]any{"type": "enabled", "budget_tokens": value}
		} else if o["reasoning_effort"] != nil || o["reasoning_enabled"] == true {
			body["thinking"] = map[string]any{"type": "adaptive"}
		} else if o["reasoning_enabled"] == false {
			body["thinking"] = map[string]any{"type": "disabled"}
		}
		if value, ok := o["reasoning_effort"]; ok {
			body["output_config"] = map[string]any{"effort": value}
		}
		return
	}
	if value, ok := o["service_tier"]; ok {
		body["service_tier"] = value
	}
	if s.Protocol == ProtocolResponses {
		// 旧 OpenCode Responses 配置保留 auto 请求兼容；公开摘要仍取决于上游实际返回。
		// 新模型池保留用户的“供应商默认”选择，不覆盖显式配置。
		if s.Legacy && s.OpenCode && o["reasoning_summary"] == nil {
			reasoning["summary"] = "auto"
		}
		if value, ok := o["reasoning_summary"]; ok {
			reasoning["summary"] = value
		}
		if len(reasoning) > 0 {
			body["reasoning"] = reasoning
		}
		return
	}
	if s.NativeProvider == "deepseek" && !s.OpenRouter && o["reasoning_effort"] != nil {
		mode := "enabled"
		if o["reasoning_effort"] == "none" {
			mode = "disabled"
		} else {
			body["reasoning_effort"] = o["reasoning_effort"]
		}
		body["thinking"] = map[string]any{"type": mode}
		return
	}
	if s.OpenRouter && len(reasoning) > 0 {
		body["reasoning"] = reasoning
	} else if value, ok := o["reasoning_effort"]; ok {
		body["reasoning_effort"] = value
	}
	if value, ok := o["reasoning_enabled"].(bool); ok && s.OpenCode {
		mode := "disabled"
		if value {
			mode = "enabled"
		}
		body["thinking"] = map[string]any{"type": mode}
	}
}
func upperASCII(value string) string {
	b := []byte(value)
	for i, c := range b {
		if c >= 'a' && c <= 'z' {
			b[i] = c - 32
		}
	}
	return string(b)
}

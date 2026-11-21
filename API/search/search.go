// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: API/search/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: WebSearchHit; WebSearchRound; WebSearchResult; Config; Client; normalizeBaseURL; utf8Prefix; Kind; New; Search; Body; nativeSearchUnsupported; unsupportedSearchCode; SafeURL; addSearchHits; ParseOpenAI; ParseGemini; ParseQwen; errQwenNoSources; qwenResponsesSearch; webSearchItem; searchToolFailure; Error; ParseAnthropic; MaxUses
// Impact: python -B scripts/code-atlas.py show API/search/search.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package search

// Native search adapters consume one host-selected connection and return
// bounded source receipts. They never read application settings or history.
import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/aieyra/aieyra-os/api/catalog"
	"github.com/aieyra/aieyra-os/api/codec"
	"github.com/aieyra/aieyra-os/contracts/privacy"
	"github.com/aieyra/aieyra-os/contracts/protocol"
	contract "github.com/aieyra/aieyra-os/contracts/search"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type WebSearchHit = contract.WebSearchHit
type WebSearchRound = contract.WebSearchRound
type WebSearchResult = contract.WebSearchResult

const (
	webSearchMaxUses     = 3
	webSearchPerRound    = 10
	webSearchMaxResponse = 8 << 20
	webSearchTimeout     = 60 * time.Second
	DefaultBaseURL       = "https://api.deepseek.com"
	ModelFlash           = "deepseek-flash"
)

type Config struct {
	BaseURL, APIKey, Model, Protocol, System string
	Native, Vision                           bool
}
type Client struct {
	Multimodal                                    bool
	Kind, Model, Endpoint, Responses, Key, System string
	Fallback                                      func(context.Context, string) (WebSearchResult, error)
	Client                                        *http.Client
}

func normalizeBaseURL(raw string) string {
	base := strings.TrimRight(strings.TrimSpace(raw), "/")
	base = strings.TrimSuffix(base, "/chat/completions")
	base = strings.TrimSuffix(base, "/responses")
	if base == DefaultBaseURL+"/v1" {
		base = strings.TrimSuffix(base, "/v1")
	}
	return strings.TrimRight(base, "/")
}
func utf8Prefix(s string, n int) string { return contract.PrefixBytes(s, n) }

// Recognition requires an official origin and compatible protocol. An arbitrary
// relay is not silently granted vendor capabilities or a different key origin.
func Kind(s Config) string {
	if strings.TrimSpace(s.APIKey) == "" {
		return ""
	}
	u, err := url.Parse(s.BaseURL)
	if err != nil || u.Scheme != "https" || u.User != nil || (u.Port() != "" && u.Port() != "443") || u.RawQuery != "" || u.Fragment != "" {
		return ""
	}
	host := strings.ToLower(u.Hostname())
	switch {
	case s.Native && normalizeBaseURL(s.BaseURL) == DefaultBaseURL:
		return "deepseek"
	case host == "api.openai.com" && (s.Protocol == protocol.ProtocolResponses || s.Protocol == protocol.ProtocolChat):
		return "openai"
	case host == "api.anthropic.com" && s.Protocol == protocol.ProtocolMessages:
		return "anthropic"
	case host == "generativelanguage.googleapis.com" && s.Protocol == protocol.ProtocolGoogle:
		return "gemini"
	case catalog.VerifiedBailianEndpoint(s.BaseURL) && (s.Protocol == protocol.ProtocolChat || s.Protocol == protocol.ProtocolResponses):
		return "qwen"
	}
	return ""
}

func New(s Config) Client {
	w := Client{Kind: Kind(s), Model: s.Model, Key: s.APIKey, System: s.System, Client: &http.Client{Timeout: webSearchTimeout}}
	w.Multimodal = s.Vision || strings.Contains(s.Model, "-vl") || strings.Contains(s.Model, "-omni")
	for _, prefix := range []string{"qwen3.5-", "qwen3.6-", "qwen3.7-", "qwen3.8-"} {
		w.Multimodal = w.Multimodal || strings.HasPrefix(s.Model, prefix)
	}
	// Do not redirect credential-bearing search requests to another origin.
	w.Client.CheckRedirect = func(req *http.Request, via []*http.Request) error { return http.ErrUseLastResponse }
	base := strings.TrimRight(s.BaseURL, "/")
	switch w.Kind {
	case "deepseek":
		w.Endpoint = DefaultBaseURL + "/anthropic/v1/messages"
	case "openai":
		w.Endpoint = base + "/responses"
	case "anthropic":
		w.Endpoint = base + "/messages"
	case "gemini":
		w.Endpoint = base + "/models/" + url.PathEscape(s.Model) + ":generateContent"
	case "qwen":
		u, _ := url.Parse(base)
		u.Path = "/api/v1/services/aigc/text-generation/generation"
		if w.Multimodal {
			u.Path = "/api/v1/services/aigc/multimodal-generation/generation"
		}
		w.Endpoint = u.String()
		w.Responses = base + "/responses"
	default:
		w.Kind = "local"
	}
	return w
}

func (w Client) Search(ctx context.Context, query string) (WebSearchResult, error) {
	r := WebSearchResult{Query: query, Provider: w.Kind}
	if err := ctx.Err(); err != nil {
		return r, err
	}
	if w.Kind == "local" {
		if w.Fallback == nil {
			return r, fmt.Errorf("本地搜索组件未安装")
		}
		r, e := w.Fallback(ctx, query)
		r.FallbackReason = "native_search_unavailable"
		return r, e
	}
	body := w.Body(query)
	data, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, w.Endpoint, bytes.NewReader(data))
	if err != nil {
		return r, fmt.Errorf("搜索接口地址无效")
	}
	req.Header.Set("Content-Type", "application/json")
	if w.Kind == "qwen" && w.Multimodal {
		req.Header.Set("X-DashScope-SSE", "enable")
	}
	switch w.Kind {
	case "gemini":
		req.Header.Set("x-goog-api-key", w.Key)
	case "openai", "qwen":
		req.Header.Set("Authorization", "Bearer "+w.Key)
	default:
		req.Header.Set("x-api-key", w.Key)
		req.Header.Set("anthropic-version", "2023-06-01")
	}
	resp, err := w.Client.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return r, ctx.Err()
		}
		return r, fmt.Errorf("搜索网络请求未完成")
	}
	defer resp.Body.Close()
	data, err = io.ReadAll(io.LimitReader(resp.Body, webSearchMaxResponse+1))
	if ctx.Err() != nil {
		return r, ctx.Err()
	}
	if err != nil || len(data) > webSearchMaxResponse {
		return r, fmt.Errorf("搜索结果读取失败或过大")
	}
	if resp.StatusCode != http.StatusOK {
		if nativeSearchUnsupported(resp.StatusCode, data) && w.Fallback != nil {
			r, e := w.Fallback(ctx, query)
			r.FallbackReason = "native_search_unsupported"
			return r, e
		}
		var problem struct {
			Code, Message string
			Error         struct{ Code, Message string }
		}
		_ = json.Unmarshal(data, &problem)
		if problem.Code == "" {
			problem.Code = problem.Error.Code
		}
		if problem.Message == "" {
			problem.Message = problem.Error.Message
		}
		detail := utf8Prefix(privacy.RedactSecretEncodings(problem.Code+": "+problem.Message, []string{w.Key}), 300)
		return r, fmt.Errorf("搜索服务返回 HTTP %d：%s；鉴权、额度或网络错误不会触发后备搜索", resp.StatusCode, detail)
	}
	switch w.Kind {
	case "openai":
		err = ParseOpenAI(data, &r)
	case "gemini":
		err = ParseGemini(data, &r)
	case "qwen":
		err = ParseQwen(data, &r)
		if errors.Is(err, errQwenNoSources) && w.Responses != "" {
			err = w.qwenResponsesSearch(ctx, query, &r)
		}
	default:
		err = ParseAnthropic(data, &r)
	}
	if err != nil {
		var failure *searchToolFailure
		if errors.As(err, &failure) && unsupportedSearchCode(failure.code) && w.Fallback != nil {
			r, e := w.Fallback(ctx, query)
			r.FallbackReason = "native_search_unsupported"
			return r, e
		}
		return r, err
	}
	if (w.Kind == "deepseek" || w.Kind == "anthropic") && len(r.Searches) == 0 {
		return r, fmt.Errorf("供应商未返回实际搜索调用，不能把普通模型回答当作联网结果")
	}
	// Sources are bounded and normalized for all transports.
	for i := range r.Searches {
		clean := []WebSearchHit{}
		seen := map[string]bool{}
		for _, hit := range r.Searches[i].Results {
			if !SafeURL(hit.URL) || seen[hit.URL] {
				continue
			}
			seen[hit.URL] = true
			hit.Title = utf8Prefix(strings.TrimSpace(hit.Title), 200)
			hit.Snippet = utf8Prefix(strings.TrimSpace(hit.Snippet), 1200)
			clean = append(clean, hit)
			if len(clean) == webSearchPerRound {
				break
			}
		}
		r.Searches[i].Results = clean
	}
	r.Answer = utf8Prefix(r.Answer, 4000)
	return r, nil
}

func (w Client) Body(query string) map[string]any {
	user := []any{map[string]any{"role": "user", "content": query}}
	switch w.Kind {
	case "openai":
		return map[string]any{"model": w.Model, "instructions": w.System, "input": user, "tools": []any{map[string]any{"type": "web_search"}}, "tool_choice": "required", "include": []string{"web_search_call.action.sources"}, "max_output_tokens": 1600, "store": false}
	case "gemini":
		return map[string]any{"systemInstruction": map[string]any{"parts": []any{map[string]any{"text": w.System}}}, "contents": []any{map[string]any{"role": "user", "parts": []any{map[string]any{"text": query}}}}, "tools": []any{map[string]any{"google_search": map[string]any{}}}, "generationConfig": map[string]any{"maxOutputTokens": 1600}}
	case "qwen":
		// The compatible chat endpoint cannot return sources. Use the official
		// DashScope endpoint on the same authenticated origin for source receipts.
		messages := append([]any{map[string]any{"role": "system", "content": w.System}}, user...)
		params := map[string]any{"enable_search": true, "search_options": map[string]any{"forced_search": true, "enable_source": true, "enable_citation": true}, "enable_thinking": false, "max_tokens": 1600, "result_format": "message"}
		if w.Multimodal {
			for _, m := range messages {
				msg := m.(map[string]any)
				msg["content"] = []any{map[string]any{"text": msg["content"]}}
			}
			params["incremental_output"] = true
		}
		return map[string]any{"model": w.Model, "input": map[string]any{"messages": messages}, "parameters": params}
	default:
		model := w.Model
		if w.Kind == "deepseek" || w.Kind == "" {
			model = ModelFlash
		}
		body := map[string]any{"model": model, "max_tokens": 1600, "system": w.System, "messages": user, "tools": []any{map[string]any{"type": "web_search_20250305", "name": "web_search", "max_uses": webSearchMaxUses}}}
		if w.Kind == "deepseek" || w.Kind == "" {
			body["thinking"] = map[string]any{"type": "disabled"}
		}
		return body
	}
}

func nativeSearchUnsupported(status int, data []byte) bool {
	if status != 400 && status != 422 {
		return false
	}
	var e struct {
		Code, Message string
		Error         struct{ Code, Type, Message, Param string }
	}
	if json.Unmarshal(data, &e) != nil {
		return false
	}
	if e.Error.Message == "" {
		e.Error.Message = e.Message
	}
	if e.Error.Code == "" {
		e.Error.Code = e.Code
	}
	if unsupportedSearchCode(e.Error.Code) {
		return true
	}
	msg := strings.ToLower(e.Error.Message)
	feature := strings.Contains(msg, "web_search") || strings.Contains(msg, "web search") || strings.Contains(msg, "google_search") || strings.Contains(msg, "enable_search") || strings.Contains(msg, "grounding")
	return feature && (strings.Contains(msg, "not supported") || strings.Contains(msg, "does not support") || strings.Contains(msg, "unsupported"))
}

func unsupportedSearchCode(code string) bool {
	return code == "web_search_not_supported" || code == "unsupported_web_search"
}

func SafeURL(raw string) bool { return contract.SafeURL(raw) }

func addSearchHits(r *WebSearchResult, hits []WebSearchHit) {
	r.Searches = append(r.Searches, WebSearchRound{Query: r.Query, Results: hits, Total: len(hits)})
}

func ParseOpenAI(data []byte, r *WebSearchResult) error {
	var p struct {
		Status string
		Output []struct {
			Type    string
			Status  string
			Action  struct{ Sources []WebSearchHit }
			Content []struct {
				Type, Text  string
				Annotations []struct{ Type, Title, URL string }
			}
		}
	}
	if json.Unmarshal(data, &p) != nil {
		return fmt.Errorf("OpenAI搜索结果格式无效")
	}
	if p.Status != "completed" && p.Status != "incomplete" {
		return fmt.Errorf("OpenAI搜索请求未完成")
	}
	hits := []WebSearchHit{}
	searched := false
	for _, o := range p.Output {
		if o.Type == "web_search_call" && o.Status == "completed" {
			searched = true
			hits = append(hits, o.Action.Sources...)
		}
		for _, c := range o.Content {
			if c.Type == "output_text" {
				r.Answer += c.Text
			}
			for _, a := range c.Annotations {
				if a.Type == "url_citation" {
					hits = append(hits, WebSearchHit{Title: a.Title, URL: a.URL})
				}
			}
		}
	}
	if !searched {
		return fmt.Errorf("供应商未返回实际搜索调用，不能把普通模型回答当作联网结果")
	}
	addSearchHits(r, hits)
	r.Truncated = p.Status == "incomplete"
	return nil
}

func ParseGemini(data []byte, r *WebSearchResult) error {
	var p struct {
		Candidates []struct {
			Content struct {
				Parts []struct {
					Text    string
					Thought bool
				}
			}
			FinishReason      string
			GroundingMetadata struct {
				WebSearchQueries []string
				GroundingChunks  []struct{ Web WebSearchHit }
			}
		}
	}
	if json.Unmarshal(data, &p) != nil || len(p.Candidates) == 0 {
		return fmt.Errorf("Gemini搜索结果格式无效")
	}
	c := p.Candidates[0]
	hits := []WebSearchHit{}
	// Gemini names source addresses uri instead of url.
	var raw struct {
		Candidates []struct {
			GroundingMetadata struct {
				GroundingChunks []struct{ Web struct{ Title, URI string } }
			}
		}
	}
	_ = json.Unmarshal(data, &raw)
	for _, h := range raw.Candidates[0].GroundingMetadata.GroundingChunks {
		hits = append(hits, WebSearchHit{Title: h.Web.Title, URL: h.Web.URI})
	}
	if len(hits) == 0 && len(c.GroundingMetadata.WebSearchQueries) == 0 {
		return fmt.Errorf("Gemini没有返回搜索来源或查询凭据，不能确认已联网")
	}
	for _, part := range c.Content.Parts {
		if !part.Thought {
			r.Answer += part.Text
		}
	}
	addSearchHits(r, hits)
	r.Truncated = c.FinishReason == "MAX_TOKENS"
	return nil
}

func ParseQwen(data []byte, r *WebSearchResult) error {
	type info struct {
		SearchResults []struct{ Title, URL string } `json:"search_results"`
	}
	type choice struct {
		Message      struct{ Content json.RawMessage }
		FinishReason string `json:"finish_reason"`
	}
	hits := []WebSearchHit{}
	ended := false
	frame := func(data []byte) error {
		if strings.TrimSpace(string(data)) == "[DONE]" {
			return nil
		}
		var p struct {
			Code, Message string
			Choices       []choice
			SearchInfo    info `json:"search_info"`
			Output        struct {
				Choices    []choice
				SearchInfo info `json:"search_info"`
			}
		}
		if json.Unmarshal(data, &p) != nil {
			return fmt.Errorf("Qwen搜索结果格式无效")
		}
		if p.Code != "" {
			return fmt.Errorf("Qwen搜索流返回错误，未确认完整结果")
		}
		if len(p.Choices) == 0 {
			p.Choices = p.Output.Choices
		}
		for _, h := range append(p.SearchInfo.SearchResults, p.Output.SearchInfo.SearchResults...) {
			if SafeURL(h.URL) {
				hits = append(hits, WebSearchHit{Title: h.Title, URL: h.URL})
			}
		}
		if len(p.Choices) > 0 {
			c := p.Choices[0]
			var text string
			if json.Unmarshal(c.Message.Content, &text) != nil {
				var parts []struct{ Text string }
				if json.Unmarshal(c.Message.Content, &parts) == nil {
					for _, part := range parts {
						text += part.Text
					}
				}
			}
			r.Answer += text
			ended = ended || c.FinishReason == "stop" || c.FinishReason == "length"
			r.Truncated = r.Truncated || c.FinishReason == "length"
		}
		return nil
	}
	var err error
	if json.Valid(data) {
		err = frame(data)
	} else {
		err = codec.ReadSSE(bytes.NewReader(data), frame)
	}
	if err != nil {
		return err
	}
	if !ended {
		return fmt.Errorf("Qwen搜索响应缺少完整结束状态")
	}
	if len(hits) == 0 {
		return errQwenNoSources
	}
	addSearchHits(r, hits)
	return nil
}

var errQwenNoSources = errors.New("Qwen没有返回搜索来源，不能确认已联网")

// Newer Qwen models (for example qwen3.8) can search on the native endpoint
// without returning search_info. The same origin's Responses API reports the
// web_search call itself, which is the receipt this tool requires. This runs
// only after the native answer came back without sources.
func (w Client) qwenResponsesSearch(ctx context.Context, query string, r *WebSearchResult) error {
	body, _ := json.Marshal(map[string]any{"model": w.Model, "instructions": w.System, "input": []any{map[string]any{"role": "user", "content": query}}, "tools": []any{map[string]any{"type": "web_search"}}, "max_output_tokens": 1600, "store": false})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, w.Responses, bytes.NewReader(body))
	if err != nil {
		return errQwenNoSources
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+w.Key)
	resp, err := w.Client.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return errQwenNoSources
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, webSearchMaxResponse+1))
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if err != nil || len(data) > webSearchMaxResponse || resp.StatusCode != http.StatusOK {
		return errQwenNoSources
	}
	next := WebSearchResult{Query: r.Query, Provider: r.Provider}
	if ParseOpenAI(data, &next) != nil || len(next.Searches) == 0 || len(next.Searches[0].Results) == 0 {
		return errQwenNoSources
	}
	*r = next
	return nil
}

type webSearchItem struct {
	Type      string `json:"type"`
	Title     string `json:"title"`
	URL       string `json:"url"`
	PageAge   string `json:"page_age"`
	ErrorCode string `json:"error_code"`
}

type searchToolFailure struct{ code string }

func (e *searchToolFailure) Error() string {
	return "搜索工具未完成：" + utf8Prefix(e.code, 120)
}

// 服务端调用与结果按 tool_use_id 配对（可能先出现几次调用再出现结果）；结论取最后一份结果之后的正文。
func ParseAnthropic(data []byte, r *WebSearchResult) error {
	var payload struct {
		Content    []json.RawMessage `json:"content"`
		StopReason string            `json:"stop_reason"`
	}
	if err := json.Unmarshal(data, &payload); err != nil {
		return fmt.Errorf("搜索结果格式无效")
	}
	rounds := map[string]int{}
	round := func(id string) int {
		if i, ok := rounds[id]; ok {
			return i
		}
		rounds[id] = len(r.Searches)
		r.Searches = append(r.Searches, WebSearchRound{})
		return rounds[id]
	}
	var all, after []string
	completed := false
	var toolError string
	for _, raw := range payload.Content {
		var block struct {
			Type      string          `json:"type"`
			ID        string          `json:"id"`
			ToolUseID string          `json:"tool_use_id"`
			Text      string          `json:"text"`
			Input     json.RawMessage `json:"input"`
			Content   json.RawMessage `json:"content"`
		}
		if json.Unmarshal(raw, &block) != nil {
			continue
		}
		switch block.Type {
		case "server_tool_use":
			var input struct {
				Query string `json:"query"`
			}
			_ = json.Unmarshal(block.Input, &input)
			r.Searches[round(block.ID)].Query = utf8Prefix(strings.TrimSpace(input.Query), 400)
		case "web_search_tool_result":
			i := round(block.ToolUseID)
			var items []webSearchItem
			array := strings.HasPrefix(strings.TrimSpace(string(block.Content)), "[") && json.Unmarshal(block.Content, &items) == nil
			if !array {
				var one webSearchItem
				if json.Unmarshal(block.Content, &one) == nil {
					items = []webSearchItem{one}
				}
			}
			// An acknowledged empty result is a successful query. A request,
			// error object or unfinished stream alone is not search evidence.
			if array && len(items) == 0 {
				completed = true
			}
			for _, item := range items {
				switch {
				case item.Type == "web_search_result" && SafeURL(item.URL):
					completed = true
					r.Searches[i].Total++
					if len(r.Searches[i].Results) < webSearchPerRound {
						r.Searches[i].Results = append(r.Searches[i].Results, WebSearchHit{Title: utf8Prefix(strings.TrimSpace(item.Title), 200), URL: item.URL, PageAge: utf8Prefix(item.PageAge, 60)})
					}
				case item.ErrorCode != "":
					r.Searches[i].Error = item.ErrorCode
					toolError = item.ErrorCode
				}
			}
			after = nil
		case "text":
			all = append(all, block.Text)
			after = append(after, block.Text)
		}
	}
	answer := strings.TrimSpace(strings.Join(after, ""))
	if answer == "" {
		answer = strings.TrimSpace(strings.Join(all, ""))
	}
	r.Answer = utf8Prefix(answer, 4000)
	r.Truncated = payload.StopReason == "max_tokens"
	if !completed {
		if toolError != "" {
			return &searchToolFailure{toolError}
		}
		return fmt.Errorf("搜索服务未返回已完成的搜索回执，不能把普通模型回答当作联网结果")
	}
	return nil
}

const MaxUses = webSearchMaxUses

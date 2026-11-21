// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: API/adapter/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: Selection; Field; Definition; identity; digest; route; header; Validate; Decode; validRoute; Validate; Prepare
// Impact: python -B scripts/code-atlas.py show API/adapter/definition.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Package adapter defines declarative provider extensions over the shared wire
// protocols. It does not load packages, credentials, settings or network data.
package adapter

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"

	"github.com/aieyra/aieyra-os/api/parameters"
	"github.com/aieyra/aieyra-os/contracts/protocol"
)

type Selection struct {
	ID     string `json:"id"`
	Digest string `json:"digest"`
}

type Field struct {
	Spec  parameters.Spec `json:"spec"`
	Value any             `json:"value"`
}

type Definition struct {
	Schema       string            `json:"schema"`
	Protocol     string            `json:"protocol"`
	Path         string            `json:"path,omitempty"`
	StreamPath   string            `json:"stream_path,omitempty"`
	Headers      map[string]string `json:"headers,omitempty"`
	ModelAliases map[string]string `json:"model_aliases,omitempty"`
	Defaults     []Field           `json:"defaults,omitempty"`
}

var identity = regexp.MustCompile(`^[a-z][a-z0-9_-]*(?:\.[a-z0-9_-]+)+$`)
var digest = regexp.MustCompile(`^[a-f0-9]{64}$`)
var route = regexp.MustCompile(`^/[A-Za-z0-9_/{\}:.-]+(?:\?alt=sse)?$`)
var header = regexp.MustCompile(`^(?:x-[a-z0-9-]+|anthropic-version|anthropic-beta)$`)

func (s Selection) Validate() error {
	if len(s.ID) > 160 || !identity.MatchString(s.ID) || !digest.MatchString(s.Digest) {
		return fmt.Errorf("invalid API adapter package selection")
	}
	return nil
}

func Decode(raw []byte) (Definition, error) {
	var d Definition
	if len(raw) > 64<<10 {
		return d, fmt.Errorf("API adapter definition exceeds limit")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&d); err != nil {
		return d, err
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return d, fmt.Errorf("API adapter has trailing data")
	}
	return d, d.Validate()
}

func validRoute(value string) bool {
	if value == "" {
		return true
	}
	if len(value) > 256 || !route.MatchString(value) || strings.Contains(value, "//") || strings.Count(value, "{model}") > 1 {
		return false
	}
	plain := strings.ReplaceAll(value, "{model}", "model")
	if strings.ContainsAny(plain, "{}") {
		return false
	}
	for _, segment := range strings.Split(strings.SplitN(plain, "?", 2)[0], "/") {
		if segment == "." || segment == ".." {
			return false
		}
	}
	return true
}

func (d Definition) Validate() error {
	if d.Schema != "aieyra.api/1" {
		return fmt.Errorf("unsupported API adapter schema")
	}
	switch d.Protocol {
	case protocol.ProtocolChat, protocol.ProtocolResponses, protocol.ProtocolMessages, protocol.ProtocolGoogle:
	default:
		return fmt.Errorf("unsupported API adapter protocol")
	}
	if !validRoute(d.Path) || !validRoute(d.StreamPath) {
		return fmt.Errorf("API adapter routes must stay inside the configured base URL")
	}
	if len(d.Headers) > 16 || len(d.ModelAliases) > 128 || len(d.Defaults) > 24 {
		return fmt.Errorf("API adapter definition exceeds field limit")
	}
	for key, value := range d.Headers {
		if !header.MatchString(key) || len(key) > 64 || len(value) > 512 || strings.TrimSpace(value) != value || strings.ContainsAny(value, "\r\n\x00") {
			return fmt.Errorf("invalid API adapter header")
		}
		switch key {
		case "x-api-key", "x-goog-api-key", "x-opencode-session", "x-forwarded-host", "x-forwarded-proto", "x-forwarded-for", "x-original-url", "x-rewrite-url":
			return fmt.Errorf("API adapter cannot override credential, routing or session headers")
		}
		for _, r := range value {
			if r < 32 || r > 126 {
				return fmt.Errorf("API adapter header must use visible ASCII")
			}
		}
	}
	for key, value := range d.ModelAliases {
		if key == "" || value == "" || len(key) > 256 || len(value) > 256 || strings.ContainsAny(key+value, "\r\n\x00") {
			return fmt.Errorf("invalid API adapter model alias")
		}
	}
	paths := []string{}
	for _, field := range d.Defaults {
		if !parameters.ValidPath(field.Spec) || !parameters.ValidValue(field.Spec, field.Value) {
			return fmt.Errorf("invalid API adapter parameter default")
		}
		p := strings.Join(field.Spec.WirePath, ".")
		for _, old := range paths {
			if p == old || strings.HasPrefix(p, old+".") || strings.HasPrefix(old, p+".") {
				return fmt.Errorf("overlapping API adapter parameter defaults")
			}
		}
		paths = append(paths, p)
	}
	return nil
}

// Prepare returns a fresh body. User-provided values take precedence; an
// extension cannot replace protocol messages, tools, stream flags or identity.
func (d Definition) Prepare(base, kind, model string, stream bool, body any) (string, []byte, http.Header, error) {
	if err := d.Validate(); err != nil {
		return "", nil, nil, err
	}
	if kind != d.Protocol {
		return "", nil, nil, fmt.Errorf("API adapter protocol does not match the selected model")
	}
	u, err := url.Parse(base)
	if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return "", nil, nil, fmt.Errorf("invalid model base URL")
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return "", nil, nil, err
	}
	var value map[string]any
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	if err = decoder.Decode(&value); err != nil || value == nil {
		return "", nil, nil, fmt.Errorf("API adapter requires a request object")
	}
	wireModel := model
	if alias, ok := d.ModelAliases[model]; ok {
		wireModel = alias
	}
	if kind != protocol.ProtocolGoogle {
		value["model"] = wireModel
	}
	for _, field := range d.Defaults {
		at := value
		path := field.Spec.WirePath
		for _, key := range path[:len(path)-1] {
			if old, ok := at[key]; ok {
				child, ok := old.(map[string]any)
				if !ok {
					return "", nil, nil, fmt.Errorf("API adapter parameter parent is not an object")
				}
				at = child
			} else {
				child := map[string]any{}
				at[key] = child
				at = child
			}
		}
		key := path[len(path)-1]
		if _, exists := at[key]; !exists {
			at[key] = field.Value
		}
	}
	raw, err = json.Marshal(value)
	if err != nil {
		return "", nil, nil, err
	}
	path := d.Path
	if stream && d.StreamPath != "" {
		path = d.StreamPath
	}
	if path == "" {
		switch kind {
		case protocol.ProtocolChat:
			path = "/chat/completions"
		case protocol.ProtocolResponses:
			path = "/responses"
		case protocol.ProtocolMessages:
			path = "/messages"
		case protocol.ProtocolGoogle:
			path = "/models/{model}:generateContent"
			if stream {
				path = "/models/{model}:streamGenerateContent?alt=sse"
			}
		}
	}
	headers := http.Header{}
	for key, value := range d.Headers {
		headers.Set(key, value)
	}
	return strings.TrimRight(base, "/") + strings.ReplaceAll(path, "{model}", url.PathEscape(wireModel)), raw, headers, nil
}

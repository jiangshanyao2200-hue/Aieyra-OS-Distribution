package websearch

import (
	"bytes"
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	shared "github.com/aieyra/aieyra-os/contracts/search"
	"github.com/aieyra/aieyra-os/tool/base/official/web_search/contract"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
)

//go:embed ddgs_bridge.py
var ddgsBridge string

type LocalOptions struct {
	Python    string
	Configure func(*exec.Cmd)
}

var localSearchSlots = make(chan struct{}, 2)

func Local(ctx context.Context, query string, options LocalOptions) (contract.Result, error) {
	r := contract.Result{Query: query, Provider: "ddgs"}
	if err := ctx.Err(); err != nil {
		return r, err
	}
	select {
	case localSearchSlots <- struct{}{}:
		defer func() { <-localSearchSlots }()
	case <-ctx.Done():
		return r, ctx.Err()
	}
	cmd := exec.CommandContext(ctx, options.Python, "-I", "-B", "-c", ddgsBridge)
	if options.Configure != nil {
		options.Configure(cmd)
	}
	// No model keys, Python startup hooks or working-directory imports enter
	// the helper. Proxy variables are explicit transport settings only.
	cmd.Env = []string{}
	for _, k := range []string{"SystemRoot", "WINDIR", "TEMP", "TMP", "PATH", "SSL_CERT_FILE", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY"} {
		if v, ok := os.LookupEnv(k); ok {
			cmd.Env = append(cmd.Env, k+"="+v)
		}
	}
	cmd.Dir = filepath.Dir(options.Python)
	input, _ := json.Marshal(map[string]string{"query": query})
	cmd.Stdin = bytes.NewReader(input)
	out := &searchOutputBuffer{limit: 128 << 10}
	cmd.Stdout = out
	cmd.Stderr = io.Discard
	if err := cmd.Run(); err != nil {
		if ctx.Err() != nil {
			return r, ctx.Err()
		}
		return r, fmt.Errorf("本地搜索未完成；请检查网络或搜索运行时")
	}
	if ctx.Err() != nil {
		return r, ctx.Err()
	}
	var body struct {
		Results []contract.Hit
		Error   string
	}
	if out.over || json.Unmarshal(out.data.Bytes(), &body) != nil || body.Error != "" {
		return r, fmt.Errorf("本地搜索结果格式无效")
	}
	hits := []contract.Hit{}
	seen := map[string]bool{}
	for _, h := range body.Results {
		if !shared.SafeURL(h.URL) || seen[h.URL] {
			continue
		}
		seen[h.URL] = true
		h.Title = shared.PrefixBytes(strings.TrimSpace(h.Title), 200)
		h.Snippet = shared.PrefixBytes(strings.TrimSpace(h.Snippet), 1200)
		hits = append(hits, h)
		if len(hits) == 10 {
			break
		}
	}
	r.Searches = append(r.Searches, contract.Round{Query: query, Results: hits, Total: len(hits)})
	return r, nil
}

// Keep a faulty helper from filling memory while still draining its pipe.
type searchOutputBuffer struct {
	mu    sync.Mutex
	data  bytes.Buffer
	limit int
	over  bool
}

func (b *searchOutputBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	n := len(p)
	room := b.limit - b.data.Len()
	if n > room {
		b.over = true
		p = p[:room]
	}
	b.data.Write(p)
	return n, nil
}

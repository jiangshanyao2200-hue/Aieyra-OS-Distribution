package websearch

import (
	"context"
	"github.com/aieyra/aieyra-os/tool/base/official/web_search/contract"
	"strings"
	"time"
	"unicode/utf8"
)

const Timeout = 60 * time.Second

type Search func(context.Context, string) (contract.Result, error)

// Execute owns request validation and result lifecycle. The host supplies an
// already authorized backend, never a settings file or conversation history.
func Execute(ctx context.Context, req contract.Request, search Search) (r contract.Result) {
	req.Query = strings.TrimSpace(req.Query)
	r = contract.Result{State: "rejected", Query: req.Query, Description: req.Description}
	fail := func(state, code, message string) contract.Result {
		r.OK = false
		r.State = state
		r.Answer = ""
		r.Error = &contract.Error{Code: code, Message: message}
		return r
	}
	if req.Query == "" || utf8.RuneCountInString(req.Query) > 400 || utf8.RuneCountInString(req.Description) > 120 {
		return fail("rejected", "invalid_arguments", "请提供 400 字以内的搜索关键词和简短用途")
	}
	if search == nil {
		return fail("rejected", "search_unavailable", "当前模型未提供已支持的搜索接口，且本地搜索组件不可用")
	}
	ctx, cancel := context.WithTimeout(ctx, Timeout)
	defer cancel()
	if ctx.Err() != nil {
		return fail("cancelled", "cancelled", "搜索已取消或超时")
	}
	result, err := search(ctx, req.Query)
	result.Query, result.Description = req.Query, req.Description
	r = result
	if ctx.Err() != nil {
		return fail("cancelled", "cancelled", "搜索已取消或超时")
	}
	if err != nil {
		return fail("failed", "search_failed", err.Error())
	}
	r.OK, r.State, r.RetrievedAt = true, "completed", time.Now().UTC().Format(time.RFC3339)
	return r
}

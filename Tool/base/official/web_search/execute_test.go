package websearch

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/aieyra/aieyra-os/tool/base/official/web_search/contract"
)

func TestExecuteCancellationCannotBecomeSuccess(t *testing.T) {
	for _, before := range []bool{true, false} {
		ctx, cancel := context.WithCancel(context.Background())
		if before {
			cancel()
		}
		calls := 0
		r := Execute(ctx, contract.Request{Query: " source "}, func(ctx context.Context, q string) (contract.Result, error) {
			calls++
			cancel()
			return contract.Result{Answer: "late success", Provider: "fixture"}, nil
		})
		if r.OK || r.State != "cancelled" || r.Error == nil || r.Answer != "" || before && calls != 0 || !before && calls != 1 {
			t.Fatalf("cancellation: before=%v calls=%d result=%+v", before, calls, r)
		}
	}
}
func TestExecuteValidationProvenanceAndErrors(t *testing.T) {
	calls := 0
	backend := func(ctx context.Context, q string) (contract.Result, error) {
		calls++
		if q != "query" {
			t.Fatal(q)
		}
		return contract.Result{Provider: "ddgs", FallbackReason: "native_search_unsupported", Searches: []contract.Round{{Query: q, Results: []contract.Hit{{Title: "Source", URL: "https://example.invalid/exact?q=1#x"}}, Total: 1}}}, nil
	}
	for _, q := range []string{"", strings.Repeat("界", 401)} {
		r := Execute(context.Background(), contract.Request{Query: q}, backend)
		if r.Error == nil || r.Error.Code != "invalid_arguments" || calls != 0 {
			t.Fatal(r)
		}
	}
	r := Execute(context.Background(), contract.Request{Query: "  query ", Description: "purpose"}, backend)
	if !r.OK || r.State != "completed" || r.Query != "query" || r.Description != "purpose" || r.RetrievedAt == "" || r.FallbackReason != "native_search_unsupported" || r.Searches[0].Results[0].URL != "https://example.invalid/exact?q=1#x" {
		t.Fatal(r)
	}
	r = Execute(context.Background(), contract.Request{Query: "query"}, nil)
	if r.Error == nil || r.Error.Code != "search_unavailable" {
		t.Fatal(r)
	}
	r = Execute(context.Background(), contract.Request{Query: "query"}, func(context.Context, string) (contract.Result, error) {
		return contract.Result{Provider: "fixture", Answer: "unconfirmed answer"}, errors.New("unavailable")
	})
	if r.OK || r.State != "failed" || r.Answer != "" || r.Provider != "fixture" || r.Error.Code != "search_failed" {
		t.Fatal(r)
	}
}

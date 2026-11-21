package imagegen

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/aieyra/aieyra-os/contracts/protocol"
	"github.com/aieyra/aieyra-os/tool/toolbox/official/imagegen/contract"
	imagetext "github.com/aieyra/aieyra-os/tool/toolbox/official/imagegen/presentation/text"
	"strings"
	"testing"
)

func TestAttemptAccountingFailurePreservesImageAndStopsTheGroup(t *testing.T) {
	writes, calls, saves := 0, 0, 0
	host := Host{InvocationID: "fixture-call", TaskID: "fixture-task", Resolve: func(string) (Choice, error) {
		return Choice{Model: "image", Name: "fixture", ProfileID: "fixture-profile"}, nil
	}, Prepare: func() error { return nil }, Recovery: func(state string) string { return "recovery:" + state }}
	host.WriteUsage = func(row protocol.AgentUsage) error {
		writes++
		if row.SourceID != "fixture-call:image:1" {
			t.Error(row.SourceID)
		}
		if writes == 2 {
			return errors.New("accounting unavailable")
		}
		return nil
	}
	host.Generate = func(ctx context.Context, r protocol.ImageRequest, observe func(*protocol.AgentUsage) error) ([]byte, error) {
		calls++
		if r.Quality != "high" || r.OutputFormat != "png" {
			t.Error(r)
		}
		if err := observe(nil); err != nil {
			return nil, err
		}
		_ = observe(&protocol.AgentUsage{Kind: "image_gen", Reported: true, Input: 39, Output: 515})
		return []byte("fixture"), nil
	}
	host.Save = func(data []byte, item contract.Image) (contract.Image, error) {
		saves++
		if item.TaskID != "fixture-task" || item.QualityReview != "pending_visual_review" {
			t.Error(item)
		}
		item.Path = "fixture.png"
		return item, nil
	}
	out, err := Execute(context.Background(), []byte(`{"prompt":"fixture","count":4}`), host)
	if err != nil || out.State != "accounting_failed" || out.Completed != 1 || out.Submitted != 1 || out.Unsubmitted != 3 || calls != 1 || saves != 1 {
		t.Fatal(out, err, calls, saves)
	}
	raw, _ := json.Marshal(out)
	text, ok := imagetext.Preview(raw)
	if !ok || !strings.Contains(text, "1 / 4") || !strings.Contains(text, "用量保存待核对") || !strings.Contains(text, `"quality_review": "pending_visual_review"`) {
		t.Fatal(text, ok)
	}
}
func TestUncertainProviderOutcomeNeverBecomesACompletedImage(t *testing.T) {
	calls, saves := 0, 0
	host := Host{Resolve: func(string) (Choice, error) { return Choice{Model: "image"}, nil }, Prepare: func() error { return nil }, Recovery: func(state string) string { return state },
		Generate: func(ctx context.Context, r protocol.ImageRequest, observe func(*protocol.AgentUsage) error) ([]byte, error) {
			calls++
			if err := observe(nil); err != nil {
				return nil, err
			}
			return nil, &protocol.ImageProviderError{Message: "unknown", Unknown: true}
		},
		Save: func(data []byte, item contract.Image) (contract.Image, error) { saves++; return item, nil }}
	out, err := Execute(context.Background(), []byte(`{"prompt":"fixture","count":4}`), host)
	if err == nil || out.State != "unknown" || !out.Unknown || out.Completed != 0 || out.Submitted != 1 || out.Unsubmitted != 3 || calls != 1 || saves != 0 {
		t.Fatal(out, err, calls, saves)
	}
	raw, _ := json.Marshal(out)
	text, ok := imagetext.Preview(raw)
	if !ok || !strings.Contains(text, "请勿重复提交") {
		t.Fatal(text, ok)
	}
}
func TestImageTextProjectionDoesNotClaimOtherReceipts(t *testing.T) {
	for _, raw := range []string{`{"images":[]}`, `{"requested":2,"submitted":0,"completed":0,"images":[]}`, `{"output":"keep original"}`} {
		if _, ok := imagetext.Preview([]byte(raw)); ok {
			t.Fatal(raw)
		}
	}
}

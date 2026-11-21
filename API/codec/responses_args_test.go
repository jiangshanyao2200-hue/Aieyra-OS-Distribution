// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: API/codec/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestToolArgumentsAgree; TestResponsesEmptyArgumentsDoneRetainsStreamUntilFinalValidation
// Impact: python -B scripts/code-atlas.py show API/codec/responses_args_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package codec

import (
	"fmt"
	"strings"
	"testing"
)

func TestToolArgumentsAgree(t *testing.T) {
	cases := []struct {
		streamed, full string
		done, want     bool
	}{
		{`{"a":1}`, `{"a":1}`, false, true},
		{`{"a":`, `{"a":1}`, false, true},
		{`{"a":1,"b":[2]}`, "{\n \"b\": [2],\n \"a\": 1\n}", false, true},
		{`{"a":1}`, `{ "a": 1 }`, true, true},
		{`{"a":1}`, `{"a":2}`, false, false},
		{`{"a":1}`, `{"a":1,"b":2}`, true, false},
		{`{"a":`, `{"b":1}`, false, false},
		{"", `{"a":1}`, false, true},
	}
	for _, c := range cases {
		if got := toolArgumentsAgree(c.streamed, c.full, c.done); got != c.want {
			t.Errorf("toolArgumentsAgree(%q,%q,%v)=%v want %v", c.streamed, c.full, c.done, got, c.want)
		}
	}
}

func TestResponsesEmptyArgumentsDoneRetainsStreamUntilFinalValidation(t *testing.T) {
	const arguments = `{"cmd":"Write-Output 791"}`
	const added = `{"type":"response.output_item.added","output_index":0,"item":{"type":"function_call","id":"item_1","call_id":"call_1","name":"terminal","arguments":""}}`
	const delta = `{"type":"response.function_call_arguments.delta","output_index":0,"item_id":"item_1","delta":"{\"cmd\":\"Write-Output 791\"}"}`
	const done = `{"type":"response.function_call_arguments.done","output_index":0,"item_id":"item_1","arguments":""}`
	const item = `{"type":"function_call","id":"item_1","call_id":"call_1","name":"terminal","arguments":%q}`
	for _, c := range []struct {
		name, outputItem, completed, lateDelta string
		wantCall                               bool
	}{
		{name: "same final arguments", outputItem: arguments, completed: arguments, wantCall: true},
		{name: "conflicting item", outputItem: `{"cmd":"different"}`, completed: arguments},
		{name: "conflicting completed response", outputItem: arguments, completed: `{"cmd":"different"}`},
		{name: "empty final arguments", outputItem: "", completed: ""},
		{name: "delta after completion marker", outputItem: arguments, completed: arguments, lateDelta: delta},
	} {
		t.Run(c.name, func(t *testing.T) {
			frames := []string{added, delta, done}
			if c.lateDelta != "" {
				frames = append(frames, c.lateDelta)
			}
			frames = append(frames,
				`{"type":"response.output_item.done","output_index":0,"item":`+fmt.Sprintf(item, c.outputItem)+`}`,
				`{"type":"response.completed","response":{"id":"resp_1","status":"completed","output":[`+fmt.Sprintf(item, c.completed)+`]}}`,
			)
			stream := "data: " + strings.Join(frames, "\n\ndata: ") + "\n\n"
			calls := 0
			err := ReadResponseStream(strings.NewReader(stream), func(event Event) error {
				if event.Kind == EventResponse {
					if len(event.Message.ToolCalls) != 1 || event.Message.ToolCalls[0].Function.Arguments != arguments {
						t.Fatalf("unexpected tool calls: %+v", event.Message.ToolCalls)
					}
					calls++
				}
				return nil
			})
			if c.wantCall && (err != nil || calls != 1) || !c.wantCall && (err == nil || calls != 0) {
				t.Fatalf("calls=%d, err=%v, wantCall=%v", calls, err, c.wantCall)
			}
		})
	}
}

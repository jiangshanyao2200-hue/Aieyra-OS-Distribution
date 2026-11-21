package terminal

import (
	"context"
	"encoding/json"
	"github.com/aieyra/aieyra-os/contracts/protocol"
	"github.com/aieyra/aieyra-os/tool/base/official/terminal/contract"
	"strings"
	"testing"
)

func call(name, args string) protocol.ToolCall {
	return protocol.ToolCall{ID: "original", Function: protocol.FunctionCall{Name: name, Arguments: args}}
}

func TestDispatchPreservesRequestBytesContextAndReceipt(t *testing.T) {
	type receipt struct {
		Session int
		Unknown *int
	}
	marker := 42
	want := receipt{7, &marker}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	var actions []string
	service := Service[receipt]{
		Start: func(got context.Context, req contract.Command) receipt {
			if got != ctx || got.Err() != context.Canceled || req.Cmd != "echo 中文\nnext" || req.Env["LITERAL"] != "a\\r" {
				t.Fatal(got, req)
			}
			actions = append(actions, "exec")
			return want
		},
		Input: func(got context.Context, req contract.Input) receipt {
			if got != ctx || req.SessionID != 7 {
				t.Fatal(got, req)
			}
			switch len(actions) {
			case 1:
				if req.Chars != "a\\r\n中文" || !req.PressEnter || req.Terminate {
					t.Fatal(req)
				}
			case 2:
				if req.Chars != "" || req.Terminate || req.YieldTimeMS == nil || *req.YieldTimeMS != 13 {
					t.Fatal(req)
				}
			case 3:
				if !req.Terminate || req.Chars != "" {
					t.Fatal(req)
				}
			}
			actions = append(actions, "input")
			return want
		},
		Read: func(got context.Context, req contract.Read) receipt {
			if got != ctx || req.SessionID != 7 || req.Offset != 99 {
				t.Fatal(got, req)
			}
			actions = append(actions, "read")
			return want
		},
	}
	for _, raw := range []string{
		`{"action":"exec","cmd":"echo 中文\nnext","env":{"LITERAL":"a\\r"}}`,
		`{"action":"input","session_id":7,"chars":"a\\r\n中文","press_enter":true}`,
		`{"action":"wait","session_id":7,"timeout_ms":13}`,
		`{"action":"stop","session_id":7}`,
		`{"action":"read","session_id":7,"offset":99}`,
	} {
		got, err := Execute(ctx, call("terminal", raw), service)
		if err != nil || got != want {
			t.Fatal(got, err)
		}
	}
	if strings.Join(actions, ",") != "exec,input,input,input,read" {
		t.Fatal(actions)
	}
	got, err := Execute(ctx, call("read_shell_output", `{"session_id":7,"offset":99}`), service)
	if err != nil || got != want {
		t.Fatal("legacy replay", got, err)
	}
}

func TestInvalidInputCannotReachService(t *testing.T) {
	count := 0
	service := Service[int]{Start: func(context.Context, contract.Command) int { count++; return 1 }, Input: func(context.Context, contract.Input) int { count++; return 1 }, Read: func(context.Context, contract.Read) int { count++; return 1 }}
	for _, raw := range []string{`null`, `[]`, `{} trailing`, `{"action":"exec","cmd":"x","scriptPath":"owned.ps1"}`, `{"action":"wait","session_id":1,"chars":""}`, `{"action":"wait","press_enter":false}`, `{"action":"wait","terminate":false}`, `{"action":"input","session_id":1,"cmd":"unexpected"}`, `{"action":"read","session_id":1,"offset":0,"env":{}}`, `{"action":"unknown"}`, `{"action":null}`} {
		if _, err := Execute(context.Background(), call("terminal", raw), service); err == nil {
			t.Fatal("accepted", raw)
		}
	}
	if _, err := Execute(context.Background(), call("write_stdin", `{"session_id":1,"timeout_ms":2}`), service); err == nil || !strings.Contains(err.Error(), "不要重新执行命令") {
		t.Fatal(err)
	}
	if _, err := Execute(context.Background(), call("exec_command", `{} {}`), service); err == nil {
		t.Fatal("trailing JSON")
	}
	if _, err := Execute(context.Background(), call("terminal", `{"action":"read","session_id":1}`), Service[int]{}); err == nil {
		t.Fatal("missing service")
	}
	if count != 0 {
		t.Fatal("invalid request reached process owner", count)
	}
}

func TestDefinitionSupportsPrivateEmptyOverride(t *testing.T) {
	d := Definition(nil)
	if d.Name != "terminal" || d.Description == "" {
		t.Fatal(d)
	}
	raw, _ := json.Marshal(d.Parameters)
	if strings.Contains(string(raw), "terminate") || strings.Contains(string(raw), "scriptPath") {
		t.Fatal(string(raw))
	}
	d = Definition(func(string) string { return "" })
	if d.Description != "" {
		t.Fatal("explicit empty override lost")
	}
	for _, old := range LegacyDefinitions(nil) {
		if old.Description == "" || !IsTool(old.Name) {
			t.Fatal(old)
		}
	}
}

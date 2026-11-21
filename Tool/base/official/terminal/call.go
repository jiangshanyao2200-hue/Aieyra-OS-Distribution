package terminal

import (
	"encoding/json"
	"fmt"
	"github.com/aieyra/aieyra-os/contracts/protocol"
)

func CanonicalCall(call protocol.ToolCall) (protocol.ToolCall, error) {
	if call.Function.Name != "terminal" {
		return call, nil
	}
	var args map[string]json.RawMessage
	if err := json.Unmarshal([]byte(call.Function.Arguments), &args); err != nil || args == nil {
		return call, fmt.Errorf("终端参数必须是对象")
	}
	var action string
	if json.Unmarshal(args["action"], &action) != nil {
		return call, fmt.Errorf("终端需要action")
	}
	if _, exists := args["terminate"]; exists {
		return call, fmt.Errorf("停止进程请明确使用action:stop")
	}
	delete(args, "action")
	switch action {
	case "exec":
		call.Function.Name = "exec_command"
	case "input":
		call.Function.Name = "write_stdin"
	case "read":
		call.Function.Name = "read_shell_output"
	case "wait", "stop":
		if _, exists := args["chars"]; exists {
			return call, fmt.Errorf("wait/stop不接受输入字符，请使用input")
		}
		if _, exists := args["press_enter"]; exists {
			return call, fmt.Errorf("wait/stop不接受回车输入")
		}
		call.Function.Name = "write_stdin"
		// wait 的 timeout_ms 只可能表示“等多久”，按 yield_time_ms 处理，避免模型多跑一轮纠错。
		if raw, exists := args["timeout_ms"]; exists {
			if _, has := args["yield_time_ms"]; !has {
				args["yield_time_ms"] = raw
			}
			delete(args, "timeout_ms")
		}
		if action == "stop" {
			args["terminate"] = json.RawMessage("true")
		}
	default:
		return call, fmt.Errorf("终端action只支持exec/wait/input/read/stop")
	}
	encoded, err := json.Marshal(args)
	if err != nil {
		return call, err
	}
	call.Function.Arguments = string(encoded)
	return call, nil
}

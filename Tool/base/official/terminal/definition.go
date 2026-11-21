package terminal

import (
	_ "embed"
	"github.com/aieyra/aieyra-os/contracts/protocol"
)

//go:embed manual/background.txt
var manual0 string

//go:embed manual/operation.txt
var manual1 string

//go:embed manual/purpose.txt
var manual2 string

//go:embed manual/bytes.txt
var manual3 string

//go:embed manual/budget.txt
var manual4 string

//go:embed manual/exec.txt
var manual5 string

//go:embed manual/terminal.txt
var manual6 string

//go:embed manual/input.txt
var manual7 string

//go:embed manual/read.txt
var manual8 string

func Manual(key string) string {
	switch key {
	case "Matrix/工具说明/保留常驻进程.txt":
		return manual0
	case "Matrix/工具说明/命令操作描述.txt":
		return manual1
	case "Matrix/工具说明/命令用途描述.txt":
		return manual2
	case "Matrix/工具说明/命令输入字节.txt":
		return manual3
	case "Matrix/工具说明/命令输出预算.txt":
		return manual4
	case "Matrix/工具说明/执行命令.txt":
		return manual5
	case "Matrix/工具说明/终端.txt":
		return manual6
	case "Matrix/工具说明/继续命令.txt":
		return manual7
	case "Matrix/工具说明/读取命令日志.txt":
		return manual8
	}
	return ""
}
func Definition(resolve func(string) string) protocol.ToolDefinition {
	if resolve == nil {
		resolve = Manual
	}
	properties := map[string]any{"action": protocol.SchemaEnum("exec", "wait", "input", "read", "stop")}
	for _, definition := range LegacyDefinitions(resolve) {
		for key, value := range definition.Parameters.(map[string]any)["properties"].(map[string]any) {
			properties[key] = value
		}
	}
	delete(properties, "terminate") // Stopping is explicit, never hidden in a poll.
	properties["session_id"] = map[string]any{"type": "integer", "description": "exec返回的原始session_id；wait/input/read/stop必填。"}
	properties["max_output_tokens"] = map[string]any{"type": "integer", "minimum": 1, "maximum": 32000, "description": "本次返回的输出预算；不足时用action:read及offset读取保留日志，不能重跑副作用。"}
	return protocol.ToolDefinition{Type: "function", Name: "terminal", Description: resolve("Matrix/工具说明/终端.txt"), Parameters: protocol.SchemaObject(properties, "action")}
}

func LegacyDefinitions(resolve func(string) string) []protocol.ToolDefinition {
	if resolve == nil {
		resolve = Manual
	}
	integer := func(description string) map[string]any {
		return map[string]any{"type": "integer", "description": description}
	}
	str := func(description string) map[string]any {
		return map[string]any{"type": "string", "description": description}
	}
	boolean := func(description string) map[string]any {
		return map[string]any{"type": "boolean", "description": description}
	}
	budget := integer(resolve("Matrix/工具说明/命令输出预算.txt"))
	yield := integer("Milliseconds to wait before returning, 0..30000; this is NOT a process timeout. exec_command defaults to 10000 (1000 for background/tty) and returns as soon as the process exits; write_stdin defaults to 5000. A running process returns session_id.")
	description := str(resolve("Matrix/工具说明/命令操作描述.txt"))
	return []protocol.ToolDefinition{
		{Type: "function", Name: "exec_command", Description: resolve("Matrix/工具说明/执行命令.txt"), Parameters: protocol.SchemaObject(map[string]any{
			"cmd": str("Command or multiline script in the selected shell; required."), "workdir": str("Working directory; defaults to this session's project directory. A previous command's cd does not persist."), "shell": str("Installed shell executable/path; omit to use the declared default. Shell syntax and filesystem paths must match the selected environment."), "login": boolean("Load the shell profile/login environment; default false for fast, predictable startup."), "tty": boolean("Allocate an invisible interactive terminal when needed; default false. Send subsequent input using write_stdin."), "background": boolean(resolve("Matrix/工具说明/保留常驻进程.txt")), "yield_time_ms": yield, "max_output_tokens": budget, "timeout_ms": integer("Process deadline in milliseconds; default 1800000 (30 minutes), 0 for a persistent task; maximum 604800000. Owned processes end when the chat session closes."), "description": str(resolve("Matrix/工具说明/命令用途描述.txt")), "parallel": boolean("Default true: independent calls in one response run concurrently, up to 4 at a time. Set false to wait for all preceding calls before dispatch and finish this call before dispatching following calls. For dependencies on command completion, use an adequate yield and check the result in the next response; a running result is not completion."), "env": map[string]any{"type": "object", "additionalProperties": protocol.SchemaString(), "description": "Environment overrides for this execution only."},
		}, "cmd")},
		{Type: "function", Name: "write_stdin", Description: resolve("Matrix/工具说明/继续命令.txt"), Parameters: protocol.SchemaObject(map[string]any{"description": description, "session_id": integer("Exact session_id returned by exec_command."), "press_enter": boolean("Explicitly press Enter (0x0D) after chars. Only for tty=true sessions. Default false; chars is never unescaped or rewritten. Example: chars=hello, press_enter=true. Omit chars to submit an existing line."), "chars": str(resolve("Matrix/工具说明/命令输入字节.txt")), "yield_time_ms": yield, "max_output_tokens": budget, "terminate": boolean("Stop this owned process tree; default false.")}, "session_id")},
		{Type: "function", Name: "read_shell_output", Description: resolve("Matrix/工具说明/读取命令日志.txt"), Parameters: protocol.SchemaObject(map[string]any{"description": description, "session_id": integer("Execution session_id, including completed executions."), "offset": integer("Byte offset in the saved log, default 0."), "max_output_tokens": budget}, "session_id")},
	}
}

func IsTool(name string) bool {
	return name == "terminal" || name == "exec_command" || name == "write_stdin" || name == "read_shell_output"
}

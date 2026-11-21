package terminal

import (
	"context"
	"fmt"
	"github.com/aieyra/aieyra-os/contracts/protocol"
	"github.com/aieyra/aieyra-os/tool/base/official/terminal/contract"
)

// Service binds to the host's authorized process and log owner. R is the host's
// receipt type, preserved without serializing or discarding its extra fields.
// The view receives read capabilities separately and cannot invoke this service.
type Service[R any] struct {
	Start func(context.Context, contract.Command) R
	Input func(context.Context, contract.Input) R
	Read  func(context.Context, contract.Read) R
}

func Execute[R any](ctx context.Context, call protocol.ToolCall, service Service[R]) (R, error) {
	var zero R
	call, err := CanonicalCall(call)
	if err != nil {
		return zero, err
	}
	switch call.Function.Name {
	case "exec_command":
		var req contract.Command
		if err = DecodeArguments(call.Function.Arguments, &req); err != nil {
			return zero, err
		}
		if service.Start != nil {
			return service.Start(ctx, req), nil
		}
	case "write_stdin":
		var req contract.Input
		if err = DecodeArguments(call.Function.Arguments, &req); err != nil {
			return zero, err
		}
		if service.Input != nil {
			return service.Input(ctx, req), nil
		}
	case "read_shell_output":
		var req contract.Read
		if err = DecodeArguments(call.Function.Arguments, &req); err != nil {
			return zero, err
		}
		if service.Read != nil {
			return service.Read(ctx, req), nil
		}
	default:
		return zero, fmt.Errorf("未注册的 Shell 工具")
	}
	return zero, fmt.Errorf("终端服务不可用")
}

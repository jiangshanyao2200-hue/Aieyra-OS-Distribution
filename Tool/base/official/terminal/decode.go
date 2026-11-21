package terminal

import (
	"encoding/json"
	"fmt"
	"github.com/aieyra/aieyra-os/tool/base/official/terminal/contract"
	"io"
	"strings"
)

func DecodeArguments(data string, out any) error {
	d := json.NewDecoder(strings.NewReader(data))
	d.DisallowUnknownFields()
	if strings.TrimSpace(data) == "null" {
		return fmt.Errorf("参数必须是 JSON 对象")
	}
	if err := d.Decode(out); err != nil {
		if _, input := out.(*contract.Input); input && err.Error() == `json: unknown field "timeout_ms"` {
			return fmt.Errorf("Shell 参数无效：%w。write_stdin 等待已有进程请改用 yield_time_ms（0–30000 毫秒）；timeout_ms 仅用于 exec_command 启动时设置进程期限。本次未发送输入或停止进程，请保留 session_id 修正参数继续等待，不要重新执行命令", err)
		}
		return fmt.Errorf("Shell 参数无效：%w", err)
	}
	if err := d.Decode(new(any)); err != io.EOF {
		return fmt.Errorf("Shell 参数只能有一个 JSON 对象")
	}
	return nil
}

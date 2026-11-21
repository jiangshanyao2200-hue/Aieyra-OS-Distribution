# CLI 客户端

现有实现由 `Core/host/cli`、`Core/ui/terminal`、`Core/ui/mdrender` 迁入 `host`、`terminal`、`mdrender`，原实现已移除。`Aieyra CLI` 和桌面兼容命令均调用这里，不维护两份终端逻辑。

`host` 使用同一 Core 的任务、设置、会话、包服务与模型worker；`terminal` 仅消费公共终端协议。Windows/Linux/Android 依赖与构建兼容分别检查，Android命令行支持不等于手机App已实现。

正式发行的CLI开放状态仍由 `Config/运行参数.json` 决定。迁移不改变该开关，不新建私人配置，不重置现有会话。原生终端与真实模型验收沿用既有有界场景；普通单测只使用隔离配置和合成供应商。

`context`、`contacts`、`workflows` 和 `agents` 用 `--discovery FILE` 连接已运行的同一Core，从标准输入读取一个JSON对象，向标准输出返回完整JSON回执。`context`选择桌面主Core，复用其会话与记忆服务；独立CLI的普通旧会话入口仍保持退役。上下文变更先view取得source；联系人发送带request_id和generation；工作流使用完整package身份、owner及command的expected_revision，不复制调度或自动重发。

例如先执行 `Aieyra OS.exe cli context --discovery FILE`，输入 `{"action":"view"}`；再以返回source执行new/switch/edit/restore等操作。`contacts`输入 `{"action":"contacts"}`列出身份，`workflows`输入 `{"action":"list","package":"mod:包ID@摘要"}`读取已安装启用的工作流。各命令的 `--help`说明操作和边界。发现文件来自目标Core的discovery字段，位置按Contracts/storage的matrix_api分区解析；只选择自己的私有文件，不复制其中token到命令行或文档。

命令退出不关闭宿主；断线只查询原请求或状态。域服务返回ok=false时仍输出完整回执并返回非零退出码，使逐项清理失败可审查和接续。管理输入有界，拒绝目录/链接/公开权限的发现文件、非回环地址、多个JSON或非对象命令。整理上下文、发送和运行工作流可能调用模型/工具；view/list只读不会主动触发模型。

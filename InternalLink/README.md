# Aieyra OS 内部 Link

这里是独立 Go 模块，负责 OS 内部协作的邮箱协议。可单独执行 `go build ./...`。运行身份、事务、权限和消息投递仍由 OS Core 持有，接入位于 `Core/conversation_link.go` 和 `Core/workspace_core_link.go`。

已有会话继续沿确定性邮箱 ID、请求 ID 和原代次读取。后续独立开发从本目录开始，演进协议时先明确旧记录迁移以及重新接入 OS 的方式。

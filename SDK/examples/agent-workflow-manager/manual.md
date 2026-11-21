# 工作流专员

由 Workbox 显式创建空闲实例，再通过 Agent 管理入口发送任务。单独从模板创建不授予工作流权限。

打开 software_api 后调用 `{"action":"workflow","operation":"status","arguments":{}}` 查看绑定实例。run/pause/resume/cancel/recover 的 arguments 必须包含最新 expected_revision 和稳定 request_id；不需要指定工作流ID。重复请求返回同一回执。审阅由用户或主管完成。

模型连接、私人覆盖、历史和工作流绑定都属于本地实例，不在这个公开包中。

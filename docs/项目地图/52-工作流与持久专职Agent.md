# 工作流与持久专职 Agent

工作流复用共同工具、持久回执和AgentManager；步骤、审阅、取消与恢复分别验证。

| 职责 | 实际模块与消费者 |
| --- | --- |
| 声明、输入绑定、步骤与恢复状态 | Tool/workbox；Core装配现有工具执行器，不引入另一套调度器 |
| 兼容、手册、授权与依赖版本 | Core/modules、extensionhost/workbox；包身份锁定完整摘要 |
| 私人实例与原子回执 | Core/workbox_store、workbox_runner；Contracts/storage的workflows目录 |
| 稳定所有者与专职Agent | Core/workbox_host、workbox_service复用AgentManager；按需持有系统租约 |
| 完成通知和任务监督 | 现有Agent记录中的持久outbox、Workspace收件箱、共同任务列表与档案 |
| 图片执行与用量 | 既有图片批次；工作流保存调用身份、未知样本及真实响应，不依赖父任务当前代次 |
| Desktop/CLI呈现 | Tool/workbox/presentation；Client/Desktop/ui/workboxes原生面板与既有CLI回执入口 |
| 作者样板 | SDK/examples/workbox-statistics、workbox-images，共同打包器及导入流程 |
| 标准专员包组合 | `Core/agent_package_workflow.go`、SDK的agent-workflow-manager/workbox-specialist；创建空闲实例、持久反向链接、工作流专用端口与同一实例管理 |

工作流依序执行声明的依赖步骤；每次变更检查request_id和revision。审阅后才能继续，专职Agent不能批准自己的审阅点。暂停停在步骤边界，取消传播到实际执行；recover只检查已有工具日志或图片回执，不重发未知副作用。包更新或停用阻断新的步骤，不改绑已保存的定义和依赖。

主OS/CLI窗口身份是临时的，工作流使用私人根内的稳定服务身份。服务仅在工作流操作或恢复已有专职Agent时获取租约，普通窗口不提前占用；其他Core进程已持有时明确返回忙。重开恢复同一实例、任务档案和保留型Agent，不自动运行。一次性和保留型专职Agent均通过显式create_agent创建，不自动成为默认角色或联系人。

完成通知按真实代次保存并确认收件箱处理。崩溃前未确认的通知可能以同一message ID再投递，不宣称跨进程绝对一次送达，也不意味着重放工具。主角色取消可停止后台工作流，包括父任务已完成且没有shell的情况。

列表返回分页摘要；面板只轮询当前活动实例，隐藏时停止。未变revision保持步骤节点，变更时恢复展开与读位；创建后表单收起，正文滚动而审阅/关闭固定在底部。完整步骤回执与产物JSON仍可查看。


标准Agent包组合现已有真实消费者，不再列为尚未实现；专员端口绑定工作流和所有者，不能跨工作流操作或自行审阅。公开模板导出只含原始包，不带实例模型/提示词/团队/历史。标准包详情见[地图47](47-Agent定义与执行契约.md)，工作协约见[工程地图](../工程地图.md)。Session、Desktop/CLI共同管理、真实供应商和各平台需要独立验收。

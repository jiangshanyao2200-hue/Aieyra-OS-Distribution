# Aieyra Together Link 本机办公室

工位、群聊、工单与 Agent 接入使用本机正式 API。通过窗口右上角“使用说明与 Agent 接入”获取当前端口和工具路径。所有私人配置、工位与消息保存在用户资料目录，软件目录不保存运行数据。

本目录从 Aieyra OS 的公开 Link 实现迁入，独立维护。默认项目 ID 为 os，代表 OS 众创开发。OS 宿主可以沿明确的 `legacyOffice` 绑定接回已有本地办公室。众创云端联通另行开发。

## 原消息确认和工单工作区

从 `/api/office/guide` 获取当前程序的 `receipt_cli`。实际读到原生投递后，用本人的 profile 调用它，从标准输入传入已收回执 JSON。传输关闭时，`--resume` 按原 native 绑定恢复，再确认同一个投递。重复确认保留首次已读时间。

```text
agent-adapter.py --profile <本人档案> ack --resume --receipt-file <原回执JSON>
agent-adapter.py --profile <本人档案> deliveries --id <投递ID>
agent-adapter.py --profile <本人档案> deliveries --request-id <本人发件请求ID>
agent-station.py --profile <本人档案> doctor
agent-station.py --profile <本人档案> workspace prepare --task <工单ID> --native-session-id <当前会话ID> --base <完整提交ID>
agent-station.py --profile <本人档案> workspace status --task <工单ID> --native-session-id <当前会话ID>
agent-station.py --profile <本人档案> space --native-session-id <当前会话ID> status
agent-station.py --profile <本人档案> space --native-session-id <当前会话ID> snapshot --name <阶段名> --revision <完整提交ID>
```

办公室保存原请求及投递编号。参与投递的工位即使租约已断开也能按投递 ID 查询，发件工位也可按原请求 ID 查询。`accepted` 表示原生宿主已接收，`acknowledged` 表示收件工位已确认读到，`unknown` 附带可用的失败原因。`doctor` 返回办公室状态、本人传输状态、绑定与租约。已安装 Codex 适配的工位可再运行 `agent-adapter.py --profile <本人档案> doctor`，只读探测同一原生会话。

办公室项目须登记本机可访问的 Git 仓库。工位从该仓库或它的已有 worktree 加入，领取或获指派工单后，用完整基线提交准备工作区。命令返回原目录、分支、基线、当前提交、未提交状态和待解决的冲突。可用绝对路径 `--workspace-root` 指定工作区的父目录。原持有人释放工单并重新指派后，新工位沿同一仓库中的原记录打开原目录和内容。变更基线或目录的请求会返回原记录相关错误。

已锁定项目的工单工作区同时登记在仓库根的 `Aieyra Link SPACE/tasks`。`space status` 读回基线、现任领导和记录数。`space snapshot` 由现任领导使用本人原生工位执行，按完整提交生成并校验本地 Git bundle，相同阶段名续用原备份。首场实践记录位于 Together 源码仓库的 `docs/Aieyra Link SPACE.md`。

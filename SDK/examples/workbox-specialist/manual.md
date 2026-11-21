# 专员统计工作流

先安装并启用 tool-statistics、toolbox-report、agent-workflow-manager，再导入本包。创建工作流后可显式创建一个标准专职Agent，选择模型连接并发送任务；创建本身不请求模型。专员在审阅点停止，由用户确认后才能继续。

# 统计与报告工作流

先统计输入，审阅后生成实际 JSON 报告。

先用 create 保存 input、绝对 workdir 和稳定 request_id。run 会执行到检查点，status 提供最新 revision、逐步回执和产物。人工确认后 approve 对应 step，再 resume。pause 在步骤边界暂停；cancel 保留既有结果。所有变更需要 expected_revision 与 request_id；重发同一命令不重复执行。

进程中断先 recover，只查询已有执行/图片回执并恢复本地响应，不再次提交未知副作用。依赖变更后新步骤被阻止，已有产物继续可查。工具箱手册附有全部命令约定。

create_agent 是显式操作，传入已配置 model_id；助手由创建者管理，继承有限权限、独立输入与预算。任务结束保留回执，不自动新增联系人。

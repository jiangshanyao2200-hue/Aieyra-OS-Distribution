# 中心

遵循根协约及 Program/official/AGENTS.md。中心保留包 ID `aieyra.center`，汇总 Core 的全局内部工位、程序 Agent、内外 Link、浏览器、完整性与受管更新，专属 Agent 为 Nova。健康查询使用同一个只读投影供桌面和软件 API 消费，数据不可用记为未知。Agent 工位优先采用全局投影的实际实例和代次。

service.cjs 只包装宿主注入的 settings-updates/managed-updates，不能另建更新状态机。更新替换、签名、冲突、空闲交接与健康回执仍由共同更新服务负责。页面隐藏时停止轮询，关闭不停止已经受理的更新。普通页面只开放现有窄接口，不开放 prepare/verify/handoff。

修改载荷提升版本并刷新 manifest；必要测试、四产物构建后核实际内嵌/拆放、Agent委派、隐藏恢复、窄窗与重开。保留私人资料，不发布生产更新。

系统诊断与 Eyra 执行反馈由 issue-reports.cjs 绑定当前 NEW API 账号。系统只提交版本与固定类别，附带说明经过宿主预览确认。重试沿用原编号，公开回执归原账号。中枢页面的自动提报开关同时撤回尚未发送的自动条目。

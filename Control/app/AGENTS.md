# Control 当前产品 · 工作协约

遵循[根协约](../../AGENTS.md)；当前职责与迁移边界见[工程地图](../../docs/工程地图.md)。本文件覆盖本目录中没有更近协约的自有子目录，测试、样例资产和第三方依赖不因此成为独立执行模块。

入口：[main.py](service/main.py)、[agent-station.py](scripts/agent-station.py)、`README.md`（当前工作树未提供：`README.md`）、`AGENT_ADAPTERS.md`（当前工作树未提供：`docs/AGENT_ADAPTERS.md`）。

职责：service处理本机API、身份/工位/投递/项目记忆；web提供简洁观察和圆形群聊入口；scripts为正式Agent/发布工具；desktop/mobile/cloud各有独立协约。

依赖与接口：OS/独立Link沿同一Control主体装配，通信、任务执行与原生接收分别核验。遵循根协约：已取消guard/claim/候选/晋升，不从旧文档恢复。

资料与状态：沿自己的真实native/actor/profile恢复，保留本机现存办公室；项目五段记忆共享，fresh CAS保全伙伴内容，不直接开真实SQLite或打印凭据。

开发与验收：先看scripts/check-quality.py实际检查项，选择tests/service、unit、desktop-notifications、web对应检查；Python用-B，GUI/构建串行，不强杀用户程序。

兼容与交接：未知投递查原请求、queued不当实读，finish不代写记忆或完成任务；公开分享/反馈仅按用户授权，不因协约自动发布或通知旧领导。 修改接口时一起核对调用者、交付清单和对应专题地图；未实际验证的范围保持未验，不以目录存在或安装成功代替运行验收。

2026-11-07：日常协作优先明确mentions与reply_to直接交流；工单可选，只记录目标、范围和结果。创建/改派不注入原生消息，显式task-delegate单独执行并查原回执。不得把历史工单流程扩成所有协作的前置步骤。

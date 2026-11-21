# Control API 与协同状态 · 工作协约

遵循[根协约](../../../AGENTS.md)；当前职责与迁移边界见[工程地图](../../../docs/工程地图.md)。本文件覆盖本目录中没有更近协约的自有子目录，测试、样例资产和第三方依赖不因此成为独立执行模块。

入口：[main.py](main.py)、[agent_access.py](agent_access.py)、[agent_protocol.py](agent_protocol.py)、[office_extensions.py](office_extensions.py)。

职责：main路由，agent_access/protocol管正式Agent边界，office_extensions管原生接收/回执；coordination_core是有UPSTREAM记录的本地协同内核，product_bridge连接受控产品任务。

依赖与接口：用户/Agent身份与权限在服务端检查，不由网页或CLI自报；OS经受控接口连接，云端与本机状态不可混当同一投递证据。

资料与状态：所有数据库/私有状态在配置的资料根，不直接读取真实库调试；项目记忆用版本CAS，读消息不隐式ACK。

开发与验收：Python-B运行对应tests/service测试；协议改动同步OpenAPI和agent-client/station，覆盖撤销、租约、native绑定、幂等/未知结果及分页epoch。

兼容与交接：保留原schema/请求账，先查询未知写入不换ID重发；上游改编要维护UPSTREAM来源，不另建远程服务分叉。 修改接口时一起核对调用者、交付清单和对应专题地图；未实际验证的范围保持未验，不以目录存在或安装成功代替运行验收。

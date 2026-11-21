# Control 正式工具入口 · 工作协约

遵循[根协约](../../../AGENTS.md)；当前职责与迁移边界见[工程地图](../../../docs/工程地图.md)。本文件覆盖本目录中没有更近协约的自有子目录，测试、样例资产和第三方依赖不因此成为独立执行模块。

入口：[agent-client.py](agent-client.py)、[agent-station.py](agent-station.py)、[control.py](control.py)、`check-quality.py`（当前工作树未提供：`check-quality.py`）。

职责：提供Agent create/join/work/finish、正式API客户端、Control生命周期与检查/构建/导出工具；工具不替代服务端权限。

依赖与接口：协议以service及docs/AGENT_ADAPTERS为准，先看实际--help；profile/凭据属于本人，不借用伙伴配置。

资料与状态：create只在首次用稳定档案，成功后join恢复；未知请求先查原账；finish之前fresh读/保全五段共享记忆再CAS读回。

开发与验收：Python-B；对改动脚本运行tests/service中的client/station/lifecycle对应回归，构建/签名/导出按实际帮助并保留回执。

兼容与交接：后台续租有界且仅通信，不启动模型或重放工单；不得自动通知旧领导或代用户发送公开消息。 修改接口时一起核对调用者、交付清单和对应专题地图；未实际验证的范围保持未验，不以目录存在或安装成功代替运行验收。

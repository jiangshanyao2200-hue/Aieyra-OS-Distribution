# 光圈图形动画契约 · 工作协约

遵循[根协约](../../AGENTS.md)；当前职责与迁移边界见[工程地图](../../docs/工程地图.md)。本文件覆盖本目录中没有更近协约的自有子目录，测试、样例资产和第三方依赖不因此成为独立执行模块。

入口：[definition.go](definition.go)、[definition.mjs](definition.mjs)、[cases.json](cases.json)、[halo.schema.json](../../Contracts/halo.schema.json)。

职责：Go 与 JS 同时验证图层、状态筛选、0–100坐标及严格递增的关键帧；公共 cases 校对两端。

依赖与接口：Core 准入、Halo/runtime 和 SDK 样板消费同一契约，不依赖 DOM 或用户配置。

资料与状态：仅声明式图形和有界周期，不带外部 URL、私有身份和可执行内容。

开发与验收：在 Halo 运行 go test ./contract 与 go vet ./contract，Desktop 自测对照 cases；边界包括层/点数、非法状态与周期。

兼容与交接：新增形状或动画字段先更新能力/Schema/样板及旧宿主拒绝，不扩大白名单绕过准入。 修改接口时一起核对调用者、交付清单和对应专题地图；未实际验证的范围保持未验，不以目录存在或安装成功代替运行验收。

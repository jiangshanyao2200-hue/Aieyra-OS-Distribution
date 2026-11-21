# 上下文提供者身份 · 工作协约

遵循[根协约](../../AGENTS.md)；当前职责与迁移边界见[工程地图](../../docs/工程地图.md)。本文件覆盖本目录中没有更近协约的自有子目录，测试、样例资产和第三方依赖不因此成为独立执行模块。

入口：[provider.go](provider.go)、[context-policy.schema.json](../context-policy.schema.json)。

职责：规定 provider 的版本身份、状态 schema 和可序列化命名空间，供档案、Agent 包与 Context 共同引用。

依赖与接口：执行接口位于 Agent/context/contract；持久迁移和模型调用由 Core 承担，不把宿主句柄放进契约。

资料与状态：只传授权后的数据与精确版本；公共定义不含原始会话、私有命名空间或 Key。

开发与验收：在 Contracts 运行 go test ./context；接口变化需 Agent 两种内置策略、声明式包和 Core 切换/恢复测试。

兼容与交接：未知 schema/版本拒绝；包升级不得自动迁移已有实例或静默切回另一策略。 修改接口时一起核对调用者、交付清单和对应专题地图；未实际验证的范围保持未验，不以目录存在或安装成功代替运行验收。

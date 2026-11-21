# 上下文预算与策略 · 工作协约

遵循[根协约](../../AGENTS.md)；当前职责与迁移边界见[工程地图](../../docs/工程地图.md)。本文件覆盖本目录中没有更近协约的自有子目录，测试、样例资产和第三方依赖不因此成为独立执行模块。

入口：[budget.go](budget.go)、[provider.go](contract/provider.go)、[policy.go](history/policy.go)、[summary.go](summary/summary.go)。

职责：budget 管余量/校准；history 管完整轮次、工具配对及近期100条原文/回查；summary 管严格摘要候选；structured 是独立内置策略，packaged 在同引擎上应用声明式策略；Eyra PAC 在 official/Eyra/context。

依赖与接口：策略经 contract.Provider 接收已授权内存视图和模型函数，不取得数据库、配置路径或 Key。Core 决定空闲/CAS切换、压缩提交及故障恢复。

资料与状态：状态按 Contracts/context 身份和命名空间保存；原文、纠正与工具回执保留来源，取消/坏摘要不得提交检查点。

开发与验收：在 Agent 运行 go test ./context/...；涉及持久化须验证 Core/context_provider 和 context_package 的拒绝/恢复路径，长原文与多次压缩不能只用短样例替代。

兼容与交接：新增引擎必须保留公共原文与档案兼容；声明式包不能执行作者脚本或接入任意外部存储，包不可用时明确拒绝新执行但保留档案阅读。 修改接口时一起核对调用者、交付清单和对应专题地图；未实际验证的范围保持未验，不以目录存在或安装成功代替运行验收。

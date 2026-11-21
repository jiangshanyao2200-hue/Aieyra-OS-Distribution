# 官方经典光圈 · 工作协约

遵循[根协约](../../AGENTS.md)；当前职责与迁移边界见[工程地图](../../docs/工程地图.md)。本文件覆盖本目录中没有更近协约的自有子目录，测试、样例资产和第三方依赖不因此成为独立执行模块。

入口：[package.go](package.go)、[manifest.json](classic/manifest.json)、[halo.json](classic/halo.json)、[instrument.mjs](instrument.mjs)。

职责：classic 是共同 Mod 包；instrument/effects/pulsar-burst 及样式提供原版头像、状态、切页特效。本协约覆盖 classic 的全部载荷。

依赖与接口：Core/extensionhost 读取编译进宿主的清单摘要识别官方，外部名字或路径不能冒充；runtime 负责共同生命周期。

资料与状态：不向 classic 目录添加 AGENTS、测试产物或其他未声明载荷；改官方包需更新 manifest 和编译来源兼容。

开发与验收：在 Halo 运行 go test ./...，并通过 Desktop 自测及实际经典/自定义对照场景；要观察动画而非只看初始帧。

兼容与交接：保留旧官方摘要的回退策略、默认布局及用户角色状态；导入仍需启用和应用，不自动替换当前选择。 修改接口时一起核对调用者、交付清单和对应专题地图；未实际验证的范围保持未验，不以目录存在或安装成功代替运行验收。

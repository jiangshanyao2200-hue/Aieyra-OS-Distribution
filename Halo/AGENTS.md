# 独立光圈与动画 · 工作协约

遵循[根协约](../AGENTS.md)；当前职责与迁移边界见[工程地图](../docs/工程地图.md)。本文件覆盖本目录中没有更近协约的自有子目录，测试、样例资产和第三方依赖不因此成为独立执行模块。

入口：[definition.go](contract/definition.go)、[desktop.mjs](runtime/desktop.mjs)、[package.go](official/package.go)、[README.md](README.md)。

职责：独立拥有光圈图形、工作状态动画、形态切换和配置；Theme 管页面，Agent 管身份，Desktop 只提供几何与共同 motion。

依赖与接口：通过共同 Mod/halo契约准入与 SDK 模板接入，主/团队/历史/设置和原生浮窗共用投影；自定义图形不叠加经典外环粒子。

资料与状态：选择用精确包摘要保存，停用/损坏回默认但保留原选择；不能修改角色姓名、头像、模型或用户关闭状态。

开发与验收：在本目录所属 Go 模块根串行执行 GOMAXPROCS=1 GOFLAGS=-p=1 go test ./... 与 go vet ./...，并检查 gofmt；跨宿主变更再执行 scripts/check-modules.py。修改后在 Client/Desktop 执行 npm run -s syntax 和 npm run -s selftest；界面变更按 docs/UI协约.md 选择受影响 AIDEBUG 场景，在源码冻结期间实看原生图。 状态、隐藏暂停、减少动效、切页动画及原生窗口释放需实际观察，不以静态图判定动画完成。

兼容与交接：halo ^1.0.0 只声明式图层/关键帧，无脚本/HTML/CSS/任意SVG或网络；旧宿主明确不兼容。 修改接口时一起核对调用者、交付清单和对应专题地图；未实际验证的范围保持未验，不以目录存在或安装成功代替运行验收。

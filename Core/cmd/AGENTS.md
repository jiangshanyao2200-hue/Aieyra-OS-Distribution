# 进程入口装配 · 工作协约

遵循[根协约](../../AGENTS.md)；当前职责与迁移边界见[工程地图](../../docs/工程地图.md)。本文件覆盖本目录中没有更近协约的自有子目录，测试、样例资产和第三方依赖不因此成为独立执行模块。

入口：[main.go](aieyra-os/main.go)、[main.go](aieyra-cli/main.go)、[main.go](aieyra-link/main.go)、[main.go](aieyra-module/main.go)。

职责：aieyra-os 装配 OS/显式 CLI；aieyra-cli 转交 Client/CLI；aieyra-link 与 aieyra-module 装配独立模块。配置、控制台和平台入口保留各自旗标和资源。

依赖与接口：调用 Core/host、Client 和平台接口；只做进程装配，不在 main 中复制模型请求、会话与工具规则。

资料与状态：启动参数固定本进程配置所有者；不以进程当前目录猜私人资料根。图标、syso、rc 属构建资源。

开发与验收：在 Core 对改动入口运行对应 go test/go vet；平台入口通过主工程构建验证，不能用其他平台的编译结果替代 Windows 实启。

兼容与交接：保留原启动方式、退出码、阶段开关与独立 Link 所有权；不得自动重启用户 GUI。 修改接口时一起核对调用者、交付清单和对应专题地图；未实际验证的范围保持未验，不以目录存在或安装成功代替运行验收。

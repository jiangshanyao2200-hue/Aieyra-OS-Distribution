# 工具定义与呈现契约 · 工作协约

遵循[根协约](../../AGENTS.md)；当前职责与迁移边界见[工程地图](../../docs/工程地图.md)。本文件覆盖本目录中没有更近协约的自有子目录，测试、样例资产和第三方依赖不因此成为独立执行模块。

入口：[schema.go](schema.go)、[custom.go](custom.go)、[package.go](package.go)、[packages.md](packages.md)。

职责：统一输入schema、自建工具版本、动态 tool/toolbox 的执行/手册/桌面与CLI呈现定义；不按名称猜类型。

依赖与接口：Core注册器/执行器和 Tool/runtime/presentation 共同消费，包解码不授予实际文件或进程权限。

资料与状态：完整回执保留原字段和未知状态，包身份锁 id 与完整摘要；手册不能含私人配置或凭据。

开发与验收：在 Tool 运行 go test ./contract、go vet ./contract；schema/renderer新增检查 SDK 样板及两端缺能力拒绝。

兼容与交接：合法旧工具 ID 保持，缺实现/手册/视图均明确不兼容；运行时权限仍取当前调用授权。 修改接口时一起核对调用者、交付清单和对应专题地图；未实际验证的范围保持未验，不以目录存在或安装成功代替运行验收。

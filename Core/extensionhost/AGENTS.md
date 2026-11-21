# Mod 宿主装配 · 工作协约

遵循[根协约](../../AGENTS.md)；当前职责与迁移边界见[工程地图](../../docs/工程地图.md)。本文件覆盖本目录中没有更近协约的自有子目录，测试、样例资产和第三方依赖不因此成为独立执行模块。

入口：[desktop.go](desktop.go)、[official.go](official.go)、[workbox.go](workbox.go)。

职责：将各类型契约、能力、依赖与官方来源接入共同 modules 注册器；这里装配 Desktop 支持范围，不把 JSON Schema 当最终执行校验。

依赖与接口：依赖各模块的 contract 和 Core/modules；声明 Desktop/CLI/Mobile 的实际能力，未知类型或版本明确不兼容。

资料与状态：只读宿主编译的官方摘要，外部路径、名字和自报 official 均不授予官方身份；私人实例与凭据不入包。

OfficialPackages 从 Halo、Agent、Program 与 Tool 所有者读取原始公开载荷，每次返回独立副本；宿主交给 modules.DefaultPackages 一次登记，现有用户状态优先。HostManagedDefaults 包含随宿主耦合的原生 Program 和 Tool 官方目录中的原生工具，允许更高版本同步，保留启停、卸载和授权；Agent 及其余默认包不自动更新。显式导入仍不自动启用。固定桌面角色和标准实例必须经共同登记准入，不能靠编译内置身份绕过停用；升级时应保留仍支持的旧摘要以支持原绑定与回退。

开发与验收：在 Core 执行 go test ./extensionhost 与 go vet ./extensionhost；改变准入需验证拒绝路径、SDK 对应样板和共同登记消费者。

兼容与交接：保留支持的旧摘要及回退能力；安装、启用、应用和实例创建是不同操作，不自动代办。 修改接口时一起核对调用者、交付清单和对应专题地图；未实际验证的范围保持未验，不以目录存在或安装成功代替运行验收。

浏览器、服务器、Link和Workspace使用各自manifest/program.json作为包与导航来源，Core编译实际业务载荷摘要，默认登记保留用户停用/卸载；Program/runtime/native.cjs只调用宿主注入的适配器。每次新操作共同resolve并核对安装包和正在执行的Program源码，停用释放页面、浏览标签或SSH连接，私人资料保留。native声明只适用于宿主认可的精确官方版本，第三方仍走沙箱，不凭字段获得宿主权限。
本协约说明职责，不能代替实际验收结果。

Tool原生契约为1.1，native入口仅接受编译认可的整包摘要；不得把Go源码当JS执行。六项工具的共同登记和旧工具ID准入由Core/tool_official.go连接，始终保留角色权限检查及已受理调用原回执。

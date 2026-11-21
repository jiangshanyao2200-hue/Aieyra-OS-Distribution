# 现有命令行客户端 · 工作协约

遵循[根协约](../../AGENTS.md)；当前职责与迁移边界见[工程地图](../../docs/工程地图.md)。本文件覆盖本目录中没有更近协约的自有子目录，测试、样例资产和第三方依赖不因此成为独立执行模块。

入口：[README.md](README.md)、[cli.go](host/cli.go)、[remote_service.go](host/remote_service.go)、[display.go](terminal/display.go)、[markdown.go](mdrender/markdown.go)。

职责：host 装配命令/Workspace/包/Agent RPC；terminal 管输入与状态，mdrender 管终端文本布局。terminal/mdrender 不导入执行宿主或工具执行器。

依赖与接口：调用共同 Core 和 Contracts/protocol，工具文本展示来自 Tool/presentation 或各工具 presentation/text。

资料与状态：host/internal 及交互状态只服务终端；用户档案仍归共同资料根，退出 CLI 不擅自取消运行中宿主任务。

开发与验收：在 Client 运行 go test ./CLI/...、go vet ./CLI/...；交互更改验证 Unicode/换行/取消/确认与退出码，不能只测 JSON RPC。

兼容与交接：Core/cmd/aieyra-cli 等旧入口转交此处，旧启动旗标和工具回执完整性保持。 修改接口时一起核对调用者、交付清单和对应专题地图；未实际验证的范围保持未验，不以目录存在或安装成功代替运行验收。

跨端管理共用remote_service的私有发现/单次请求/完整回执；context、contacts、workflows与agents只转交固定共同RPC。不能为CLI新建另一份会话目录，不能把HTTP成功当成领域ok=false成功，不能在失去响应时自动重发写操作。新增命令覆盖与实际桌面共用状态、冲突拒绝和完整重开；实际跨端与单元测试分别记录。

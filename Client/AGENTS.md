# 多客户端边界 · 工作协约

遵循[根协约](../AGENTS.md)；当前职责与迁移边界见[工程地图](../docs/工程地图.md)。本文件覆盖本目录中没有更近协约的自有子目录，测试、样例资产和第三方依赖不因此成为独立执行模块。

入口：[README.md](README.md)、[cli.go](CLI/host/cli.go)、[README.md](Desktop/README.md)、[README.md](Mobile/README.md)。

职责：CLI 为实际实现；Desktop 为实际实现，根 Desktop 为冻结兼容运行文件；Mobile 只保留未来 App 契约，没有 OS 手机 App 运行时。

依赖与接口：客户端输入送共同 Core，消费 Contracts 事件/回执。Client 可以依赖 Core，Core 根包不得反向导入 Client。

资料与状态：所有客户端共享授权任务、会话和资料路径；网络重连先补事件/查原请求，不另启任务执行器。

开发与验收：在本目录所属 Go 模块根串行执行 GOMAXPROCS=1 GOFLAGS=-p=1 go test ./... 与 go vet ./...，并检查 gofmt；跨宿主变更再执行 scripts/check-modules.py。 CLI 跨平台依赖用 check-modules；Android CLI 可编译不代表 Mobile App 或触控验收通过。

兼容与交接：独立 CLI 继续服从 release_stage，显式 OS CLI 不用于偷开隐藏入口；未迁移与未实现范围明确标出。 修改接口时一起核对调用者、交付清单和对应专题地图；未实际验证的范围保持未验，不以目录存在或安装成功代替运行验收。

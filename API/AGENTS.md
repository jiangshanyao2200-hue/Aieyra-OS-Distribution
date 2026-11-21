# 模型协议模块 · 工作协约

遵循[根协约](../AGENTS.md)；当前职责与迁移边界见[工程地图](../docs/工程地图.md)。本文件覆盖本目录中没有更近协约的自有子目录，测试、样例资产和第三方依赖不因此成为独立执行模块。

入口：[client.go](transport/client.go)、[responses.go](request/responses.go)、[responses.go](codec/responses.go)、[README.md](README.md)。

职责：transport 管连接，request 管四协议编码，codec 管流式/原生解码，parameters/catalog 管规则和能力；images/search/adapter 各按下层协约独立。

依赖与接口：只依赖 Contracts 和自身包；Core 注入连接快照、取消上下文与读好的附件，API 不导入 Core/桌面或读取私人配置。

资料与状态：请求间深拷贝参数/原生消息；真实 usage、未知缓存和明确零值保留区别。诊断默认关闭，正文跟踪由调用者选目录，不记录请求头。

开发与验收：在本目录所属 Go 模块根串行执行 GOMAXPROCS=1 GOFLAGS=-p=1 go test ./... 与 go vet ./...，并检查 gofmt；跨宿主变更再执行 scripts/check-modules.py。 真实供应商验收需要单独的有界调用记录；本机夹具不构成供应商认证。

兼容与交接：新增声明式路径/头/默认参数不等于新增 wire codec；未知付费或工具副作用不能自动重试。 修改接口时一起核对调用者、交付清单和对应专题地图；未实际验证的范围保持未验，不以目录存在或安装成功代替运行验收。

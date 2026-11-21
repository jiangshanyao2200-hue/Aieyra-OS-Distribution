# 跨模块契约 · 工作协约

遵循[根协约](../AGENTS.md)；当前职责与迁移边界见[工程地图](../docs/工程地图.md)。本文件覆盖本目录中没有更近协约的自有子目录，测试、样例资产和第三方依赖不因此成为独立执行模块。

入口：[mod.schema.json](mod.schema.json)、[product-layout.json](product-layout.json)、[development-documents.json](development-documents.json)、[layout.go](layout.go)。

职责：维护 Mod/类型 JSON Schema、公共 Go 类型及软件交付布局；protocol/context/storage/resources/search/privacy 各定义可复用边界。

依赖与接口：各模块与客户端依赖这里，契约不得反向依赖 Core、Agent 或平台执行。Schema 是结构提示，运行时校验仍由消费者执行。

资料与状态：只放公共声明、类型和布局，不放凭据、对话或真实配置。source_trees/source_files 是打包与更新消费者的共同库存；development-documents 是公开协约、地图及模板目标的唯一逐文件清单，Go/桌面更新与 Python 打包共同消费，不递归开放私人文档目录。

开发与验收：在本目录所属 Go 模块根串行执行 GOMAXPROCS=1 GOFLAGS=-p=1 go test ./... 与 go vet ./...，并检查 gofmt；跨宿主变更再执行 scripts/check-modules.py。 变更 Schema 要检查 SDK 样板及实际解码器一致性；改布局同时核对源包选择器、更新器和隐私检查。

兼容与交接：新增版本需能力声明、旧消费者拒绝及升级路径；解析成功不代表运行兼容。 修改接口时一起核对调用者、交付清单和对应专题地图；未实际验证的范围保持未验，不以目录存在或安装成功代替运行验收。

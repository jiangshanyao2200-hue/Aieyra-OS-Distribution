# Agent 定义与上下文 · 工作协约

遵循[根协约](../AGENTS.md)；当前职责与迁移边界见[工程地图](../docs/工程地图.md)。本文件覆盖本目录中没有更近协约的自有子目录，测试、样例资产和第三方依赖不因此成为独立执行模块。

入口：[definition.go](contract/definition.go)、[definitions.go](official/definitions.go)、[provider.go](context/contract/provider.go)、[README.md](README.md)。

职责：contract 管定义/任务/包/实例，official 管 Eyra/Vaya/Cota 公共设计，context 管预算/历史/策略，presentation 管只读展示。执行器仍为 Core AgentManager。

依赖与接口：只依赖 Contracts 和本模块。Core 注入授权消息、模型调用与持久提交；模型默认工具不等于实际权限。

资料与状态：公共包无私人提示词和模型配置；每个实例/任务独立档案和记忆，团队关系与用户停用状态由宿主保存。

开发与验收：在本目录所属 Go 模块根串行执行 GOMAXPROCS=1 GOFLAGS=-p=1 go test ./... 与 go vet ./...，并检查 gofmt；跨宿主变更再执行 scripts/check-modules.py。 包变动同时核对 Core/agent_package_*、Desktop 实例管理和 CLI 同服务消费者。

兼容与交接：包安装不创建实例，创建为空闲不调用模型；切版需空闲和修订，不恢复用户关闭成员。 修改接口时一起核对调用者、交付清单和对应专题地图；未实际验证的范围保持未验，不以目录存在或安装成功代替运行验收。


program/catalog.json声明原程序Navi/Sera/Mira及其工具要求；与Core程序联系人共同持久，不另起执行器。默认跟随Eyra选模和独立身份/历史并存。共同输入人工决策由human能力及Core原归属协议提供。

当前一环呈现与归属以docs/一环运行与投影.md为准：透明前景聊天可折叠、工具全在背景，不分聊天右栏；程序固定program_session与联系人OS sessions分开，团队可建OS会话。Brief完成退场且档案保留。浏览器按会话/实例隔离、明确group_id，Agent默认控制，无接管按钮，保留真实输入冲突与取消围栏。

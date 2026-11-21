# 主题元素状态与定义 · 工作协约

遵循[根协约](../../AGENTS.md)；当前职责与迁移边界见[工程地图](../../docs/工程地图.md)。本文件覆盖本目录中没有更近协约的自有子目录，测试、样例资产和第三方依赖不因此成为独立执行模块。

入口：[elements.json](elements.json)、[definition.go](definition.go)、[definition.mjs](definition.mjs)、[assets.go](assets.go)。

职责：规定元素/状态/属性/布局/语义槽位、资源、预设和声音；elements.json 是目录源，elements.mjs 是生成投影。

依赖与接口：Go 准入和浏览器校验共用语义，Contracts/theme.schema.json 与 SDK/tools/theme-catalog.cjs 同步。

资料与状态：只允许公开声明式样式、受限离线资产与完整唯一槽位；不允许作者私有 DOM 选择器、网络或执行脚本。

开发与验收：在 Theme 运行 go test ./contract 与 go vet ./contract；Desktop 自测校验 JS/Schema/目录一致性，变更运行 theme-catalog.cjs 的现有生成/检查流程。

兼容与交接：新增元件/槽位要版本化并有真实消费者、默认值、样板和拒绝旧宿主的检查；不放宽约束让旧包勉强通过。 修改接口时一起核对调用者、交付清单和对应专题地图；未实际验证的范围保持未验，不以目录存在或安装成功代替运行验收。

conversation的history槽对应当前真实#conversation-scroll；工具预览已移到独立背景，不再以退役的conversation-work-layout包装层作为私聊槽位。已发布editor槽保留隐藏的data-retired-theme-slot锚点，兼容旧主题完整槽位校验；不恢复会话内角色编辑器。双主题实际验收须检查私聊不会静默回退，不能以字号已更新代替完整布局成功。

首页团队退役后，live.team 槽同样绑定隐藏的 home-team 兼容锚点。保留旧主题完整槽位校验，不恢复团队呈现或执行；主题切换与重开不得因退役节点缺失静默回退。

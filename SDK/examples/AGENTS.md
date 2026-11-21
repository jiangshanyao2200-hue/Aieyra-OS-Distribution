# 作者样板包边界 · 工作协约

遵循[根协约](../../AGENTS.md)；当前职责与迁移边界见[工程地图](../../docs/工程地图.md)。本文件覆盖本目录中没有更近协约的自有子目录，测试、样例资产和第三方依赖不因此成为独立执行模块。

入口：[README.md](../README.md)、[manifest.json](agent-reviewer/manifest.json)、[workflow.json](workbox-specialist/workflow.json)、[README.md](theme-components/README.md)。

职责：program-notebook演示沙箱；theme-blank/columns/assets/sounds/components演示布局/离线资产/声音/组件；tool-statistics/toolbox-report演示统计和写报告；workbox-statistics/images/specialist演示组合/审阅/专员；agent-reviewer/workflow-manager演示标准实例；api-local-gateway/context-project/halo-prism演示独立类型。

依赖与接口：依赖和版本由每包manifest声明，共同导入/启用/回滚，组合包按SDK说明先启用依赖；不编辑Core取得样板专属权限。

资料与状态：本协约覆盖所有样板及其prompts/assets子树；每包为精确载荷集合，不在包内新增AGENTS/临时文件或凭据。作者从包外工作目录复制制作。

开发与验收：修改某样板后按共同打包器更新manifest/版本，检查inspect及实际运行能力；16包作者闭环已过不代表每个运行表面都重复验过。

兼容与交接：保留许可、公共身份与兼容声明；作者修改ID需同步定义/依赖引用，不复用example身份发布个人版本。 修改接口时一起核对调用者、交付清单和对应专题地图；未实际验证的范围保持未验，不以目录存在或安装成功代替运行验收。

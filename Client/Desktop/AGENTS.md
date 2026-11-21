# Electron 客户端 · 工作协约

遵循[根协约](../../AGENTS.md)；当前职责与迁移边界见[工程地图](../../docs/工程地图.md)。本文件覆盖本目录中没有更近协约的自有子目录，测试、样例资产和第三方依赖不因此成为独立执行模块。

入口：[package.json](package.json)、[main.cjs](src/main.cjs)、[main.cjs](host/main.cjs)、[app.mjs](ui/app.mjs)。

职责：src 装配配置/平台能力，host 装配OS/RPC/窗口/模块，ui是实际视图，renderer保留原生表面入口。唯一可编辑实现已归本目录；根Desktop仅留21份固定Program兼容资源。

依赖与接口：业务通过Core共同服务；布局/内容在Theme、光圈在Halo、程序业务在Program、工具呈现在Tool；桌面只注入平台桥和共同窗口能力。

资料与状态：paths与storage绑定资料根，私人配置/提示词/会话不可放入软件资源；node_modules/runtime/update-bootstrap为依赖或交付产物，不手工散改。

开发与验证：直接修改本目录，按实际影响选择语法、定向测试或真实界面核对；不默认运行全量 selftest，也不将整套 AIDEBUG 设为门禁。界面变更按 docs/UI协约.md 统一样式，需要时在源码冻结期间实看受影响原生图。 npm start/dev会启动GUI，不能无授权重开用户实例；实际界面验证由主会话串行调度。

兼容与交接：迁移旧页面保留必要转接，更新主工程四产物后另验运行实例；默认风格和隐藏功能开关不因测试重开。 修改接口时一起核对调用者、交付清单和对应专题地图；未实际验证的范围保持未验，不以目录存在或安装成功代替运行验收。

桌面测试使用支持require(ESM)的独立Node（当前开发环境Node 24）；不要用Electron的Node模式替代完整selftest，子进程环境过滤会清掉ELECTRON_RUN_AS_NODE。联系人资料经src/role-profile.cjs复用profile与prompt编辑器，内置角色模型选择与模型连接共用同一权威配置。修改角色资料须保留CAS、备份与旧私人覆盖，不复制第二份可编辑资料。

# 基础工具分类 · 工作协约

遵循[根协约](../../AGENTS.md)；当前职责与迁移边界见[工程地图](../../docs/工程地图.md)。本文件覆盖本目录中没有更近协约的自有子目录，测试、样例资产和第三方依赖不因此成为独立执行模块。

入口：[README.md](official/apply_patch/README.md)、[README.md](official/terminal/README.md)、[README.md](official/update_plan/README.md)、[README.md](official/view_image/README.md)、[README.md](official/web_search/README.md)。

职责：official 下每个目录拥有相应原子能力、输入契约、手册和双端呈现；apply_patch/terminal/update_plan/view_image/web_search 各有就近协约。

依赖与接口：Core负责权限、稳定调用身份和提交，基础工具不因同处目录共享越权状态或重复执行器。

资料与状态：实际文件/终端/计划/图片资料由宿主授权与保存，不放源码目录；恢复凭原请求日志。

开发与验收：在 Tool 运行 go test ./base/...、go vet ./base/...，仅对改动能力选择实际消费者回归；不重复未受影响的重测试。

兼容与交接：旧ID与手册覆盖有活动消费者，先核调用链再退役；视图随能力一起交付。 修改接口时一起核对调用者、交付清单和对应专题地图；未实际验证的范围保持未验，不以目录存在或安装成功代替运行验收。

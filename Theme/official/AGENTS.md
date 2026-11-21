# 官方默认视觉 · 工作协约

遵循[根协约](../../AGENTS.md)；当前职责与迁移边界见[工程地图](../../docs/工程地图.md)。本文件覆盖本目录中没有更近协约的自有子目录，测试、样例资产和第三方依赖不因此成为独立执行模块。

入口：[theme.json](default/theme.json)、[ui-foundation.css](default/ui-foundation.css)、[window-theme.css](default/window-theme.css)。

职责：default 持有默认外观、基础控件令牌、窗口与媒体样式、布局 schema。本协约覆盖 default，结构不同的作者样板在 SDK/examples。

依赖与接口：Desktop 旧路径转接，Control/Link 精确资源路由读取同一基础字节；业务状态/操作不写进 CSS。

资料与状态：默认资源不能含个人头像、背景、字体路径或配置。用户明确偏好保留，恢复默认不重置身份和历史。

姓名旁状态的字体和动态圆环共同由default/appearance.css提供，所有聊天/程序/原生/预览复用；圈面和描边随实际状态字号，文本截断仍留足环位。隐藏暂停，空闲/空状态不留环，减少动效保留静态环。实际运动用伪元素连续变换及subtree动画时钟取证，不能只核animation-name。

开发与验收：修改后在 Client/Desktop 执行 npm run -s syntax 和 npm run -s selftest；界面变更按 docs/UI协约.md 选择受影响 AIDEBUG 场景，在源码冻结期间实看原生图。 默认左侧大头像、文字层级和三角色，以及双主题/125%窄窗/原生表面均需实际查看。

兼容与交接：修改公共令牌同步所有消费者；第三方样板可以变布局，不能据此替换用户默认风格。 修改接口时一起核对调用者、交付清单和对应专题地图；未实际验证的范围保持未验，不以目录存在或安装成功代替运行验收。

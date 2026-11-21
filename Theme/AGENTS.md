# 完整主题体系 · 工作协约

遵循[根协约](../AGENTS.md)；当前职责与迁移边界见[工程地图](../docs/工程地图.md)。本文件覆盖本目录中没有更近协约的自有子目录，测试、样例资产和第三方依赖不因此成为独立执行模块。

入口：[elements.json](contract/elements.json)、[layout.mjs](runtime/layout.mjs)、[settings.cjs](runtime/settings.cjs)、[README.md](README.md)。

职责：拥有布局组合、外观配置、内容渲染、用户覆盖/预设、离线媒体与声音及组件展示；不能缩减成七种配色或 CSS 皮肤。

依赖与接口：Core 提供真实业务状态与操作，主题移动原语义节点、不执行作者脚本；Halo 拥有光圈，Tool 拥有回执，Program 拥有业务。

资料与状态：用户明确覆盖优先于主题与默认；主题/预设切换保留草稿、焦点、滚位和媒体状态，独立设置和原生恢复入口始终可用。

姓名旁的状态圆环由official/default/appearance.css统一提供：首页、私聊/群聊、程序Agent、原生折叠和设置预览消费同一状态字号/颜色及比例几何；不能用头像Halo代替状态右侧的圆环，或在Desktop私自固定圈面大小。状态隐藏/为空不画圈，减少动效保留静态环，隐藏暂停动画。核实际伪元素动画时钟和连续变换、姓名居中以及自定义字号上下界；动画名称本身不证明正在转动。

开发与验收：在本目录所属 Go 模块根串行执行 GOMAXPROCS=1 GOFLAGS=-p=1 go test ./... 与 go vet ./...，并检查 gofmt；跨宿主变更再执行 scripts/check-modules.py。修改后在 Client/Desktop 执行 npm run -s syntax 和 npm run -s selftest；界面变更按 docs/UI协约.md 选择受影响 AIDEBUG 场景，在源码冻结期间实看原生图。 分别验证默认/可选主题、原生表面、工作动效、触摸/系统IME与macOS实机；目录展示不代替业务验收。

兼容与交接：以 contract/elements.json 与版本化槽位为权威；Theme ^1.4.0 等兼容声明须经 Go/JS 一致校验，包更新保留用户修改并显式处理冲突。 修改接口时一起核对调用者、交付清单和对应专题地图；未实际验证的范围保持未验，不以目录存在或安装成功代替运行验收。

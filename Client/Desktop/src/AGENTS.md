# 配置与平台服务装配 · 工作协约

遵循[根协约](../../../AGENTS.md)；当前职责与迁移边界见[工程地图](../../../docs/工程地图.md)。本文件覆盖本目录中没有更近协约的自有子目录，测试、样例资产和第三方依赖不因此成为独立执行模块。

入口：[main.cjs](main.cjs)、[preload.cjs](preload.cjs)、[paths.cjs](paths.cjs)、[agent-browser-host.cjs](agent-browser-host.cjs)。

职责：装配Electron配置入口、设置RPC/preload、路径与系统能力、Agent浏览器/电脑操作；迁出的浏览器业务在Program，仅保留兼容服务。

依赖与接口：Core管模型与工具实际执行；此处注入Electron/原生输入/受控文件等平台能力，不复制API或记忆事务。

资料与状态：配置CAS、临时诊断凭据、参数缓存和浏览器profile按资料所有者/适配摘要隔离；日志不暴露Key。

开发与验收：修改后在 Client/Desktop 执行 npm run -s syntax 和 npm run -s selftest；界面变更按 docs/UI协约.md 选择受影响 AIDEBUG 场景，在源码冻结期间实看原生图。 参数探测/工具缓存诊断要经过共同Go请求，临时子进程有界且关闭输入取消HTTP；真实供应商另验。

兼容与交接：preload最小暴露，新增RPC同时维护白名单与schema；保存成功、探测接受和真实能力分别记录。 修改接口时一起核对调用者、交付清单和对应专题地图；未实际验证的范围保持未验，不以目录存在或安装成功代替运行验收。

受管更新：审阅进行时固定release/envelope/冲突决定；nextRelease只排队，终结/延期后下次check接纳。重复review验证本地摘要后返回原审阅；未知回复不能重置选择。事件忙时合并一次回查，操作进度为内存观察，checkedAt/lastResult为持久状态；不得在设置入口另建下载/替换状态机。

helper终态回执可能晚于新界面启动：status和check都需读取当前release的终态，以回执身份去重。旧回滚不能覆盖用户再次review；终态到达后下次check可接纳nextRelease，不能无限保留prepared。transaction.json仍是持久事实，展示不另造成功回执。

SSE重连只属于当前连接；退出登录或关闭服务取消在途HTTP和验证进程，异步返回后重验生命周期。通知确认绑定原release及登录生命周期，旧确认不得给新版消通知；未启动自动监听时的手动操作同样受退出登录约束。

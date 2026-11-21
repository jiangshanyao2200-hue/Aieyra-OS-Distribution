# 平台宿主与进程生命周期 · 工作协约

遵循[根协约](../../AGENTS.md)；当前职责与迁移边界见[工程地图](../../docs/工程地图.md)。本文件覆盖本目录中没有更近协约的自有子目录，测试、样例资产和第三方依赖不因此成为独立执行模块。

入口：[app.go](app.go)、[workspace.go](workspace.go)、[module_runtime.go](module_runtime.go)、[managed_update.go](managed_update.go)。

职责：装配 OS/配置/模块入口、Workspace 进程与所有者租约、Control 发现/启动、成套更新；linkclient 子目录提供受控 Link 子进程适配。

依赖与接口：经 Core 与 platform 连接 Desktop、Control 和模块进程；业务执行留在领域模块，平台差异放 *_windows/other 文件。

资料与状态：配置绑定、发现文件、活动 owner 和更新回执是各自的事实；持有通信租约不代表持有任务执行权。

开发与验收：在 Core 执行 go test ./host/...、go vet ./host/...；Windows 生命周期需主会话串行实启/退出。更新失败、锁冲突和旧用户进程保留是必查路径。

兼容与交接：更新保留用户修改与原件，禁止以强杀用户进程完成替换；四产物来源与已运行实例分别核验。 修改接口时一起核对调用者、交付清单和对应专题地图；未实际验证的范围保持未验，不以目录存在或安装成功代替运行验收。

桌面共同启动由desktop_bootstrap.go提供：先分派Matrix/诊断worker与首参数更新维护，再共同加载配置/私人资料路径/提示词；OS、Link和Browser入口都进入RunWorkspace。模块启动调用SetModuleOnly，在Core中延后自动问候、旧历史整理和办公室通知唤醒；明确用户任务/连接验证解除延后。维护参数不能误识别用户文本，启动器不依赖另一个OS可执行文件。改动同时验证cmd入口、共同host、Core模块启动定向及无OS.exe包实际运行。

更新路径由Contracts/product-layout与development-documents共同约束：公开文档只逐文件准入，history/cloud只允许声明的源码位置；私人数据/SQLite/遍历/链接仍拒绝。修改规则必须同时验证Desktop更新器、完整包inventory和真实helper提交/回滚，不能靠从包里删协约消除失败。Windows宿主在创建Electron前绑定自身Job，正常退出解除，Core异常终止清理子树；必须验证界面加载前卡死、超时回滚与无孤立进程，不能仅结束父进程。

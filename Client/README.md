# 客户端

`CLI/` 是现有命令行客户端的实际实现，`Mobile/` 预留手机端边界，`Desktop/` 是桌面宿主和界面的唯一可编辑实现。根 `Desktop/` 暂存既有用户进程仍需的运行文件，以及未改版 Program 的固定公共资源；其消费者和逐文件摘要见 `Contracts/desktop-compatibility.json`。新入口、构建与源码导出使用本目录，旧实例自然退出后的运行文件退役另行核验。

`CLI/host` 对接共同 Core 的 Workspace、设置与包服务；`CLI/terminal` 只处理终端显示和输入，`CLI/mdrender` 处理文本排版。UI 通过 `Contracts/protocol` 取得状态与操作接口，工具文本回执复用Tool的只读呈现，不另建模型请求、Agent、会话或记忆执行器。原 `Core/cmd` 下的入口保留为兼容启动器，转交这个客户端模块；用户原有启动命令和阶段开关继续生效。

独立模块运行 `go test ./...`、`go vet ./...`；从 Core 构建时会调用这些包，成套构建也单独测试 Client 模块。核心包禁止导入客户端，入口装配可以同时使用 Core 和 Client。

调用方向：客户端输入 → Core命令/Workspace → API与工具 → 共同事件/回执 → 客户端呈现。网络重连不等于重发命令；同一操作携带原请求编号，未知结果先查询。用户资料由宿主路径服务定位，不放进客户端源码目录。

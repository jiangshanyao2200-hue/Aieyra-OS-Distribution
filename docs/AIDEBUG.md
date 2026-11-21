# AIDEBUG 日常实机

```powershell
node AIDEBUG/aidebug.cjs foreground --launch --open center --click '#center-refresh' --expect '刷新健康状态' --frames 6 --frame-ms 240
node AIDEBUG/aidebug.cjs foreground --open servers
node AIDEBUG/aidebug.cjs foreground --on link
node AIDEBUG/aidebug.cjs background
node AIDEBUG/aidebug.cjs api --launch --expect-build <构建ID>
node AIDEBUG/aidebug.cjs module coding --launch --expect-build <实际Core构建ID>
node AIDEBUG/aidebug.cjs module coding --close --expect-build <实际Core构建ID>
node AIDEBUG/aidebug.cjs screenshot center --expect-build <实际Core构建ID>
node AIDEBUG/aidebug.cjs screenshot center --frames 3 --frame-ms 450 --expect-build <实际Core构建ID>
node AIDEBUG/aidebug.cjs send <请求ID> --epoch <会话标识> --expect-build <构建ID> --message-file <UTF-8文件>
node AIDEBUG/aidebug.cjs receipt <原消息ID> --expect-build <构建ID>
```

前台连接桌面快捷方式对应的真实用户进程。通过 Windows 原生控件操作，从该窗口的实际屏幕采图。已运行时复用现有资料、偏好和会话。窗口隐藏、最小化或存在遮挡时，证据记录现场状态。`--expect-build` 可核对运行进程自报的完整构建 ID。

后台只读同一个日常进程的运行状态。外层 `AIDEBUG/runs` 保留运行身份、构建、原图、拼图和未确认动作。用 `review <运行名> <原图或拼图名> --note <实看结果>` 登记实看。对日常会话发消息使用本次明确授权的输入，核对原消息 ID 与执行代次。

`api` 通过同一进程的本机认证通道核对中枢健康、服务器列表和内部 Link 状态，写入 `api.json`，再按实际构建更新中枢的后台回执。服务器仅记录条目数，内部 Link 仅记录运行代次和工位计数。用 `--expect-build` 固定所有 Agent 验收的构建。多个 Agent 可同时读取已启动的程序，各自保存回执。构建不符时保留此前公布的回执。

`module` 支持共同启动器清单中的程序。默认通过认证 API 查实际共享 Core 和窗口，保存 `module.json`。使用 `--launch` 时启动对应正式 EXE。证据记录实际 Core 映像与构建，以及模块是否独立打开。Together 另记录办公室协议、工位数和云连接状态。该命令可在屏幕遮挡时读取状态。独立 Link 使用自身的 AIDEBUG（未随开发包提供：`Link/README.md`）。

`--close` 走模块自身的关闭流程并回读独立窗口状态。OS 主窗口仍打开时，模块可以回停靠位，宿主继续保留会话和草稿。

`screenshot` 经同一资料的本机认证接口，从已打开的指定程序的实际渲染页面采集 PNG。它可在程序未取得前台焦点时使用，保留运行构建、页面身份、采集时间、尺寸和独立窗口状态。证据包含原图和截图回执。需要查看整个原生窗口及窗头时，使用现有前台实屏命令。

Together 在本地模式采集当前工位子视图，切至云端时采集程序主页面。浏览器采集已显示的浏览器窗口及活动标签内容。连续采集期间核对程序页面和实际视图的身份。磁盘更新后仍可只读观察原日常进程，回执以其加载的构建为准，并标记 `currentFiles:false`。操作界面或发送消息前要核对运行映像与磁盘。指定 `--expect-build` 时核对加载的实际构建。

连续采集同时保留每帧原图，并生成 `contact-sheet-01.jpg` 等拼图。`review` 可以登记对原图或拼图的实看，并核对采集回执里的图像摘要。

需要只构建某些启动器时，在主工程运行 `./scripts/build-module-launchers.ps1 -Module settings,contacts,coding`。程序名称取同一份 [启动器清单](../Client/Desktop/host/module-launchers.json)。现有 Code Atlas 继续记录每个独立程序的所有者与消费者。

`send` 从 `api` 的 `workspace.epoch` 取得会话标识。支持 `workspace.send_scoped` 的 Core 在入队时再次核对该标识。命令使用正常消息队列，不操作桌面输入框，并保存不含正文的 `send.json`。发送结果不明时，查询同一请求 ID 和原正文的接收回执。再次提交时沿用同一请求 ID 和原正文。

`receipt` 直接读取日常 Core 当前会话保留的消息，保存 `receipt.json`。回执保留原消息 ID、发送实例、代次、回复 ID 和终态等元数据。切换会话或超出当前保留范围时可能找不到原件。找到同一代次的完成回复时退出码为 0，未找到、仍处理中或失败时为 2。

# 工具包契约 1.0.0

工具与 Toolbox 都使用共同 `aieyra.mod/1` 包服务，kind 分别为 tool、toolbox；`contracts.tool` 必须兼容 1.0.0。两者执行同一个受限 JS 契约，Toolbox 通过独立手册描述较完整的操作能力。此版本不提供原生库或任意 UI 脚本热加载。

`entrypoints.tool` 指向 `aieyra.tool/1` JSON：executor=javascript/1、name、description、entry、input、capabilities。entry 为包内 UTF-8 JS 文件，最大 64 KiB；input 使用 Tool/contract 的 object schema 子集，必须 additionalProperties=false。实现可读取 args，返回值自动写入输出，也可多次调用 text/image 与获授的 tools 方法。

`entrypoints.manual` 为非空 UTF-8 手册，最多 32 KiB。桌面 `presentation.desktop` 必须为 renderer=aieyra.tool、contract=1.0.0，其 entry 为 `{"schema":"aieyra.tool-view/1","result":"output","view":{"kind":"cards","title":"结果"}}`；table 要提供 columns（key、label）。CLI renderer=aieyra.text、contract=1.0.0，其 entry 为 `{"schema":"aieyra.tool-text/1","result":"output","format":"json"}`。这些文件均计入清单摘要。

桌面卡片呈现真实对象字段，表格呈现真实数组及声明列；其它输出保持原文。原始回执保留非选中列、混合输出、错误与 cell 状态。表格最多直接显示 200 行，活动预览有界并明确标注省略，完整持久回执保留。CLI JSON 保留完整当前回执，不用工具箱的通用提示句替换输出。显示不运行包内 HTML/JS，不读取私人资料；主题工具槽位与共同令牌照常适用。

capabilities 只接受 terminal、exec_command、write_stdin、read_shell_output、apply_patch、view_image。每项必须精确对应一个 `permissions` 声明：capability=tool.invoke、scope=工具名、reason=用途。启用需要用户 grants，实际调用再与当前角色权限取交集。获授 shell 仍具有该用户正常操作系统权限，不把它宣传为 OS 沙箱。子 Agent 必须显式获授完整包版本与所有内层能力，wait 查询随包授权提供；不因此开放任意 exec 代码；固定成员的基础能力不足时拒绝分配。

调用路径为 toolbox.list → open → call，完整身份为 `mod:<package-id>@<64位digest>`。发现只列当前可用且获授的启用包。open 按需载入手册/schema；每次 call 重新校验启用状态、版本、文件摘要、用户 grants 和角色权限。读取载荷后再次核对登记 revision；最后一个已验证快照为接纳点。包登记不是持锁运行 JS：后续升级/停用影响新调用，已接纳的 cell 继续沿原身份查询/取消。

state=running 时通过现有 wait(cell_id) 续读，terminate=true 请求取消。取消不能撤销已发生的外部副作用。持久 tool_intent 在派发前提交，相同 invocation/call 与参数重放原回执；中断但无法确认的 cell 明确 interrupted_unknown，不自动重做。历史展示使用回执内的原呈现定义，不依赖当前安装版本。

SDK 两份样板可以直接复制到工程外修改。新增内容要增加 version 并运行 SDK/tools/package.cjs 更新摘要；本地模式明确 unsigned，第三方来源需签名。安装默认停用，更新、回退、停用、卸载走同一登记与权限服务，卸载保留用户产物和历史。当前 clients 仅声明 desktop；CLI 文本契约通过独立投影测试，不代表正式 CLI 执行已开放。Mobile 只有契约，不运行本工具包。

没有启用包且没有已打开包记录的普通会话保持原有工具定义，不额外注入 wait；已启用或打开的包保留查询入口，包括包随后停用后的已接纳 cell。

## 随附原生工具

官方基础工具和imagegen使用tool契约1.1，入口为aieyra.native-tool/1，aliases声明既有工具名。包中包含实际Go实现、手册、桌面视图和CLI投影。宿主只接纳编译目录中的精确摘要；改名、改源码或改摘要都不能让导入包取得原生执行权。源码目录含未封包的测试与协约，先用SDK/tools/package.cjs --export导出原清单载荷，再将导出目录交给共同Mod检查、导入、启用、停用和卸载。导出不改原身份，安装默认关闭，内置默认首次登记尊重以后的用户选择。

原生包通过声明的旧工具名执行，保持原schema、权限与完整回执；它不是javascript/1，不通过mod身份伪装成JS工具。基础工具不依赖Toolbox开放。已受理cell绑定准入快照；停用影响后续新操作，旧终端会话的读取、等待和停止仍校验既有所有者，图片status/list/recover只读取或恢复原回包，不新增供应商请求。升级卸载不删除原文件、计划、图片或调用档案。

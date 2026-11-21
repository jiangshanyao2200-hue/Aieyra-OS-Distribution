# 工具

独立Go模块 `github.com/aieyra/aieyra-os/tool`，按工具归属组织说明、执行、回执和可视化。当前实际迁移包括 `base/official/apply_patch`、`base/official/update_plan`、`base/official/view_image`、`base/official/web_search` 和 `toolbox/official/imagegen`；Core的直接调用与编排调用、桌面差异/计划/图片事实、CLI文本回执使用这里的实现。补丁、计划领域规则、看图读取/拼图和生图的一次执行逻辑已移除旧副本；计划持久提交、不可变图片快照、生图批次与相册服务仍由Core提供。

`contract`只定义输入/回执，执行器不依赖Core。Core继续负责权限、稳定调用身份、任务取消和回执提交，并把恢复目录传给工具。`presentation`只呈现已有回执，不执行工具，也不读取私人配置。默认DOM、样式、差异折叠和终端文字保持；主题可覆盖工具元素。

动态 `tool` / `toolbox` 已接入共同 Core 包登记、手册发现和现有 JS cell 执行器，作者样板见 SDK。宿主不热加载下载的原生 Go。`workbox` 复用这些实际工具、图片批次和 AgentManager，持久保存步骤、审阅边界与专职 Agent；定义和恢复语义见 [workbox](workbox/README.md)。成套安装与实际GUI运行分别验收。

运行 `go test ./...`、`go vet ./...`。成套构建、公共扫描、客户端依赖检查、桌面语法和UI协约均覆盖此目录。

`Tool/contract`已承接现有工具工厂的版本定义、输入/参数及声明式呈现兼容校验；注册、加载、执行与活动投影实际使用。有效旧工具 ID 保持；包身份采用 `mod:<包ID>@<完整摘要>`，更新不会把旧调用改绑到新代码。

动态包规范见 [contract/packages.md](contract/packages.md)。`runtime` 只生成经过 schema 验证的 JS 输入；Core 管理授权、持久意图与 cell。`presentation` 包含 cards/table 桌面投影与完整 JSON 的 CLI 回退；声明不支持的 renderer、缺手册或视图会在导入前被拒绝。

六项随附工具（终端、补丁、持久计划、看图、搜索与图片生成）由 `catalog.json` 和各自清单进入共同包登记。原工具名、私人手册覆盖、角色授权和回执协议保持；基础工具不依赖Toolbox开关。原生源码不热加载，只有宿主编译认可的完整载荷可准入，第三方代码仍用公开JS契约。共同包停用阻止新操作、卸载保留资料；每个Workbox步骤重新准入，已受理cell及图片批次的查询/恢复不重放。详见 [包契约](contract/packages.md)。

当前官方六包均由共同Mod登记与精确编译摘要准入。包内README属于随1.0.0载荷冻结的版本资料，其中终端“共同安装仍待完成”、生图“提示词待统一”是该文档编写时状态；现行契约、登记和提示词索引以本文件、对应AGENTS及docs/工程地图为准。修正文档不能暗改已有包摘要或将旧宿主声称为新版本。

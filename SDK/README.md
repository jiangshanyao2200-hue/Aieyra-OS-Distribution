# Mod 作者入口

先复制 `examples/program-notebook` 到自己的工作目录。每个程序一个目录，修改身份、程序定义、页面和资产后运行：

```text
node SDK/tools/package.cjs <程序目录>
node SDK/tools/package.cjs <程序目录> <包外的 Ed25519 私钥 PEM 路径>
```

第一条更新文件摘要，作为本地开发包导入；第二条同时签名，用于第三方包。私钥不放进程序目录。每次改变内容都增加清单 version；打包器不会替你改变版本或安装程序。

已有清单的包可用 `node SDK/tools/package.cjs --export <源码目录> <新的工程外目标目录>` 导出。导出先核对每个声明文件的长度与SHA，再仅复制清单和声明载荷，保持清单、版本、摘要及签名字节；测试和作者笔记留在源码目录。目标必须不存在且位于源码树外。随附原生工具先这样导出，再将目标目录交给市场或CLI共同检查/导入；不要对官方源码运行重新打包命令，否则会改变宿主认可的身份。

使用自己的包 ID 和 publisher，ID 必须以 `publisher.` 开头，例如 `publisher: "author"` 对应 `id: "author.notebook"`。修改 Agent/Context 身份时同步定义文件中的 ID，并更新组合包的依赖引用。先导入并启用依赖，再导入组合包。保持同一签名公钥升级，不复用同版本发布不同内容；改变资料 schema 前先实现可恢复迁移。宿主契约和弃用规则以 [共同契约](../Contracts/README.md) 为准，旧消费者只能使用其已声明支持的版本，不能靠放宽版本范围跳过适配。

桌面市场的“导入文件夹/导入压缩包”先展示兼容结果、作者和权限。导入后在“已安装”中启用；启用按钮明确授予展示的权限。再次导入同身份的新版本即更新，详情可停用、回退、卸载。

独立 CLI 仍由阶段开关隐藏（`release_stage.cli=false`）。下面使用主工程现有的 OS 显式 CLI 入口，不需要开启独立 CLI 或配置模型。

终端使用同一服务，无须模型配置：`"Aieyra OS.exe" cli mods --config <作者测试资料根>/Config/config.json`，从标准输入读一个 JSON 请求，标准输出写一个 JSON 回执。先用 `"Aieyra OS.exe" cli profile init --root <作者测试资料根>` 创建资料目录；这里的资料只保存作者自己的导入与运行状态。先 `{"action":"inspect","source":"<绝对目录或 ZIP 路径>"}`，使用返回的 revision/digest 构造 install；随后 list、enable、resolve、disable、rollback、remove 均走同一登记文件。变更带稳定 request_id，enable 带清单对应的 grants。

Eyra 经 software_api 的 `package` 和 `program` 两个 action 使用相同服务。先 describe；程序操作以 `operation=invoke`、arguments 中的 id/operation/arguments/request_id 调用。失败或超时先读取 snapshot，不更换请求编号盲目重试。

检查失败时先看 `inspect.compatibility.issues`：依赖问题先核对依赖是否安装并启用；`runtime_contract` 核对对应类型定义和宿主能力；摘要错误重新打包后重新 inspect；签名错误使用原作者密钥重新签名。修订冲突先 list 获取当前状态；权限变化由用户审阅后重新启用。不要复用旧的 digest/revision，也不要为了通过校验修改他人的包身份。

主题模板：`examples/theme-blank`为空白定义起点，未覆盖部分继承默认实现，`examples/theme-columns`为分栏样板；编辑theme.json后使用同一打包器、导入器和兼容检查。启用后在详情点“应用主题”；独立设置页可以移除主题，原生Ctrl+Shift+F12可恢复默认。当前接入面与未完成范围见`Theme/README.md`。

工具样板：`examples/tool-statistics` 是纯数字统计 Tool，`examples/toolbox-report` 是会实际通过 apply_patch 新建报告的 Toolbox。两者均含实现、输入 schema、手册、桌面 cards/table 与 CLI JSON 投影，使用上面的共同打包/导入/更新流程。执行宿主目前为 Desktop；CLI 提供文本投影。详细字段和权限见 `Tool/contract/packages.md`。

工作流样板：`examples/workbox-statistics` 组合统计 Tool 和报告 Toolbox，在写文件前等待审阅；先安装并启用这两个依赖。`examples/workbox-images` 调用已有图片工具箱，先生成原图、等待审阅，再引用原图编辑。两者通过同一打包器导入，在详情“工作流”中创建、运行和检查实例。定义、恢复、专职 Agent 与权限语义见 `Tool/workbox/README.md`；样板执行端为 Desktop，CLI 提供完整回执投影。安装与实际工作流运行分别验证。

Agent 样板为 `examples/agent-reviewer`，通过同一打包器导入、启用。市场“Agent 实例”中选择模板、模型连接和工作目录，创建空闲实例后再发送任务。个人提示词和工具覆盖、团队关系、实例停用、空闲切版分别保存；包更新不会自动修改实例。CLI 用 `"Aieyra OS.exe" cli agents --discovery <正在运行的Core私有发现文件>` 发送同一JSON命令，命令退出不停止宿主任务。创建示例：`{"action":"create","package":"mod:example.reviewer@<inspect返回的摘要>","model_id":"<配置中的连接ID>","workdir":"<绝对目录>","request_id":"create-reviewer-1"}`。详细隔离与版本语义见 `Agent/README.md`。

实例设置的“导出公开模板”仅保存原始包，保留清单、版本、签名，不带私人覆盖、模型连接、会话或记忆。CLI 同一命令为 `{"action":"export","id":"<实例ID>"}`（也可提供精确 `package`），回传 `archive` 的base64 ZIP、`filename` 和 `sha256`。原始内容及ZIP分别上限2 MiB；缺失或损坏的原版本明确报错，不从私人实例重建。导出包可再次按普通流程检查、导入、启用，创建新的空闲独立实例。

API 与 Context 作者模板及各自运行边界见下方独立说明。

标准工作流专员样板为 `agent-workflow-manager` 和 `workbox-specialist`。先启用统计、报告工具及专员Agent包，再导入工作流包；工作流详情选择模型并“创建专职 Agent”，然后“管理专员”打开同一标准实例并发送任务。创建不会调用模型。专员仅能操作私下绑定的工作流，不能自行审阅或创建另一个专员；私人绑定、模型选择和历史不写入公开包。旧内联模板保留原行为。

模型通过 `agents` 的 `action: package` 和嵌套 `command` 使用同一实例服务；创建时另给明确的 `team_role`，只授予包默认工具与父调用权限的交集，创建后仍空闲。直接管理者可以按修订配置、切版、改职责或离队；不能接管无关实例、扩大工具权限或重新启用用户关闭的实例/固定角色。发送同时校验当前权限，旧 `agents.send` 入口也适用。

离线图片与字体样板为`examples/theme-assets`，要求Theme契约`^1.1.0`；旧宿主在兼容报告中拒绝。资源声明、限额与受限引用语法见`Theme/README.md`。

分栏样板1.5要求Theme`^1.2.0`，在theme.json的presets中提供紧凑消息和宽栏阅读两种可继承布局。每个预设含name、可选extends和values；覆盖范围与完整槽位校验见`Theme/README.md`。实际设置页可应用包内预设、将自己的修改保存为新预设、选择继承来源、导出或导入JSON。可移植格式为`Contracts/theme-preset.schema.json`；预设保留原主题身份与默认版本，媒体仍须安装原包，导入本身不会启用包或改变当前界面。

`examples/theme-sounds` 是 Theme ^1.4.0 的短 PCM 提示音参考包，按公共包服务检查/安装/应用；用户须在外观页显式开启并保存。三类事件和资源限制见 `Theme/README.md`，与布局预设、用户文字修改独立。

资源中心“组件与状态”展示当前外观；已安装主题详情“预览组件”展示包默认效果，包括未启用的包。预览不写外观配置，恢复默认和关闭位于隔离框架之外。资源由宿主核验已安装摘要与兼容性后提供限时快照，五分钟到期，关闭、隐藏、替换或窗口销毁撤销；每个窗口最多一个预览。包定义不执行代码，预览凭据不能保存为主题选择。

展示页提供控件/输入、真实共同正文与思考、工具回执/工作流、只读终端、图片/静音音频、导航/浮层，以及每个公开布局的槽位样例。状态选择改变真实 native/ARIA/data-state 属性；悬停、焦点和按下需要实际指针/键盘。全部内容标为合成示例。元件计数是当前目录的渲染覆盖，不代替真实业务、原生窗口、多端、性能和辅助输入验收。作者组件模板见 `SDK/examples/theme-components`，保留八类原始语义槽位；新业务组件仍需版本化契约及消费者。

独立光圈样板：`examples/halo-prism`，契约 `halo ^1.0.0`。支持作者图形、状态与关键帧动画，经共同 Mod 导入、启用、应用；与 Theme 和角色资料分开，详见 `Halo/README.md` 和 `Contracts/halo.schema.json`。

模型API适配样板：`examples/api-local-gateway`，契约 `api ^1.0.0`，结构提示 `Contracts/api-adapter.schema.json`。改动后运行打包工具更新精确文件摘要，再按资源中心导入、启用、选择模型和应用。路径、非凭据厂商头、型号别名及额外参数边界见 `API/README.md`；不能在公共包写入Key或个人连接。

上下文策略样板：`examples/context-project`，契约 `context ^1.0.0`，结构提示 `Contracts/context-policy.schema.json`。修改 `context.json` 后运行打包工具，导入并启用，再从包详情“应用到当前会话”。当前版本支持 `structured` 引擎、完整轮次保留下限和摘要指导，不执行作者脚本或接入任意外部存储。原文保留、工具配对、预算与提交仍使用共同实现；不能降低近期100条原文保留目标。应用只影响当前主会话，不改其他Agent或私人提示词。

Agent包可通过必需的Context依赖声明复用策略，`context_provider`填写依赖ID、精确版本和`state_schema:1`，无需作者预填安装摘要；实例创建时锁定实际依赖摘要。更新不会自动迁移旧会话或实例。停用、损坏或版本变化会拒绝新执行，原档案仍可读，可显式恢复包或在详情恢复内置会话摘要。`workspace.context`继续提供同一CLI/宿主契约：读取`view.provider.available`，用`source`与完整`reference`提交`provider`操作。

在提供完整AIDEBUG的开发工程中，`node AIDEBUG/aidebug.cjs sdk-author-user --display --scale 1 --out <工程外证据目录>`复验16个样板的签名与CLI生命周期、便签实际编辑和正常重开。测试资料与作者密钥仅在本场证据目录；其他样板的运行能力继续使用对应模块场景。公开开发包未提供AIDEBUG时，不能直接运行此内部验收入口。

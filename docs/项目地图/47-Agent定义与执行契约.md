# Agent定义与执行契约

| 位置 | 实际职责与消费者 |
| --- | --- |
| `Agent/contract/task.go` | 现有Agent任务声明；Core创建、继续、持久记录复用，JSON字段保持 |
| `Agent/contract/delivery.go`、`time.go` | 验收条件及复制校验、产物/审查回执、实际观察到的运行时段；不执行文件访问或鉴权 |
| `Contracts/protocol/attachment.go` | 公共附件身份；文件读取、引用授权、GC仍由Core执行 |
| `Agent/contract/definition.go` | 定义和团队引用的结构校验，拒绝未知字段、坏默认工具和无效提示词资源路径 |
| `Agent/official/Eyra`、`Vaya`、`Cota` | 独立官方角色定义：身份、默认/可选工具及公开提示词引用；一角色一目录 |
| `Agent/official/Eyra/team` | 成员引用与可委派Toolbox范围；没有用户模型ID、密钥或运行记录 |
| `Agent/official/Eyra/prompts/contracts`、`context/prompts` | 24份运行协定与19份上下文公开文案；策略实现和Core事务的当前边界见[地图48](48-上下文策略与宿主边界.md) |
| `Agent/official/Vaya/prompts`、`Cota/prompts` | 两个成员自己的公开角色/协定文件；原逻辑资源名及分节保持 |
| `Agent/official/Eyra/prompts/default` | 四份只读公开默认；Core与Desktop逐层按索引回退，空个人文件仍是显式覆盖；恢复/撤销只写个人目录 |
| `Contracts/resources`、`Core/prompt_locations.go` | 索引逻辑名到模块文件的公共契约；宿主保留旧修改的覆盖优先级，打包只选官方原文 |
| `Agent/official/definitions.go` | 编译时读取同一JSON并校验，Core权限装配、名称和提示词引用实际使用；返回独立快照 |
| `Agent/official/definitions.cjs` | Desktop模型设置使用同一工具列表；提示词索引检查覆盖声明中的资源引用 |
| `Agent/contract/package.go`、`instance.go` | 完整Agent包运行契约、精确依赖、私人实例覆盖/版本与创建回执 |
| `Core/agent_package_*.go` | 共同包加载、持久独立实例、团队权限、记忆隔离、消息排序/取消和Program依赖端口 |
| `Client/Desktop/ui/agent-packages.mjs`、`role-identity.mjs` | 实例管理与临时任务身份，个人Eyra资料保持；现有聊天/历史/工具视图共用 |
| `Client/CLI/host/agents.go` | 连接运行中Core的包实例管理；验证CLI/Desktop同Core、命令退出后任务保留及正常重开 |
| `Core/matrix_agents.go`、`matrix_contract.go`、`team_roles.go` | 调度、实际权限、成员开关、持久化、真实产物及独立审查；原类型入口保留兼容别名 |

定义只描述默认要求，不能授予实际权限。用户禁用成员、按设置收窄工具、父任务授权及阶段开关仍在Core执行；不凭显示名字判断身份。

公共提示词已全部按索引归 Agent/official 或所属 Tool，根 Prompt 不再维护公共副本。角色私人层及旧实例搬迁边界见[提示词目录](../提示词目录.md)；用户改过的旧公共副本含空文件仍按摘要规则保留为覆盖。Agent Mod导入、模板实例/切版、独立记忆、受限模型管理、标准Workbox专员组合、公开模板导出及Context包依赖已有实际消费者；创建为空闲，不自动发起模型或加入团队，两种发送入口均核当前权限。`definition.json`定义角色内容，`manifest.json`声明共同Mod载荷/身份，两者不能互代。安装、实例创建和真实运行分别验证。

标准Workbox绑定见`Core/agent_package_workflow.go`，公开模板导出见`Core/agent_package_export.go`与`Client/Desktop/host/agent-template-export.cjs`。导出只读精确原包，实例私人内容不入包；Desktop/CLI共用workspace.agents。包更新不自动改实例绑定，停用成员不由模型恢复。共同Session目录、资料归属、长期恢复与工作流分别验证。角色与包外协约见[工程地图](../工程地图.md)及[地图53](53-光圈SDK与模块协约.md)。

Core/conversation_link.go提供实例级核心协作与稳定联系人目录，Core/workspace_core_link.go将首页真实母体绑定到持久context会话邮箱。邀请实例由原conversationManager执行，邮箱不另起模型；来源随消息一次提交、消费再核取消代次，重开只恢复记录。Core/conversation_groups.go的Coordinator改变后续默认收件人，保留旧会话/发件人key。包式Agent与普通会话共用core_link；普通会话不重复暴露agents别名schema。验证稳定来源、取消代次、默认收件人与重开不重放。

母体权限与职责集中在 `Core/workspace_mother.go`，跨会话整理在 `conversation_compaction.go`，持久身份交接在 `workspace_identity.go`，失败与求助治理在 `workspace_repairs.go`。受邀Eyra只拥有该实例权限，不能由名字取得母体能力。母体发消息、整理和接管均记录真实来源、请求编号和目标代次；用户已停止的任务不会被自动唤醒。

身份切换先持久化任务/原因/计划/成功与退出条件、完成共同上下文整理，再切换工具和提示词；母体模型、头像与Halo保持。目标角色的其他会话不进入上下文；取消、失效、完成或崩溃恢复返回母体且不重放未知副作用。主动修理采用来源去重、冷却和有界预算，专业态求助保留队列，真实用户补充继续送当前主角。

桌面 `Client/Desktop/ui/contacts.mjs` 提供联系人分组与新会话入口；`work-participants.mjs`、`work-selection.mjs` 与 `stage.mjs` 消费共同成员及工具回执投影，头像和历史同滚动。展示不改变会话执行所有者；实际GUI按对应构建记录。

自建联系人头像轮换以Core的可选`avatar_rotation`持久化，字段与Theme媒体偏好一致；`avatar_revision`在图片或周期变化时单调递增，宿主以`avatar_expected_revision`预占/提交，拒绝迟到覆盖。`Theme/runtime/official-library.cjs`的共同调度复用本地图像缓存、随机池与退避，联系人界面只编辑草稿。内置角色仍映射到同一profile.mediaRotation，不建第二份配置。验证迟到覆盖、缓存和真实到期调度。


Navi/Sera/Mira由Agent/program/catalog.json和原Core程序联系人绑定；共享模型选择可跟随Eyra，执行身份、历史、草稿与任务独立。共享聊天与human决策保持原权限边界，见[一环运行与投影](../一环运行与投影.md)。

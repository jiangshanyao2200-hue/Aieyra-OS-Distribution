# 共同执行核心 · 工作协约

Core Link展示保留活动members与当前有界消息页的归档authors。归档仅释放席位，历史Brief继续解析原作者姓名、角色、光圈与头像修订；authors不携带活动、错误或工作权限。member_avatar仅可读当前协作范围的成员/页内归档作者，外部ID继续拒绝；显示读取及重开不得恢复执行。

Core Link的groupMessage独立保存可选Brief与完整Text；link_send的同request_id不得变更已提交Brief，旧无Brief日志仍兼容。结果Brief复用原resultBrief规则，完整结果及引用原样留日志。conversationLinkView公开实际actor_id/actor_generation以区分邮箱逻辑代次，呈现者不得把邮箱代次当实际运行代次。投影读取不执行任务、不改历史或停止围栏。

遵循[根协约](../AGENTS.md)；当前职责与迁移边界见[工程地图](../docs/工程地图.md)。本文件覆盖本目录中没有更近协约的自有子目录，测试、样例资产和第三方依赖不因此成为独立执行模块。

入口：[api.go](api.go)、[workspace.go](workspace.go)、[go.mod](go.mod)。

职责：负责模型/工具/Agent/任务的授权、执行、取消、事件、持久提交及恢复；workspace_* 是共同 RPC，客户端不另建执行器。host 负责平台装配，extensionhost 负责 Mod 类型装配，modules、sessionservice、memoryservice、userdata 各有下层协约。

依赖与接口：通过 Contracts 类型调用 API、Agent、Tool、Theme、Program、Halo；Core 根包不导入 Client 或 Electron。cmd 是组合入口，可以同时装配核心和客户端。

资料与状态：所有路径通过 platform 与 Contracts/storage 绑定。会话、记忆、附件与私人配置由授权宿主持有，不因重开、换主题或包卸载清空。禁止直接打开真实用户 SQLite。

受管会话的完整历史从该会话当前及历史版本档案分页读取，不受首页20轮保留策略约束。复制的原始记录去重，重复提交按代次和数量保留；内部上下文修订、回查注入和成员指令不得冒充用户发言。近期消息只补充投递状态，不改变原文来源；历史查询不执行任务、不改写档案。

附件消息的档案把清单附在原文里，近期展示把清单单独保存；两者按原始正文、完整附件身份、代次与出现次数关联。不能按缩略显示文案或文件名去重，也不能因为本地文件暂不可用而重发消息或丢弃原记录。

受管历史不叠加项目记忆转录，切会话后不能沿旧memory入口读其他会话。工具公开回执以持久会话ID寻址；当前活动的临时角色ID仅作兼容别名，终端状态仍按实际运行owner/代次读取。独立CLI解析搬迁后的项目身份，但不加载或锁定桌面的选中会话。

工作目录随资料搬迁时，按共同origin映射在当前资料根查找原会话目录，并保持该会话的记忆项目身份；旧路径只作身份，不读取旧根。多个现存目录对应同一搬迁工作目录时明确拒绝，不能任选或覆盖原件。

无桌面目录的CLI项目也要恢复原记忆身份：只向共同记忆服务核对已验证origin产生的scope，并合并待写队列的项目身份；多个实际scope明确拒绝，不任选、不合并库内记录。未有记忆库时不为身份检查创建空库。

开发与验证：直接在主工程构建与运行，按实际改动选择定向检查；不默认运行全量 go test/vet。需要 Go 检查时使用 GOMAXPROCS=1 GOFLAGS=-p=1 串行执行；四产物由 Core/build.ps1 直接构建，-Check/-Tests 均为显式选择。实际 GUI 与重任务串行。

兼容与交接：旧类型/工具 ID/RPC 保留兼容入口；请求编号、generation、事件游标、未知副作用与事务提交边界不能为迁移而弱化。 修改接口时一起核对调用者、交付清单和对应专题地图；未实际验证的范围保持未验，不以目录存在或安装成功代替运行验收。

三主体联系人由 conversation_builtin.go 登记，持久ID与会话ID分离；名字/头像来自共同profile，内置模型由设置与联系人入口共用同一模型连接权威配置和保存流程，会话快捷选模另存当前会话覆盖；发送边界解析并冻结本回合配置。内置身份不能由普通联系人编辑请求创建或删除；受邀Eyra不自动继承母体能力。群主持可在创建时指定，未点名消息只送主持自己的群内会话；其历史不借用原私聊。

核心Link：conversation_link.go复用AgentManager与会话追加日志，不启动外部Link办公室。会话用户输入仍只到主角，邀请实例独立于联系人的原私聊；TurnOrigins和core-link消息名保存真实内部来源。运行时caller/代次取宿主上下文，模型参数不能伪造。目录前缀按ID排序且每轮固定，增量消息在历史末尾交付。普通会话agents仅开放link_*动作，无全局联系人/母体权限。新增工程工具复用project服务，不注入Matrix权限；收到角色/模型撤权须阻止后续请求/工具。首页和包式Agent接入分别验证，不能把会话实现当作全体系完成。

包式Agent以core_link获得基础协作，agents仍按原显式管理授权；core_link不能透传到一般创建/管理动作。邀请成员在同一执行器中保存独立会话，仅从共同联系人服务读取模板；不挂streamProjection冒充会话宿主，不注入包式记忆。link_release在空闲/无待交付消息且下属已归档后释放席位，结果和日志保留，原邀请编号仍幂等。首页母体由workspace_core_link.go按持久context会话建邮箱，邀请实例仍归唯一conversationManager；邮箱不创建Agent执行器。首次实际输入先建立持久会话，入队一次提交来源，真实enqueue/pump/drain消费。协作操作与取消共用准入锁，日志锁外调用Workspace；入队和消费都重验持久停止代次。切会话不误投递，重开只恢复记录，显式续聊才补投递。原生用户工作流从已授权的版本锁定工具取得执行能力，不依赖Eyra角色默认工具；模型路径仍检查实际授权，恢复原回执先于重新准入。

群主持：Coordinator只改变默认收件人和核心Link的主持权限，保留原成员会话/历史发件人key。必须处于空闲边界并携带expected_host_contact；新消息提交时固定收件人，旧request_id重试不改投新主持。初始主持会话保留；新增联系人先加入群再转交主持。普通会话仅暴露一份core_link定义，agents link_*只作旧档案调用兼容，不重复发送整份工具schema。

母体管理首批：workspace_mother.go校验真实已登记主Workspace及活动actor/generation，agents kind=conversation的修改要求reason与稳定request_id。复用共同联系人/群聊服务与原工具事务，在同一持久会话档案追加mother_action审计。跨会话send使用intervention来源，忙时排队、停止代次不可自动重开，分身不能获得管理权。审计记录由session重放验证，不作为模型消息或恢复命令。跨会话整理由conversation_compaction.go复用目标会话执行循环和压缩器，compactions保存请求/结果，compaction_run只标空闲维护。忙时在完整工具边界处理；空闲维护不追加输入、消费协作消息或生成回复，收尾恢复原结果/代次/计时。恢复只采纳匹配的已提交检查点，不重发模型。主动修理复用共同持久队列，按独立场景核验。

共同展示：workspace_snapshot按当前持久会话投影Core Link，conversationLinkView/groupLive提供当前代次与有界工具回执，读取不恢复执行。原生私聊member_avatar只允许读取当前协作范围的成员头像；跨会话ID拒绝。首页显示不能把邮箱建成执行Agent。实际验证范围按对应构建的场景证据记录。

身份：workspace_identity.go由同一matrix_agent_runtime持有；仅真实母体可用agents identity_enter/status/exit。交接档案保存目标提示词/工具快照、源消息边界、母体模型引用、理由/任务/计划/成功及退出条件；凭据不写档案。准备与已提交压缩绑定后才换工具，专业态仅保留agents退出/查询控制和自身核心Link。权限撤销每次调用重验；退出、异常或重开保留原文/回执，不重放副作用。失败成员MotherTakeover固定代次，内部续跑被拒；真正用户新回合可使接管失效。显示从workspace_snapshot.identity取最小投影，原头像/Halo不变。权限、交接与异常恢复分别验证。

身份排队：preparing/active/exiting期间，Workspace.drain保留非用户成员消息在持久队列，母体恢复后按原消息ID交付；用户补充继续进当前任务。母体直接执行简单编程；较复杂任务通过task_complexity交接、压缩再成为专业身份。用户任务原文、工具授权、取消与代次边界仍须核对。

主动修理：workspace_repairs.go复用Workspace持久消息与原运行器；独立会话、首页Link失败、原工作流/包式Agent及团队outbox进入同一去重/冷却/预算边界，群主持失败升级而普通成员不抢主持权。link_help保存真实来源，修理只传必要事实和原文引用。母体首个自动请求取得网络名额后再次检查源停止/代次；用户输入清除RepairRun，专业身份期间事件留队列。跨会话identity_enter只接受对应场景已交付修理事件，并保留MotherTakeover代次围栏；请求/回执不能附带目标私聊Spec/Turns。旧版取消通知必须以原ID退役，不自动重新唤醒。持久队列回归不代替成套构建和GUI验收。

展示投影：groupLive保留失败、超时、中断、保存失败、等待输入、排队和取消中的真实状态，等待发布的成功结果仍算工作中；groupLive与conversationLinkView提供实例更新时间及脱敏错误，不能把错误当空闲或用旧输出掩盖原因。

群聊与核心Link元数据复用privatefile.OpenSnapshot/WriteSnapshot；准入可能在AgentManager锁内读取，不能反向获取群日志锁，也不能使用会阻塞Windows读者的普通Rename。旧读者保留完整旧字节，新读者读取已提交版本。

session_model保存ConversationModel会话覆盖，按revision核对，下次请求生效；内置角色默认模型仍归模型连接。删除最后会话不补建，联系人仅保留模型/工具/工作目录默认值和独立提示词。greet先保存本地问候、每段一次、全局30秒在线限频与20秒取消边界，不生成用户回合或执行工具。session_usage以原私聊或群ID归属嵌套成员，主角上下文不与成员相加；查询不执行模型、不返回提示词。

toolbox公开system分区入口映射到原settings/software_api/tool_factory；section只选择原服务，不赋予权限。持久Open、私人手册覆盖、旧调用与回执身份保留原键；关闭一域不关闭其它域。目录不重复系统schema，说明只随打开域加载。凭据归档覆盖统一及兼容入口，递归对象/数组，不因门面迁移让api_key落历史。

主页会话：模型覆盖、累计usage基线及后台用量属于持久context会话，重开不重发模型。请求账本读取已验证的live job.LinkSession；后台发送前固定来源，首次真实费用建立持久归属，迟到回复不能串到新会话。保存失败保留真实回执并明确报告，重试保存不重复记账；失效模型可由用户显式替换，不能静默回默认。

活动投影：Activity读取job当前绑定的真实SessionArchive；持久context档案和临时内存档案使用同一回执协议，只有尚无绑定的旧任务才回退旧任务目录。缓存与代次不能把别的会话回执带入当前任务。验收须在真实工具后、后续模型仍运行时检查公开snapshot.activity，不得只等最终结果。

Coding项目：coding_project用私有原子快照保存用户当前根、文件、草稿与保存版本；不自动启动模型。切根与群投递共用锁顺序，检查执行/交付/未知终端边界并释放旧shell；下一次任务冻结新工作目录，群请求携带用户操作事实，原用户消息不改写。


私聊human_reply沿ReplyHuman校验原owner/Agent/generation/token/version，普通联系人权限不扩大。terminal_read与群读取共用原回执日志链，按原私聊解析归属且不创建Shell。程序human默认仅一次迁移未编辑旧官方工具列表；ProgramToolsVersion阻止之后重加用户移除的能力。

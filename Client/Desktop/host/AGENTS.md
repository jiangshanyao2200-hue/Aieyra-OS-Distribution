# OS 宿主与共同窗口 · 工作协约

遵循[根协约](../../../AGENTS.md)；当前职责与迁移边界见[工程地图](../../../docs/工程地图.md)。本文件覆盖本目录中没有更近协约的自有子目录，测试、样例资产和第三方依赖不因此成为独立执行模块。

入口：[main.cjs](main.cjs)、[module-runtime.cjs](module-runtime.cjs)、[module-window.cjs](module-window.cjs)、[surface-lifecycle.cjs](surface-lifecycle.cjs)。

职责：处理Core连接/RPC、共同模块装配、内嵌/拆出/停靠/关闭、原生表面和模块消息；modules子目录保留共同注册/租约和旧入口转交；新Link/Browser窗口都由共同Core宿主装配。

依赖与接口：调用Program/Theme/Halo/Tool实际业务，注入文件/窗口/加密/SSH等受控能力；browser/servers/link旧入口只转交唯一Program实现。

资料与状态：窗口代次/owner、订阅和截图缓存有独立生命周期；隐藏可暂停，关闭释放，不清私人资料，不重复副作用。

开发与验收：按用户2026-11-15要求直接修改主工程，按实际影响选择语法、定向测试或受影响的实际界面；不默认运行全量 syntax/selftest，也不把整套 AIDEBUG 设为门禁。界面变更按 docs/UI协约.md 在源码冻结期间实看所需原生图；涉及独立/内嵌切换、缩放/最小化/恢复几何、迟到回执、关闭订阅或同Core不同窗口时核对对应路径，已有有效结果直接复用。

兼容与交接：预览/原生投影仅接收公开状态，不能绕过Core权限；现存旧路径消费者确认后才撤下。 修改接口时一起核对调用者、交付清单和对应专题地图；未实际验证的范围保持未验，不以目录存在或安装成功代替运行验收。

Link的设备状态、邀请、旧Toolbox、Program调用及Control界面入口共同准入；控制页隐藏允许清理，显示须准入，通用openLink外部网址不属于Link程序。Program门面等待已受理操作结束再断开本人工位、释放本地Control租约和页面，保留原资料；借用办公室不能按PID结束。桌面宿主不再装配第二份linkAgent或独立业务宿主。

资源中心：role ZIP经resources下载摘要校验和共同mod_inspect/mod_install，不另建角色执行器。中心条目ID与包ID分离，检查实际类型/版本/权限/签名；未签名仅显式local导入，初次安装不启用、不创建实例。downloads中的package收据只映射列表显示，实际启停/卸载由Core共同注册表决定；原request_id/revision用于不确定提交的回查重试。

设置更新：settings-updates.cjs只开放status/check/defer/assist，经同一managed-updates与真实母体workspace.send；普通渲染器不能prepare/verify/handoff。assist绑定当前母体会话与原request_id，不采用客户端任意任务文本；切会话拒绝旧编号，不改投Cota。完整更新替换仍走cloud-updates的冻结/闲置/健康回执。

sessionModel仅提交当前会话覆盖，主页绑定宿主session_id并带expected_model；群以明确主持实例为目标。删除成功释放对应conversation页面与附件缓存。contacts的sessionFocus仅由该扩展发送，重新显示时恢复群归属。requests_sessions从Core公开归属和本地usage账本汇总，早期无法恢复的归属单列，不读取对话正文或按角色猜会话；主页核心Link范围由当前Core快照映射。

私聊draft_load/draft_save经会话原生记录绑定真实id，复用composer-draft的版本写锁、附件保留与关闭flush。草稿按profile+会话分区，不随首页工作目录串用；保存未确认发送编号但不自动重发。不要退回每次启动即丢失的sessionStorage或新增第二套草稿存储。

群聊：contacts的sessionFocus持有当前群范围；进入群聊隐藏原生母体presence，返回联系人目录恢复，隐藏/重开不得丢失范围。GUI必须检查实际原生View可见性，DOM隐藏不能证明原生浮层已退出。

用量明细：只将请求携带的当前runtime编号解析到公开快照link.scope，账本行的持久归属不能被反向别名覆盖。新首页请求和后台收据从源头带真实持久scope；旧runtime记录无法证明归属时独立保留。不得读取私人SQLite或按角色猜测合并。

Coding项目文件能力由project-files注入：只接受Core已绑定根和相对路径，拒绝越界/链接/非文本，读取返回真实版本，保存前复核；草稿与观察历史归私人runtime。程序服务核对绑定键，迟到读取不可覆盖新项目，旧草稿只能落原项目。分层聊天原生表面沿相同sender/epoch鉴权，关闭动画确认后才缩小到左下命中区。

Coding 页面退休与 OS 正常关闭先经 program-drafts 等待当前页面的聊天/项目草稿持久化回执；旧页面、旧关闭编号和失败回执不能授权销毁。正在退休时仅允许原页面补交私人草稿，不开放新文件保存或任务。

Coding原生选择器只返回用户选定的目录/文件，由project-files复用真实路径、链接与文本校验后提交Core项目修订；渲染器不能用参数指定任意根。文件保存与上下文同步分别报告，已保存的字节不因后续状态同步失败冒充保存失败。

folded-overlay加载/renderer失败必须清理shown、presented并退役旧frame revision；ready:false通知以reason:unavailable区分正常隐藏，surface结果附加unavailable供原所有者恢复主页面回退。旧客户端忽略附加字段仍可读取ready；不能在失败后继续报告ready:true，关闭后不发送迟到失败。新场沿原ready/frame/visibility和宿主draw核交接，不拿两份非同时截图证明物理同帧。


programProjection 先核完整原工具回执，再从原 browser runtime 读同一tab画面或从原联系人服务取公开身份/状态；读取前后重验归属。不可为投影重新执行或创建第二浏览器。普通会话的terminal_read/program_projection也受原receiptFence显隐/窗口生命周期约束。
workspaceShift与browserSurface等原生几何接口使用同一当前页面所有者校验；隐藏OS容器的resize或visibility回调不能改写活动首页的侧栏避让。页面切换显示归属时补交保留几何，不能用重新创建原生业务页修复层级/留位。

当前一环呈现与归属以docs/一环运行与投影.md为准：透明前景聊天可折叠、工具全在背景，不分聊天右栏；程序固定program_session与联系人OS sessions分开，团队可建OS会话。Brief完成退场且档案保留。浏览器按会话/实例隔离、明确group_id，Agent默认控制，无接管按钮，保留真实输入冲突与取消围栏。

# Mod、Theme 与 Program 的当前调用关系

共同包服务具有Program、Theme、Tool/Toolbox/Workbox、Agent、API、Context与Halo消费者。各类型边界见对应模块说明，类型接通不代表完整运行验收。

| 入口/模块 | 权威与消费者 |
| --- | --- |
| `Core/modules` | 清单、兼容、签名、依赖、事务登记、resolve、启停/回退/卸载；Desktop扩展管理与CLI共同调用 |
| `Core/extensionhost/desktop.go`、`official.go` | Desktop支持类型的专属验证器装配与编译官方摘要；各类型使用自己的契约，来源不能靠自报 |
| `Core/platform/layout.go`、`Contracts/storage`、`Core/userdata` | 旧Config/Data与统一资料根解析、声明分区、初始化/离线迁移/取消；迁移真实资料须离线授权与校验 |
| `Core/workspace_modules.go` | workspace.packages和workspace.paths RPC；连接共同包服务 |
| `Client/CLI/host/mods.go` | 同一包服务的JSON输入输出；正式CLI仍按阶段开关隐藏 |
| `Client/Desktop/host/mod-packages.cjs` | 复核包载荷，装配Program窗口、主题选择和登记变更监听 |
| `Client/Desktop/ui/mod-packages.mjs`、`package-manager.mjs` | 设置外观中的扩展管理：兼容报告、导入、启停、回退、卸载、应用主题；保留旧Mod接口 |
| `Client/Desktop/ui/theme-library.mjs`、`profile-media.mjs` | 官网主题分页/高清连续浏览/点赞，共用个人设置的头像与背景选择、随机及自定义 |
| `Theme/runtime/official-library.cjs`、`media-preferences.cjs` | 公开目录、有界PNG缓存与校验，个人资料CAS下的随机周期和离线退避；宿主注入传输与解码 |
| `Program/contract`、`Program/runtime` | 人观察/人机协同/人用三种模式及桌面沙箱；旧中心和新包复用 |
| `Theme/contract/elements.json` | 元素、状态、槽位和允许属性的权威目录；生成elements.mjs供受CSP限制的渲染器读取 |
| `Theme/runtime/layout.mjs` | 重排原业务节点，保留草稿/事件/状态；恢复时移回原位置 |
| `Theme/runtime/settings.cjs` | 主题选择、外观schema和用户字段覆盖；复用Core/platform/config-file.cjs的文件锁与CAS |
| `Theme/runtime/appearance.mjs` | 主题样式与用户文字偏好；用户明确覆盖优先于主题 |
| `Theme/runtime/recovery.cjs` | 原生恢复快捷键；不依赖主题自己绘制的按钮 |
| `Theme/official/default` | 已迁出的默认外观、窗口样式、布局schema和基础令牌；Desktop保留转接入口 |
| `SDK/examples`、`SDK/tools` | 独立沙箱便签作者样例、分栏/空白主题及同一摘要/签名打包器；样例不恢复退役产品入口 |
| `Contracts/product-layout.json` | 模块软件交付清单，供打包、隐私扫描和Go/JS更新器共同使用 |

状态由Core及既有RoleState投影提供。Theme拥有组合和样式，Program拥有程序交互；主题没有执行工具、读取凭据或改写模型状态的能力。工作台的消息和工具组件在创建时注册主题槽位；隐藏语义仍由宿主控制。

程序状态同步区分包列表不可读和单个窗口释放失败：不可读时撤销准入；可信列表下逐项同步，失败不连带关闭无关程序。退出共享正在进行的释放，只重试未完成项。第三方程序snapshot/invoke在初始化完成后、实际派发前核对当前包与打开窗口的摘要；版本不同须先关闭旧窗口再开，不能把旧窗口的结果记录成新包回执。

Core桌面工具的取消信号沿门面传到原生/沙箱程序，等待准入、初始化或复用窗口后再检查取消，避免取消后的迟到派发。已发出的沙箱调用与原窗口关闭竞争，并在接受响应前核对当前窗口；关闭时及时报告结果未知，旧页面的迟到响应不能确认新窗口操作。派发后仅取消调用者时保留已确认结果，不声称效果已经撤回。

软件源码与私人资料分离。实际目录由`Contracts/storage`和绑定的资料根解析：旧布局继续兼容Data下的包/程序分区，统一资料根使用Packages等声明分区；不硬编码Data作为所有安装的唯一位置。程序存储不跟随临时Electron userData。外观沿共同配置服务定位；更新、停用和卸载不清除用户程序内容。初始化及离线迁移见[地图49](49-私人资料路径与清理归属.md)。

Control/Link通过精确的公开资源路由读取Theme的基础令牌，独立Control导出复制相同字节。未开放通用源码文件路由。

原生表面、第三方内容、主题覆盖合并和作者展示页经共同服务接入。浏览器、服务器、Link与Workspace共同登记；便签已退役，保留兼容载荷及私人资料，拒绝运行与发现。默认/可选主题、工作动效、供应商与性能分别验证。

`Program/official/servers`拥有服务器服务、桌面领域操作及页面；退役便签源码已归档工程外，私人便签原资料仍保留。用户与Agent共用同一实例，Desktop只注入受权路径、原生预览/文件选择、加密、SSH和事件通道；模块窗口继续由module-runtime及surface-lifecycle管理。旧Desktop入口供仍在运行的宿主兼容，实际JS/CSS和业务实现唯一归Program。私人便签及服务器分区没有随源码移动。

`Program/official/browser/service`及`ui`现拥有网页执行、控制权、浏览身份、书签/偏好和实际页面；Desktop注入Electron、受控preload、原子写入/缩放与共同窗口。旧Desktop路径只转接，不是第二份实现。浏览器通过共同登记准入；其受信原生适配与第三方沙箱分别执行各自已声明契约。职责协约与迁移边界见[工程地图](../工程地图.md)，独立光圈/SDK见[地图53](53-光圈SDK与模块协约.md)。

官方浏览器、服务器、Link和Workspace使用各自manifest/program.json作为包与导航来源，Core编译实际业务载荷摘要，默认登记保留用户停用/卸载；Program/runtime/native.cjs只调用宿主注入的适配器。每次新操作共同resolve并核对安装包和正在执行的Program源码，停用释放页面、浏览标签或SSH连接，私人资料保留。native声明只适用于宿主认可的精确官方版本，第三方仍走沙箱，不凭字段获得宿主权限。 导航由official/catalog投影，旧.aieyra文件经共同转换器处理。

旧.aieyra兼容：Program/contract/legacy.go纯转换 → Core/extensionhost/legacy.go有界读取与FromFiles → Core/modules统一兼容、身份、安装与授权。Client/Desktop/resources只保留下载和旧资源迁移入口，Program不再使用第二个安装状态或窗口运行时；市场/CLI均可导入.aieyra及相邻清单。未签名以明确local来源导入，旧宽网络授权不转换为通配符。旧私人program-storage按原ID复用；冲突保留原件。迁移、冲突恢复与实际GUI分别验证。

Link同样由Program/official/link的manifest/program.json登记。1.2原生process使用实际ui/control.mjs入口，Client/Desktop/ui只注入公共DOM与远程连接视图；service/agent/desktop分别持有设备连接、工位业务和共同生命周期。Core仅信任编译的精确官方摘要，第三方不能凭native/process声明获得宿主权限；既有1.1 surface/browser继续使用HTML。Link的旧工具与界面入口都经同一准入，原Program request_id传到办公室操作。

`Program/official/workspace`保留原版画布与动效，旧左侧设置、提示词和数据库入口已退役，由OS顶栏切入；service、images、studio、library分别适配共同会话、持久图像批次、原文档/素材库与四层资料。Agent/program与Core/program_agents.go为程序登记固定身份，初始不分配模型，联系人编辑和母体委派使用同一权威接口。关闭、休眠与停用先等待画布和共享草稿保存确认。

Workspace直接恢复本地画布。diagnostics.cjs以每次宿主启动的随机run及导航attempt关联存储创建、设置/会话读取、画布应用、首帧、无响应与进程退出，记录有界阶段耗时和宿主RSS。渲染器只在可见且恢复完成时汇总响应采样，隐藏时停止且不把隐藏时长计为卡顿。诊断不保存错误正文、完整路径、URL或凭据，只保留白名单数值及清洗后的调用栈；普通事件、渲染错误和原生故障分别限流，导航编号先于限流推进。批量图片来源恢复在每份节点快照中共用一次索引，保留原来源与全部节点，不跨编辑复用缓存。

项目图片读取支持已登记项目的output、assets和.iiimage/assets及原references目录，仍核对普通文件和真实路径；不开放项目根或其它元数据。恢复与保存的每份同步快照共用项目素材根校验，重复文件共用该快照内的路径校验；下次操作重新检查，不能跨编辑保留信任。无法读取的可选素材根不能授权其文件，也不阻断其它合法素材。

Workspace 的 `video-media.cjs` 与 `video-program.cjs` 共用本地导入、剪辑修订、顺序预览、裁剪导出及取消回执；`src/video-editor.tsx` 与视频节点复用原画布和关闭保存流程。生成视频经 `Core/program_videos.go` 调用原 video_gen 服务，固定属于真实 Workspace 专员会话；缺聊天模型时只建立空闲会话，不发送模型请求。已完成导出在画布提交确认后登记，重开不重新编码或提交供应商。`runtime/media` 来自锁定 FFmpeg 依赖，构建和发行核对完整文件摘要。

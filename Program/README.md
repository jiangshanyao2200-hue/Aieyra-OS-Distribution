# Program

`contract/` 是与客户端无关的程序定义；`runtime/desktop.cjs` 管程序沙箱窗口与程序内 AI 接口。Client/Desktop/host/mod-packages.cjs 只把 Core 安装服务、程序运行时和桌面桥接装配起来。旧中心HTML程序经contract/legacy.go转换为同一Mod清单；Core/extensionhost校验.aieyra与相邻.aieyra.manifest.json后使用共同安装器。

三种使用模式：`human` 只供用户操作，不暴露 AI 操作；`observed` 由 AI 操作，宿主阻止键鼠交互；`collaborative` 让用户与 AI 使用同一页面状态。AI 程序必须声明操作列表，并提供 `globalThis.aieyraProgram.snapshot()` 与 `invoke(operation, args)`。宿主仅调用已声明操作，参数最大 64 KiB、回执最大 256 KiB；操作超过 15 秒记为结果未确认，原请求不重复执行。

程序页无 Node、无宿主 preload、开启沙箱与上下文隔离；自身文件通过私有协议提供，禁止跨程序文件读取、任意跳转、新窗口、嵌入网页、下载和系统设备权限。网络只放行清单请求且已授予的精确 HTTPS origin。程序页的输出属于第三方内容，不成为新的系统指令。

停用/升级后的窗口由登记变更通知收回；每次操作仍先 resolve 核对启用状态与摘要。浏览器存储按稳定包 ID 隔离，卸载与回退保留。`program-notebook` 是可运行的人机协作作者示例。

当前官方程序为browser、servers、link和workspace。`official/servers` 拥有服务器实际服务、领域操作和桌面呈现；退役便签执行源码已归档工程外，私人原资料保留，运行、发现及旧入口均拒绝。用户与Agent调用同一个服务；Desktop只注入受权资料目录、原生预览/文件选择、加密、SSH、窗口与事件通道。程序页面仍通过共同module-runtime、surface-lifecycle和主题外壳运行，隐藏暂停与退出释放保持。便签文件保留在用户工作目录，服务器资料仍使用原来的私人分区，不随源码移动。

浏览器、服务器、Link和Workspace使用各自manifest/program.json作为包与导航来源，Core编译实际业务载荷摘要，默认登记保留用户停用/卸载；Program/runtime/native.cjs只调用宿主注入的适配器。每次新操作共同resolve并核对安装包和正在执行的Program源码，停用释放页面、浏览标签或SSH连接，私人资料保留。native声明只适用于宿主认可的精确官方版本，第三方仍走沙箱，不凭字段获得宿主权限。

官方清单在`official/catalog.json`，各程序导航由`program.json`提供；`node Program/official/catalog.cjs --write-navigation`生成浏览器可读投影，自动测试核对漂移。原生surface/browser需Program宿主契约1.1，Link的process呈现入口需1.2，当前仅支持编译记录的精确业务载荷版本；未知或旧但无适配实现的摘要明确拒绝，不能只改版本号声称支持回退。Link接入同一准入与生命周期；独立Core启动、停用恢复、远程SSH和跨设备通信分别验收。

旧Desktop服务和页面入口暂作兼容转接，供仍在运行、已缓存旧目录的宿主使用；业务、脚本和样式仅以Program中的文件为权威。旧HTML保留兼容文档结构，直接引用Program实现，待旧运行态退出且新安装完成后再撤下。

`official/browser` 拥有网页执行、控制权、身份、书签、偏好及实际浏览器页面；Desktop 注入 Electron、原生呈现、缩放和原子持久写入，保留共同窗口与模块生命周期。旧路径只转接到这一份实现，浏览器用户资料位置保持。

旧程序导入：将原`.aieyra`及同名追加`.manifest.json`清单放在一起，市场“导入压缩包”可检查并以本地开发包导入，CLI同样使用mods inspect/install。旧格式没有发布者签名，不伪造第三方来源。安装默认停用，显式授予权限后启用；旧network标志需补精确`network_origins`或由作者制作新版Mod。旧包的系统文件/终端等权限不能自动变成沙箱能力。已有旧安装可在“已安装”选择“以本地包迁移”，离线核验原文件后只保留共同登记。旧文件及私人浏览存储保留；自改源码或新旧存储冲突时明确停止。共同停用、卸载和回退适用，旧center_open不另开执行通道。

旧源码若已使用根manifest.json或.aieyra-legacy保留目录，须由作者先转换命名；转换器明确拒绝冲突，不改写程序引用。`.aieyra`后缀的现代ZIP仍按原Mod清单和签名校验。

`official/link`持有设备连接、办公室工位与实际control/link视图；宿主只注入DOM、资料根、共同准入与Control页面/本人租约。Program调用的request_id传入原办公室操作。停用阻止新入口，等待已受理写入回执后释放；释放失败保持不可重启，重试成功后才能再次启用。actor/native、cursor、pending与私人配置不随停用/卸载删除。独立Link启动器自己装配共同Core，不依赖OS.exe；纯模块冷启动延后问候、历史整理和办公室自动唤醒，显式用户任务或连接验证恢复正常执行。

Workspace保留2.0.39画布与动效，旧左侧设置、提示词和数据库入口已退役；OS拥有顶栏，service.cjs把会话、模型、四层资料与图像批次接到共同Core。关闭和休眠先确认原画布与共享草稿落盘；失败保留页面。程序固定Agent由Agent/program目录与Core/program_agents.go登记，初始无模型，联系人可编辑但不能另建OS会话；Eyra经共同agents目录管理与委派。

Workspace 的 `video-media.cjs` 与 `video-program.cjs` 共用本地导入、剪辑修订、顺序预览、裁剪导出及取消回执；`src/video-editor.tsx` 与视频节点复用原画布和关闭保存流程。生成视频经 `Core/program_videos.go` 调用原 video_gen 服务，固定属于真实 Workspace 专员会话；缺聊天模型时只建立空闲会话，不发送模型请求。已完成导出在画布提交确认后登记，重开不重新编码或提交供应商。`runtime/media` 来自锁定 FFmpeg 依赖，构建和发行核对完整文件摘要。

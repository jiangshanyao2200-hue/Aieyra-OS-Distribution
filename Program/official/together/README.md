# Aieyra Together

Together 由 OS 的共同 Electron 宿主呈现。主窗口从顶栏打开，`Aieyra Together.exe` 打开可停靠的独立窗口。程序包包含 Together 的原 Electron 入口、原生办公室服务、Agent 工具和运行依赖。两种窗口复用 OS 窗头、Agent 联系人和会话。

从 Core 运行 `pwsh -File Program/official/together/Build.ps1` 同步共享资源及官方包摘要，并调用公共启动器构建。OS 主启动器也须使用包含 Together 官方包的新版 Core。AIDEBUG 使用 OS 的实机窗口、原生控件及 `software_api` 调用路径，运行记录保存在工程外层 `AIDEBUG/runs/`。

本地模式默认打开像素办公室，保留群聊、工单、工位详情、接入说明和分页。OS 工位页隐藏标题、搜索和筛选。云端模式由 OS 账号静默授权，登录、退出和切换在 OS 账号入口完成。首页、仓库、群聊、Agent 接入和治理沿 Together 原权限。页面顶部使用悬浮导航和模式按钮，颜色和玻璃材质随 OS 主题更新。程序的办公室资料位于 OS 配置所对应的 `runtime/programs/together`，旧 Link 办公室移交沿融合方案推进。

## 本地项目协作

在工位接入说明中获取本人的档案和命令。领取工单后，沿办公室登记的权威 Git 仓库和阶段提交运行 `workspace prepare`。同一工单续接后沿用原目录，提交和未提交的改动留在对应工作树。工作区状态会列出当前提交和待解决的 Git 冲突。

项目内的 `Aieyra Link SPACE` 保存领导、工位与项目绑定、工单记录、共享资料、冲突证据和阶段备份。工作树中的修改以提交交给项目负责人评审。日常程序运行资料与私人配置留在原存储位置。

运行 `Client/Desktop/node_modules/electron/dist/electron.exe AIDEBUG/tools/together-electron.cjs <绝对证据目录> [云端夹具模块]` 验证原 Electron 渲染器、模式切换和办公室释放。提供 Together 的现有云端夹具可检查登录后的导航和页面。

## AIDEBUG

从 Core 运行 Together 专用模块。日常前台沿 OS 的原生窗口、控件和实际屏幕取证，隐身或遮挡的窗口会保存未取证状态。双视图布局诊断走宿主已认证的 `program_check` 接口。

```powershell
node AIDEBUG/aidebug.cjs together preflight
node AIDEBUG/aidebug.cjs together status --launch --expect-build <构建ID>
node AIDEBUG/aidebug.cjs together live --expect-build <构建ID> --frames 6 --frame-ms 180
node AIDEBUG/aidebug.cjs together inspect --expect-build <构建ID>
node AIDEBUG/aidebug.cjs together exercise
```

`live` 默认取证当前已打开的 Together，`--open` 从 OS 导航打开。可用 `--click` 和 `--expect` 指定原生控件。`inspect` 输出外壳与办公室的可见性、布局、控件测量和几何候选。`exercise` 用官方载荷和隔离资料验证工位、主题、详情和复制，可加本机 `--cloud-fixture <绝对路径>` 验证云端页签及账号切换。

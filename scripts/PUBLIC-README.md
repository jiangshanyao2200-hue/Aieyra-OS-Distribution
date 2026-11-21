# Aieyra OS

Aieyra OS 的桌面客户端、CLI 与协作入口共用一个 Go 执行核心。Core 负责模型与工具执行、权限、取消、事件、会话和持久回执；客户端负责输入、呈现与平台能力。官网：https://os.aieyra.cn

## 开始开发

先读 [开发协约](AGENTS.md)、[开发指南](docs/开发指南.md) 和 [工程地图](docs/工程地图.md)，再查具体模块最近的 AGENTS.md。[专题地图](docs/项目地图/README.md)说明实际调用链；源码包未提供的入口会明确标注。

主工程用于开发版。正式发行由官方签名，源码构建不代表官方发行或完整平台验收。原“桌面模式”已移除；桌面客户端仍由 `Client/Desktop` 维护，顶栏程序预览独立保留。

| 模块 | 职责 |
| --- | --- |
| Core / Contracts | 共同执行、任务与会话服务；公共类型、协议、包定义和交付清单 |
| API | 传输、请求编码、响应解码、模型目录、参数及图片/视频/搜索协议 |
| Agent | 官方角色、标准包和上下文策略；执行交给 Core |
| Tool | 原子工具、Toolbox、Workbox，以及完整桌面和 CLI 回执呈现 |
| Theme / Halo | 页面布局与内容样式；独立光圈图形、状态动画与生命周期 |
| Program | 浏览器、服务器和 Link 的共同业务与页面；宿主注入原生能力 |
| Client | Desktop 与 CLI；Mobile 目前只提供契约 |
| Control / Link | 本机办公室、Agent 接入与远程协作通道 |
| SDK / scripts | 作者样板、摘要/签名打包器、构建、导出与检查 |

## 资料与运行

个人资料独立于公开程序资源。Windows 默认使用安装目录内受保护的 `Data`，开发时也可选择源码树外的独立资料根。模型密钥、私人提示词、头像、聊天、记忆、附件和运行数据库不随源码包提供。旧 Config/Data 布局仍有兼容读取与离线迁移能力，见 [资料根说明](Contracts/storage/README.md)。

```powershell
& './Aieyra OS.exe' cli profile init --root '../aieyra-user-data'
& './Aieyra OS.exe' -config '../aieyra-user-data/Config/config.json'
```

软件免费，模型额度与费用由所选供应商决定。自定义连接不要求 Aieyra 登录。协议、工具、图像、参数与缓存能力以实际声明和响应为准；目录中存在型号不等于其全部能力已验证。独立 CLI 受 `Config/运行参数.json` 的阶段开关约束，OS 显式 `cli` 入口仍可管理资料和扩展。

Windows 完整软件包解压后运行 `Aieyra OS.exe`，首次启动自动初始化独立资料并创建 OS 桌面快捷方式，`Install.bat` 可手动重建。默认不需要管理员权限、全局注册表配置或安装 Windows 服务；Link 是随宿主运行的本地进程。目录不可写时使用按安装路径隔离的用户资料目录。更新保留 `Data` 中的配置、聊天和记忆；手工替换整个文件夹前请备份 `Data`。同目录 Link 与浏览器入口共用模块、Core 和资料所有权，不同安装互相隔离。旧根 `Desktop` 仅保留清单中固定的兼容资源，不作为新的桌面实现。

## 构建与检查

依赖版本以各 Go 模块和桌面锁文件为准。在项目根执行以下命令构建 OS 入口；这不替代成套发行检查：

```sh
cd Client/Desktop
npm ci
npm run ensure
cd ../../Core
GOMAXPROCS=1 GOFLAGS=-p=1 go build -trimpath -o '../Aieyra OS' ./cmd/aieyra-os
```

Windows 使用对应平台与 `.exe` 输出，成套构建入口为 `scripts/build-windows.py`；macOS 见 `scripts/build-macos.py`，CLI 的 Windows/Linux/Android 构建见 [CLI 说明](scripts/CLI-README.md)。交叉编译成功不等于实机验收，Mobile 契约不代表已实现手机 App。

在 Core 运行 `GOMAXPROCS=1 GOFLAGS=-p=1 go test ./`、`go vet ./` 和格式检查；独立 Go 模块分别检查。Desktop 在其目录运行 `npm run -s syntax` 与 `npm run -s selftest`。依赖边界使用 `scripts/check-modules.py`，完整工程地图使用 `scripts/check-project-map.py`。

```sh
python -B scripts/public-privacy.py
python -B scripts/development-docs.py
```

开发文档按 `Contracts/development-documents.json` 精确清单导出，根入口使用公开模板。检查不代替实际功能与视觉验收；[AIDEBUG 手册](docs/AIDEBUG.md)区分合成接口、真实供应商、原生截图、性能和未覆盖项，所需代码未随包提供时不能直接运行对应场景。

## 扩展与发行

Mod 经共同服务校验文件全集、摘要/签名、版本、依赖和权限。安装默认停用，启用、应用主题/光圈或创建 Agent 实例是显式操作。更新不自动扩权或改写私人实例，卸载保留用户内容。[SDK](SDK/README.md)提供作者流程；私钥保存在包外，同版本不发布不同内容。

官方签名发行与本地开发构建分开。Windows 受管更新验证签名和文件变更，保留本地修改并在受控空闲边界交接；macOS 保留源码构建、自行签名与验证能力。发布、生产部署及真实供应商调用需要相应授权。

OS 使用 MIT；Link 与 Control 的独立许可范围、Electron 及其他依赖的声明按各目录 LICENSE 与第三方声明保留。

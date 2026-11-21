# 私人资料路径

Go 与 JavaScript 共用 `areas.json` 的38类资料归属。旧配置仍用原位置；只有带有效 `.aieyra-userdata.json` 声明的资料根使用 `profile_relative` 布局。

Windows 完整包首次直接运行时，在程序旁的 `Data` 初始化独立资料根，配置为 `Data/Config/config.json`，产物默认放在 `Data/Workspace`。OS、同目录 Link/Browser、显式 OS CLI 与设置入口使用同一原生 `profile prepare --root <安装目录>` 流程。旧安装的本地 `Config/config.json` 或根 `config.json` 继续使用；不会自动采用另一安装的全局 AppData，也不会自动迁移旧资料。显式 `-config` 仍优先。

全新安装目录不可写时，资料位于用户配置目录的 `AieyraOS/Installations/<安装路径摘要>/Data`。一旦启用该目录，后续保持原归属；现有资料、声明或配置损坏时明确报错，禁止悄悄创建替代资料。移到其他目录前应正常退出并使用下述迁移流程。

首次成功打开 Windows 主界面会创建 OS 桌面快捷方式；已存在的其他安装快捷方式保留，用户随后手动删除的快捷方式不反复补建。`Install.bat` 可手动重建。同一资料根的 OS 与 Link 共用办公室，不同资料根自动选择独立端口、运行锁与存储；连接前检查资料范围，拒绝误接另一个实例。

开发资料可在自己的 `Config/installation.json` 写入 `{"schema":1,"role":"development"}`，关闭这份安装的自动快捷方式和官方自动更新。缺省为日常用户安装。这是私人安装属性，不随发行包分发。

升级只写签名允许的产品文件，`Data`（含配置、聊天、记忆、私人提示词和作品）不进入更新/删除清单，也不进入公共包。更新事务保留旧产品文件供回滚；它不能代替个人资料备份。手工更换整个目录前，请正常退出后备份完整 `Data`，不要删除它。

从项目根创建源码树外的空资料根：

```powershell
& './Aieyra OS.exe' cli profile init --root '../aieyra-user-data'
& './Aieyra OS.exe' cli profile inspect --root '../aieyra-user-data'
& './Aieyra OS.exe' -config '../aieyra-user-data/Config/config.json'
```

首次启动通过现有设置界面配置模型，也可对刚创建的空配置执行 `cli init --config <路径> --base-url <地址> --model <型号> --key-env <环境变量名>`；连接须验证成功才保存，已配置资料不会覆盖。独立CLI仍服从阶段开关；上例使用现有OS显式CLI入口。`profile init` 拒绝未知非空目录，保留原文件；同一初始化中断后可重试，损坏声明或配置会报错。不会自动搬迁旧资料或复制私人提示词。

实际服务在文件操作前 `Bind(config)`，路径查询只消费固定绑定；进程入口用 `Use(config)` 固定提示词作用域，同进程拒绝并行切换不同资料根。缺失个人提示词层使用公开默认；用户明确选择的外部提示词目录继续生效。工具与子代覆盖在 `Overrides/Prompt`，配置和缓存在 `Config`，会话在 `Sessions`，附件在 `Assets`。

离线迁移使用同一主工程入口，先退出使用该资料的客户端与服务，再执行：

```powershell
& './Aieyra OS.exe' cli profile migrate --from-config '../aieyra-old-data/Config/config.json' --root '../aieyra-user-data'
```

目标必须为空或属于同一次中断迁移。命令复制配置、提示词、38类资料及未知文件，保留原件，逐文件校验 SHA；不打开或改写数据库、原始会话和历史请求。旧绝对引用由共同路径映射在文件消费时解析，包括提示词、附件、会话工作目录、补丁与工作流执行；外部目录不迁移。已有统一资料根也可再次搬家，保留资料身份和此前映射。Config 与 Data 同时存在非空旧记忆目录时拒绝混合数据库。

进程使用登记、旧进程检查和原生文件锁共同检查写者是否退出。中断后重跑原命令；完整校验后才标记目标可用，并让旧启动入口跟随经双端回执验证的新配置。目标已经启用时，恢复只补交接，不覆盖新写入。源码或目标冲突、损坏记录、链接和写入失败保留两边资料并报告错误。

放弃未启用的迁移可用 `profile cancel --from-config <旧配置> --root <目标>`。这会恢复旧入口并保留部分复制内容；再次迁移选择空目标。已经启用的新根不能用该命令撤回。目录所有权不授予递归删除权限，迁移不会清空原资料。

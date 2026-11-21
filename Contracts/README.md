# 扩展契约

`mod.schema.json` 是编写清单的编辑器辅助；Core/modules 的校验器是安装、CLI 和桌面的共同执行边界。Schema 只检查结构，不替代路径、签名、文件摘要、依赖、权限和实际运行时检查。

当前实际接通 Program、Theme、Tool、Toolbox、Workbox、Agent、API、Context 和独立 Halo。Theme 契约为 `1.4.0`、Program 为 `1.2.0`、Tool 为 `1.1.0`，其余运行契约为 `1.0.0`；通过 `"Aieyra OS.exe" cli mods` 的 `capabilities` 请求查询当前宿主能力。没有实现的类型或版本会报告不兼容；清单能解析不等于可以执行。CLI 的 `mods` 命令管理 Desktop 目标，程序页面仍由桌面宿主打开。

`protocol` 是消息、模型事件、用量、工具定义和终端宿主接口的唯一 Go 类型源，已从 Core/protocol 移入。API、Core、工具和 CLI 共同引用；Core 对外别名保留调用兼容。模型事件编号与用量字段存在性语义保持原值，缓存未知与明确零命中仍分开传输。

包入口是文件夹或 ZIP 根目录的 `manifest.json`。每个载荷文件必须声明 SHA256 与字节数；不允许额外文件、链接、Windows 保留路径、大小写冲突、越界路径。上限为 2048 个载荷、64 MiB 总载荷、1 MiB 清单。版本先支持三段正式版、精确值、`*`、`^`、`~` 以及空格连接的比较；预发布和版本并集会明确拒绝。

身份由 `id`、`publisher`、类型、来源和签名公钥共同约束。`local` 允许未签名的作者开发包；`third-party` 要求 Ed25519 签名；签名证明内容与更新来源连续，不认证现实作者身份。导入者不能自报 `official`；`aieyra` 名称空间必须匹配宿主编译的官方摘要目录。更新不允许同版本不同字节，不自动扩大权限，不自动迁移资料格式。

签名内容是去掉 signature 后由 Core Manifest 类型正规化的 JSON：映射键按 UTF-8 字典序排序，不加空白，JSON 字符串中的 `<`、`>`、`&`、U+2028、U+2029 使用小写 Unicode 转义；非可选空字段保留为 null。签名字节为 UTF-8，公钥和签名用标准 Base64。SDK 打包器产生同一格式。包内容身份是 Core 对完整 Manifest 正规化序列化后的 SHA256；客户端使用 inspect 返回值，不能用原文件排版后的摘要代替。

变更须携带 `request_id`、`expected_revision`、`expected_digest`。安装默认停用；启用要求逐项匹配清单的授权。相同请求重放返回原结果与原 revision，不夹带当前状态；当前状态用 list 查询。临时导入目录不会成为有效安装，登记文件用原子替换，跨进程锁在进程退出时由系统释放。

依赖版本在检查报告中显示，实际激活图锁定不可变摘要。更新整个依赖图在同一次登记提交中完成；运行消费者不能把旧版本文件与新版本清单混用。停用/卸载必需依赖会拒绝；可选而停用的依赖不参与解析。resolve 再核对所有实际依赖载荷与授权。默认保留前一版本和用户资料，卸载仅撤销登记。超过 10000 个登记操作或 16 MiB 登记记录会拒绝新变更，保留原记录；自动归档尚未实现。

来源目录与安装载荷分开：官方源码在产品模块目录，本地和第三方作者资料与安装对象由共同 storage 布局解析。旧配置使用 `Data/Modules` 和 `Data/Packages/objects/<digest>`；统一资料根使用 `Packages/sources` 和 `Packages/registry/objects/<digest>`。离线迁移、恢复与取消命令见 [storage](storage/README.md)，导入包不会自行搬迁资料。

Workbox 定义归包，实例、依赖摘要、执行回执与图片用量归 `storage` 映射的私人 workflows 目录，用户产物归所选工作目录。主窗口以稳定私人服务身份持有工作流及其专职 Agent，服务按需获取系统租约；停用或卸载包保留已有实例和资料，更新不会改绑已保存的步骤。窗口重开只恢复事实，不重放工具副作用；未确认的外部结果保持 unknown。详细契约见 `Tool/workbox/README.md`。

# 独立光圈、SDK与模块协约

全局导航见[工程地图](../工程地图.md)；代码位置说明职责，实际构建、GUI和动画分别验收。

## 光圈的实际分工

| 入口 | 职责与消费者 |
| --- | --- |
| `Halo/contract/definition.go`、`definition.mjs`、`cases.json` | Go准入与浏览器共享图层、状态/形态和有界关键帧语义；Schema在`Contracts/halo.schema.json` |
| `Halo/runtime/desktop.mjs`、`transition.mjs` | 同一文档渲染、状态/切页过渡、隐藏暂停、减少动效与释放；宿主注入几何和motion |
| `Halo/runtime/settings.cjs` | 独立选择CAS、精确摘要与可恢复默认；不改Theme或角色资料 |
| `Halo/official/instrument.mjs`、`instrument.css`、`effects.mjs` | 全角色完整SVG、外圈/圈内状态、独立长等待计时与工具信号；身份几何归identity.css，旧surface/shell重复样式退役 |
| `Halo/official/classic`、`Core/extensionhost/official.go` | 共同Mod清单和宿主编译摘要；名字/路径/自报official不能授予官方来源 |
| `SDK/examples/halo-prism` | 作者声明式图形和动画样板，经相同导入、启用、应用、停用/回退服务 |

Theme拥有页面布局与内容样式，Agent拥有身份和真实工作状态，Halo拥有光圈图形/动画。更换光圈不修改名字、头像、模型或用户停用角色；默认左侧大头像、三角色和无字母占位要求保持。光圈不是主题配色的附属CSS，也不能用Theme场景通过替代Halo实际动画。

包停用/更新/损坏时当前投影回默认并保留原选择，恢复同摘要可继续，不自动选另一个版本。原生浮窗只接收已验证公共选择。动画验收需随时间观察脉冲/轨道/涟漪、状态切换、隐藏暂停和释放，单张静态图不能证明动画在运行。单帧、连续帧与实际操作结果分别记录。

## 作者工具与精确载荷

`SDK/tools/package.cjs`计算实际载荷SHA/size，并可用包外Ed25519私钥签名。Node正规化必须与Core Manifest完全一致，包括数字键、Unicode及可选空字段；需验证Core签名及CLI安装/升级/回退/篡改/换钥拒绝，不能简化为“JSON都能签”。

16个样板的作用和依赖在[SDK说明](../../SDK/README.md)及[样板协约](../../SDK/examples/AGENTS.md)逐包说明：程序、五种主题参考、Tool/Toolbox、三种Workbox、两种Agent、API、Context和Halo。先导入启用依赖，再操作组合包。包更新不迁移现存私人实例，不扩大权限，也不以安装成功替代每种运行能力验收。

Agent官方角色、Halo经典包和每个SDK样板具有精确manifest载荷。工作协约放在其上层，明确覆盖各包及资产/提示词子树；不能为了“每个目录都有文件”向包内插入AGENTS或临时材料，造成未声明文件、摘要变化或官方来源失配。作者实际复制制作在自己的工作目录进行，私钥/Key/私人提示词、模型连接与会话均留包外。

## 协约和地图怎样维护

[机读地图](../工程地图.json)逐项记录模块ID、真实目录/入口、就近AGENTS、依赖、资料所有权、验证入口和未完成事实。`active`只表示有实际实现；`compatibility`是仍有消费者的兼容层；`contract`为未实现或未迁入的接点。Client/Desktop已经实际迁移、构建并验收；Client/Mobile只有契约，不能标成已实现App。

自有独立职责使用具体协约。源码内的contract/runtime、执行模块和平台桥分别写输入输出、权限/资料边界及实际消费者；上层协约具体覆盖测试、样例资产和供应商依赖，避免无差别在第三方包中生成文档。AIDEBUG的core/scenes/providers/fixtures/lab/verification/tools/test八个子模块各有协约和地图条目，各自负责执行、观测与证据边界。当前路径校验由`scripts/check-project-map.py`执行，代码依赖由`scripts/check-modules.py`检查，两者都不证明GUI/真实模型或全工单完成。

现行开发约束以根AGENTS为准，Control/Link旧协约中的guard/claim/候选/晋升已退出当前流程。工程地图与专题页不能再要求历史机制，也不能删除历史失败或重写旧采样SHA来制造“全绿”。官方登记、Session恢复、Desktop、真实供应商与性能分别验证，不从部分结果推断整体通过。

createRoleRing、首页presence、设置、历史和原生投影均挂同一完整instrument。Halo/runtime/desktop负责经典与Mod转换及生命周期；修改头像只替换face。预览头像的SVG不受通用图标尺寸约束。stage/work-selection以真实运行回执保持工具状态，展示不依赖Core的执行计费分类；侧栏后的可用空间决定左右/上下排布。新场景halo-state-user与work-preview-user分别验证动画和真实工作回执；不能把注册等同验收。

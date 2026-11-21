# 工具与工作流 · 工作协约

遵循[根协约](../AGENTS.md)；当前职责与迁移边界见[工程地图](../docs/工程地图.md)。本文件覆盖本目录中没有更近协约的自有子目录，测试、样例资产和第三方依赖不因此成为独立执行模块。

入口：[package.go](contract/package.go)、[definition.go](base/official/terminal/definition.go)、[definition.go](workbox/definition.go)、[README.md](README.md)。

职责：base 管日常原子工具，toolbox 管强能力如 imagegen，workbox 管组合步骤/审阅/恢复；contract/runtime/presentation 承担共同包、受限执行输入和双端回执。

依赖与接口：工具只依赖自身/Contracts，Core 注入授权、PTY/进程、恢复目录、图片批次和提交；呈现不反向导入执行器。

资料与状态：说明、schema、实现、完整回执及可视化属于一个能力；资料与用量由宿主归属，不在工具源码旁写运行记录。

开发与验收：在本目录所属 Go 模块根串行执行 GOMAXPROCS=1 GOFLAGS=-p=1 go test ./... 与 go vet ./...，并检查 gofmt；跨宿主变更再执行 scripts/check-modules.py。修改后在 Client/Desktop 执行 npm run -s syntax 和 npm run -s selftest；界面变更按 docs/UI协约.md 选择受影响 AIDEBUG 场景，在源码冻结期间实看原生图。 运行/取消/未知/失败与 Desktop/CLI完整回执等价验证，安装可见不等于工具实际可用。

兼容与交接：旧工具 ID/手册覆盖保留；新包缺视图或文本回退不算兼容，更新不能重绑旧调用或重放副作用。 修改接口时一起核对调用者、交付清单和对应专题地图；未实际验证的范围保持未验，不以目录存在或安装成功代替运行验收。

官方基础工具与imagegen由catalog.json定位，各能力目录包含manifest/native声明、原实现、手册及双端呈现。packages.go只读取清单声明的公开载荷；native/1须匹配宿主编译认可的完整摘要，不热加载导入的Go。基础工具保留原ID和调用协议，不要求开启Toolbox；动态JS包继续使用版本化mod身份。新操作经共同登记准入，原回执与已接纳cell不换绑，既有进程只读/取消及图片批次status/list/recover在停用后仍可调用。修改载荷需更新该目录manifest摘要并成套构建；修改源码不等于正在运行的宿主已经更新。

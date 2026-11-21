# 资料布局公共契约 · 工作协约

遵循[根协约](../../AGENTS.md)；当前职责与迁移边界见[工程地图](../../docs/工程地图.md)。本文件覆盖本目录中没有更近协约的自有子目录，测试、样例资产和第三方依赖不因此成为独立执行模块。

入口：[areas.json](areas.json)、[paths.go](paths.go)、[paths.cjs](paths.cjs)、[README.md](README.md)。

职责：38类分区、旧/统一资料根路径、归属/保留策略和迁移 origin 供 Go 与 JS 同读；不做实际搬迁。

依赖与接口：Core/platform 与 Desktop/src/paths 消费；Core/userdata 执行离线迁移，业务所有者实施权限和删除。

资料与状态：只有有效 .aieyra-userdata.json 使用新布局；Bind 固定配置所有者，旧 Data/Config 继续兼容；声明不授权递归删除。

PreviousPaths只返回经正向迁移映射回验的旧路径身份，保留Unicode和原大小写；不授权读取旧根。连续搬迁可有多个旧名，业务所有者必须依据现存持久记录核对归属，不按映射排列顺序任选。

开发与验收：在 Contracts 运行 go test ./storage、go vet ./storage；路径/旧引用/双次搬家还需 Core userdata 与 Desktop 对应测试。

兼容与交接：路径解析不得创建空库替代旧库；不打开真实 SQLite，不自动移动外部目录或改写历史正文。 修改接口时一起核对调用者、交付清单和对应专题地图；未实际验证的范围保持未验，不以目录存在或安装成功代替运行验收。

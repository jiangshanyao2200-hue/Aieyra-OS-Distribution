# 共同包登记与事务 · 工作协约

遵循[根协约](../../AGENTS.md)；当前职责与迁移边界见[工程地图](../../docs/工程地图.md)。本文件覆盖本目录中没有更近协约的自有子目录，测试、样例资产和第三方依赖不因此成为独立执行模块。

入口：[manager.go](manager.go)、[manifest.go](manifest.go)、[package.go](package.go)、[object.go](object.go)。

职责：唯一包服务负责文件夹/ZIP检查、身份/签名/摘要、版本依赖、授权、登记、resolve、启停、升级回退和卸载。

依赖与接口：消费 Contracts/mod.schema.json 对应结构和宿主类型验证器；Desktop 市场、CLI 和模型经同一服务，不另写一套安装器。

资料与状态：不可变载荷与 registry/source 分开，经 storage 映射定位；卸载保留用户资料，原子登记和跨进程锁防止半写。

随附默认包：defaults.go 在共同锁内一次登记并按依赖启用；只接受宿主编译信任目录，执行同一兼容与环检查。客户端不支持的包延后登记，不消耗默认标记。已登记版本、停用、卸载和授权以用户现状为准；普通默认包不自动升级或重装。宿主明确列出的原生 Program 随宿主同步到更高版本的编译载荷，保留停用、卸载、权限、资料 schema 与旧对象；仅更新软件登记，不启动程序，不让旧摘要获得当前执行权。installed.json 的 schema 2 持久保存 defaults 标记，读者兼容 schema 1；旧写者必须拒绝 schema 2，不能降级丢失卸载记录。登记不创建 Agent 实例或启动程序。

开发与验收：在 Core 执行 go test ./modules、go vet ./modules；核对同版本不同内容、签名换钥、路径/链接、依赖及 revision/request_id 重放拒绝。

兼容与交接：SDK 签名字节与 Core 正规化一致；更新不可自动扩权、改绑定摘要或迁移数据 schema，未知结果先查原请求。 修改接口时一起核对调用者、交付清单和对应专题地图；未实际验证的范围保持未验，不以目录存在或安装成功代替运行验收。

宿主可注入LoadSource格式适配，仅用于inspect/install输入；内部不可变对象仍必须由Load按现代清单读取。ReadSourceFile统一有界普通文件、链接及取消检查；适配结果再走FromFiles和所有既有身份/授权/事务规则。

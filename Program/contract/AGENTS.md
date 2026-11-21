# 程序模式与操作契约 · 工作协约

遵循[根协约](../../AGENTS.md)；当前职责与迁移边界见[工程地图](../../docs/工程地图.md)。本文件覆盖本目录中没有更近协约的自有子目录，测试、样例资产和第三方依赖不因此成为独立执行模块。

入口：[definition.go](definition.go)、[program.schema.json](../../Contracts/program.schema.json)。

职责：定义程序入口、三种使用模式、操作/schema和能力声明，为共同兼容与沙箱提供输入。

依赖与接口：不依赖 Electron/桌面/私有资料；Core/extensionhost 校验，Program/runtime 执行受控界面操作。

资料与状态：只描述公共包能力；包内没有用户身份、连接凭据或实际授权。

开发与验收：在 Program 运行 go test ./contract、go vet ./contract；模式/操作变更验证宿主准入、SDK notebook 与人机权限拒绝。

兼容与交接：安装或自报模式不授予控制权；新增操作必须兼容版本与受限消息端口。 修改接口时一起核对调用者、交付清单和对应专题地图；未实际验证的范围保持未验，不以目录存在或安装成功代替运行验收。

浏览器、服务器和Link使用各自manifest/program.json作为包与导航来源，Core编译实际业务载荷摘要，默认登记保留用户停用/卸载；Program/runtime/native.cjs只调用宿主注入的适配器。每次新操作共同resolve并核对安装包和正在执行的Program源码，停用释放页面、浏览标签或SSH连接，私人资料保留。native声明只适用于宿主认可的精确官方版本，第三方仍走沙箱，不凭字段获得宿主权限。
本协约说明职责，不能代替实际验收结果。

legacy.go负责旧aieyra-resource/1与aieyra-bundle/1的纯转换；核原始摘要、大小、路径与显式HTTPS origins，生成human模式共同包。没有旧发布者签名，不能凭转换获得第三方或官方信任。读取文件与最终Mod兼容/授权仍归Core。

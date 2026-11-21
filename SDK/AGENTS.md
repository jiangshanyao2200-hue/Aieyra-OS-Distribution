# Mod 作者工具与样板 · 工作协约

遵循[根协约](../AGENTS.md)；当前职责与迁移边界见[工程地图](../docs/工程地图.md)。本文件覆盖本目录中没有更近协约的自有子目录，测试、样例资产和第三方依赖不因此成为独立执行模块。

入口：[README.md](README.md)、[package.cjs](tools/package.cjs)、[theme-catalog.cjs](tools/theme-catalog.cjs)、[manifest.json](examples/program-notebook/manifest.json)。

职责：提供16个真实样板和共同清单/摘要/签名打包器；examples按包类型说明组合依赖，tools维护作者产物和目录Schema同步。

依赖与接口：作者包经Core共同注册器检查，不能自报official；模板运行能力仍由对应模块与宿主负责，安装成功不等于全部运行通过。

资料与状态：作者在自己的工作目录复制样板，Key/私钥和用户资料在包外；不把工程内样板改成私人运行目录。

开发与验收：用 node SDK/tools/package.cjs <作者目录> [包外私钥路径] 打包；签名改动对照Core/modules签名测试与完整作者闭环，不重复未受影响验收。

兼容与交接：manifest与定义ID/依赖/契约版本一起改变，内容改变必须增版本；同版本不同字节、换发布者Key和篡改拒绝。 修改接口时一起核对调用者、交付清单和对应专题地图；未实际验证的范围保持未验，不以目录存在或安装成功代替运行验收。

# 作者打包与目录生成 · 工作协约

遵循[根协约](../../AGENTS.md)；当前职责与迁移边界见[工程地图](../../docs/工程地图.md)。本文件覆盖本目录中没有更近协约的自有子目录，测试、样例资产和第三方依赖不因此成为独立执行模块。

入口：[package.cjs](package.cjs)、[theme-catalog.cjs](theme-catalog.cjs)。

职责：package.cjs生成载荷SHA/size并可选Ed25519签名；theme-catalog从Theme元素目录维护作者Schema/生成资源。

package.cjs的--export仅导出已经声明并逐项核验的载荷，保留原清单/签名。拒绝路径穿越、大小写别名、链接、内容变化和已有目标；不能用重新pack官方目录冒充原摘要导出。Client/Desktop/test/sdk-package-export.test.cjs覆盖此边界，实际导入仍由Core严格校验文件全集。

依赖与接口：签名正规化须与Core Manifest结构相同，数字键/Unicode/可选空字段必须精确；不以JSON.stringify直接冒充Core正规化。

资料与状态：私钥只按包外路径读取，不打印、不复制进包；打包不安装、启用、运行或自动升级版本。

开发与验收：脚本语法走Desktop syntax；签名修改用Core/modules/sdk_signing_test.go的跨语言边界校验及作者闭环，生成后检查Schema与运行时目录一致。

兼容与交接：不能为让样板通过降低签名/文件全集/未知字段规则；作者错误需明确而不吞掉。 修改接口时一起核对调用者、交付清单和对应专题地图；未实际验证的范围保持未验，不以目录存在或安装成功代替运行验收。

# 主题运行与恢复 · 工作协约

遵循[根协约](../../AGENTS.md)；当前职责与迁移边界见[工程地图](../../docs/工程地图.md)。本文件覆盖本目录中没有更近协约的自有子目录，测试、样例资产和第三方依赖不因此成为独立执行模块。

入口：[layout.mjs](layout.mjs)、[settings.cjs](settings.cjs)、[overrides.cjs](overrides.cjs)、[recovery.cjs](recovery.cjs)、[official-library.cjs](official-library.cjs)、[media-preferences.cjs](media-preferences.cjs)。

职责：layout/markdown/thinking/media 复用并移动业务节点；settings/projection/overrides/presets 管配置CAS和三方合并；assets/preview/sounds 管受限资源与生命周期。

依赖与接口：宿主注入 motion、路径、原子写入和可信呈现能力；不读取模型凭据，不自行创建任务或替换业务事件。

资料与状态：预览选择不落盘，隐藏/关闭撤销快照；声音默认关闭且初始/重开快照不重放；用户改动和撤销记录独立保留。官网媒体通过宿主固定来源与原生签名访问，校验摘要/尺寸并重新编码；缓存只存原PNG且有数量和容量上限。随机计划归个人资料CAS，保存截止时间、预占轮换请求、迟到结果不得覆盖后续手选；离线保留图片并退避。宿主关闭释放定时器和账号订阅。

applyTextOverrides的段距覆盖保留段落间距，由共同Markdown渲染器清零终段；不能对末段生成!important段后距，造成追尾空白把折叠末行推到裁切之外。用户保存覆盖、默认主题与原生表面须同场检查，普通CSS规则通过不代表已覆盖个人优先层。

开发与验收：修改后在 Client/Desktop 执行 npm run -s syntax 和 npm run -s selftest；界面变更按 docs/UI协约.md 选择受影响 AIDEBUG 场景，在源码冻结期间实看原生图。 覆盖停用/损坏回退、冲突/撤销、流式增量、原生窗口热更新、媒体位置与隐藏释放。

兼容与交接：主光圈与角色开关不由主题改变；恢复按钮和 Ctrl+Shift+F12 在主题失效时仍可达。 修改接口时一起核对调用者、交付清单和对应专题地图；未实际验证的范围保持未验，不以目录存在或安装成功代替运行验收。

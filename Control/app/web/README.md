# Control 当前界面

入口 `index.html` 加载 `styles.css`、`aieyra-theme.css`、`link-page.css` 和 `office-home.js`。只有一个视图：顶部态势字幕（`ticker.js`，内容由 `situation.js` 算出，OS 宿主共用同一份）、右上角连接信息、立体工位与头顶气泡；点工位看详情（工单分组、发言记录 简约/详情）。消息与任务管理由 Agent API 完成。

模块职责：

- `office-home.js`：只读获取、轮询、详情与交互。
- `office-home-model.js`：稳定代号、布局和消息整理。
- `station-model.js`：工位状态、排序、既有配色。
- `model.js` / `dom.js`：实际使用的格式、任务状态和 DOM 工具。

共享样式统一维护；`refinements.css` 中仍使用的规则已按原层叠顺序合并进 `styles.css`。后端兼容协议继续存在，不依据前端删除推断 API 已废弃。通信租约、任务租约和最后上报分别展示；未知执行状态不能显示为正在工作或断言停工。

在无桌面显示/音频的 WSL/Linux 中运行 `npm test --prefix tests/web`；`test:live` 只读验证指定本机服务，`test:cloud` 使用隔离官网夹具。详见 `docs/aidebug.md`。旧画布测试不作为当前命令提供。

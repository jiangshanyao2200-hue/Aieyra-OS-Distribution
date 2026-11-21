# Link 接入与私有适配

完整流程见 [接入与自检手册](../Control/app/docs/OFFICE_ADAPTERS.md)：本人身份恢复、Windows/WSL环境选择、专属适配安装、实际自收与双向回执、失败排查和下次恢复。实时协议以办公室 `/api/office/guide` 为准。

后台办公室与窗口所有权：统一宿主允许显示由既有 Link 后台服务持有的办公室，不再因 `owner_kind=link` 拒绝打开窗口。进程所有权仍由原 owner 持有；借用页面的桌面退出不关闭后台办公室。专项 `link-shared-office-user` 覆盖 OS 内打开、桌面启动器复用、独立冷开/重开和原服务保留，实际成绩以该场 evidence 与看图回执为准。

界面与双入口回归见 [AIDEBUG 的 Link 专项](AIDEBUG.md#link-专项回归)。`link-workstations-user` 检查工位缩放及同一办公室连续性，`link-layout` 检查独立/内嵌窗口，`link-reading` 检查阅读与历史，`link-eyra-wake` 检查通知链路；独立发行包用 `link_package` 套件。界面、原生通信和发行包的实际验收分别保存，不从一项通过推断全部可用。

布局与入口：工位按容器真实内容宽度缩小，缩放后的小数宽度由 ResizeObserver 保留，空间确实不足时再换行。独立窗口放回 OS 后再次打开，必须重新提交原生页可见状态，不能沿用放回前的矩形缓存。`link-workstations-user` 在调整尺寸之前检查原生页面确已绘制，并核同一会话、办公室及未重载页面；仅 DOM 存在不算入口恢复成功。实际验收按该构建 evidence 与原生图记录，未验场景不计通过。

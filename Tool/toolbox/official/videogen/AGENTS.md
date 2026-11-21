# 视频生成工具 · 工作协约

遵循[根协约](../../../../AGENTS.md)。入口为[definition.go](definition.go)、[manual.txt](manual.txt)，共同工具目录负责发现，Core负责真实会话身份、持久任务及连接准入，API/videos负责供应商协议和媒体检查。

create只保存请求，submit只提交未发送任务；未知提交、取消和重开都不能自动重投。查询始终绑定原连接及公开任务ID，下载失败不重新生成。工具摘要不得包含密钥、签名URL或原始供应商正文。实际尺寸、时长和编码来自下载文件，逐帧解码及播放独立验收。

手册纳入提示词索引和公共隐私哈希；公开载荷改变须更新manifest并重建宿主。停用后允许status/list/recover，以及原任务query/download；不允许create/submit。私有记录归Contracts/storage的video_tasks，不写源码目录。

验证运行Tool对应包及Core持久任务回归，覆盖同号改义、跨会话、未知提交、重开、原连接变更、取消和下载恢复。桌面与CLI沿共同回执显示完整事实；真实供应商未验不能以夹具通过代替。

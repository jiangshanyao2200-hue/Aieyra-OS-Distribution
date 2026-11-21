# 随程序提供的字体

Inter、Sora、Noto Sans SC 和 Noto Serif SC 均使用 SIL Open Font License 1.1。每个字体旁保留完整上游 OFL.txt，包括版权和保留字体名称条款；字体许可与应用许可分别适用。

字体来自 Google Fonts 的固定提交 `9710da1eacb3be272583c3224dcb70f9da6eadbb`，仓库为 https://github.com/google/fonts 。具体源文件、完整许可地址、SHA256、字重轴及转换方式见 manifest.json。

`*-variable.woff2` 包含完整上游字库。桌面样式优先加载两款 Noto 字体的 `*-common.woff2`，覆盖 GB2312 一级汉字、常见标点和拉丁字符，其余字符按原字重从完整字库加载。子集沿用相应的 OFL 许可。样式表使用 Aieyra CSS 字族别名，字体随应用离线加载。缺失文件时仍按系统候选字体链回退。

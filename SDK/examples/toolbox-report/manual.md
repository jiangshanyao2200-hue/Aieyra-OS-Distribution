在 workdir 中以 apply_patch 新建 file 指定的 JSON 报告，返回文件说明和统计表格。
输入 {"values":[2,3,7],"workdir":"用户授权的绝对工作目录","file":"report.json"}。
file 只能是简单 JSON 文件名，最多 10000 个有限数字。已有文件不会覆盖。
本包要求用户授予 tool.invoke/apply_patch，当前角色也必须有 apply_patch 权限；wait 查询随已获授包能力提供。
安装不等于启用；list 发现版本、open 载入手册后方可 call。
执行中的 cell 用 wait(cell_id) 查询或 terminate=true 取消；取消和未知结果不代表文件操作被撤销，请先检查回执和实际文件，不要盲目重做。
更新或停用只影响新调用，已接受的操作仍沿原 cell 查询。

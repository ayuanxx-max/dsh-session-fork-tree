# 实施任务

1. [x] `client.js`：横线长度改为常量 `RAIL = 10`，移除按父间距推导
2. [x] `client.js`：`shift = naturalElbow - RAIL`，`pad = naturalPad - shift`（同一处计算）
3. [x] 遥测：输出 `elbowW`、`shiftW`、`pad`、`aligned`
4. [x] 闸门 `tools/check-fork-tree.ps1`：`openspec validate` + 遥测断言
5. [x] 本地安装 `@local/fork-tree` 并验证（**不发布**）
6. [x] 用户确认后 `openspec archive`

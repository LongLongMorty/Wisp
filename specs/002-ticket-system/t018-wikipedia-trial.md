# T-018 真实站点试用：维基百科

## 目标

- 站点：`https://en.wikipedia.org/wiki/Ada_Lovelace`。
- 提议的任务：读取当前页面，提供 Ada Lovelace 的出生日期和职业。
- 试用结果：用户提供的记录显示完成验证失败，后续操作进入 `ACTION_FAILED`；最终返回 `failed / BUDGET_EXCEEDED`。

## 用户提供的事件

`CREATED` → `STARTING` → `OBSERVED` → 观察网页 → 预算更新 → 模型调用 → `PREPARED` → `DISPATCHING` → `finished` → 观察网页 → 预算更新 → 模型调用 → 验证 `failed` → 观察网页 → 预算更新 → 模型调用 → `PREPARED` → `DISPATCHING` → `ACTION_FAILED` → `finished` → `STARTING` → `OBSERVED` → 观察网页 → 预算更新 → 模型调用 → `PREPARED` → `DISPATCHING` → `OUTCOME_UNKNOWN` → `unknown` → `USER_ACKNOWLEDGED` → `STARTING` → `OBSERVED` → 预算更新 → `FAILED`。

事件中的四次模型调用分别为 5,905/141、6,463/160、5,955/107、5,936/196 输入/输出 tokens，合计 **24,259 输入、604 输出、24,863 tokens**；这是已展示的模型调用用量合计。

## 已知与待核实

- `finished` 为动作阶段，不能单独证明操作成功；`ACTION_FAILED` 表示运行时记录了动作错误，但现有事件未提供错误码、动作类型、验证条件或失败原因。
- 用户确认暂停时页面上出现目标信息；恢复后事件出现 `OUTCOME_UNKNOWN` 和 `USER_ACKNOWLEDGED`，随后任务再次启动并返回 `failed / BUDGET_EXCEEDED`、`retryable: false`。
- 用户估计从开始到失败经过“好几分钟”，没有精确时长。默认运行时间上限为 300,000 毫秒；当前实现从首次开始计墙钟时间，暂停和等待人工处理的间隔也会在恢复时计入。因此超时是可能原因，但该描述不足以确认是否超过五分钟或排除其他预算。
- 未提供完整页面变化、总耗时、各动作内容及预算指标；不能据此认定 Wisp 已正确提取或任务完成。错误码对应多种预算或限制，现有记录不能判断具体哪一项。
- 页面上出生日期、职业可参考[维基百科词条](https://en.wikipedia.org/wiki/Ada_Lovelace)核验；尚不代表 Wisp 已正确提取。

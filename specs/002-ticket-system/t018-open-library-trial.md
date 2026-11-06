# T-018 真实站点试用：Open Library

## 试用目标

- 站点：https://openlibrary.org/
- 任务：搜索《Pride and Prejudice》，打开 Jane Austen 的作品页面，提取书名和作者。
- 结果：失败，错误码 `DISCONNECTED`，`retryable: false`。

## 用户提供的执行记录

1. 任务状态：`CREATED`
2. 任务状态：`STARTING`
3. 任务状态：`OBSERVED`
4. 观察网页：`OBSERVED`
5. 预算记录：预算已更新
6. 预算记录：预算已更新
7. 任务状态：`FAILED`

记录中未显示模型调用或页面操作事件；这不足以证明模型请求未发出或页面没有发生变化。

## 待补充证据

- 试用日期、耗时、模型配置（不含密钥）、模型调用和 token 用量。
- 是否需要人工接管，以及页面是否发生变化。
- 失败时扩展 Service Worker 的脱敏控制台错误和模型请求的网络状态。

`DISCONNECTED` 在多个组件中使用；仅凭现有记录无法确定断连位置或根因。不得将本次试用记为成功，也不能据此认定 Open Library 兼容性。

## DeepSeek 配置后的再次尝试

- 事件顺序：`CREATED` → `STARTING` → `OBSERVED` → 观察网页 `OBSERVED` → 预算更新 → 模型调用 → `PREPARED` → `DISPATCHING` → `POLICY_STOP` → `abandoned`；用户看到任务已暂停。
- 模型调用用量：输入 8,868 tokens，输出 201 tokens，合计 9,069 tokens。
- 模型调用已有用量记录；操作被策略流程中止。现有记录未显示策略具体原因、目标元素、页面实际变化、耗时或人工接管情况，不能据此判定与 GitHub 试用的原因相同。
- 试用尚未完成；需要继续记录恢复或接管后的结果，以及书名和作者的核验情况。
- 用户确认暂停时页面尚未输入书名。

## 后续结果

- 用户随后提供的结果为 `completed`，摘要为书名 **Pride and Prejudice**、作者 **Jane Austen**。
- 结果含作品页 `https://openlibrary.org/works/OL66554W/Pride_and_Prejudice?edition=key%3A/books/OL39115287M` 的 URL 和两条文本匹配证据，捕获时间为 `2026-11-06T13:08:08.366Z`。
- 独立核对 Open Library 同一作品 ID `OL66554W` 的[书目记录](https://openlibrary.org/books/OL48108855M/Pride_and_Prejudice)，书名与作者相符。原始带 edition 参数的页面未能通过核对工具直接打开。
- 用户确认暂停后手动搜索了书名；结果属于人工协助完成，不能计为全自动成功。具体暂停原因仍未知。
- 用户提供完整事件：手动搜索后记录 `USER_PAUSE`，恢复后再次观察；一次操作进入 `CONFIRMATION_REQUIRED`，经 `APPROVING` 后完成，另一次操作完成，最后验证 `passed` 并进入 `COMPLETED`。事件未说明确认操作的具体内容。
- 四次模型调用分别为 8,868/201、9,339/222、1,771/378、8,950/196 输入/输出 tokens；合计 **28,928 输入、997 输出、29,925 tokens**。
- 总耗时尚未提供；具体策略暂停原因和确认操作内容仍未知。

## 再次尝试（相同任务）

- 目标：在搜索框搜索《Pride and Prejudice》，打开 Jane Austen 的作品页面，提取书名和作者。
- 事件：`CREATED` → `STARTING` → `OBSERVED` → 观察网页 `OBSERVED` → 预算更新 → 模型调用 → `PREPARED` → `DISPATCHING` → `POLICY_STOP` → `abandoned`，任务暂停。
- 已显示的一次模型调用用量：输入 8,867、输出 156，合计 9,023 tokens。
- 与上一次尝试同样在首次模型调用后的操作阶段出现 `POLICY_STOP`；用户确认暂停时搜索框仍为空。事件未提供操作目标和策略原因，不能据此确认两次的根因相同。接管、后续结果及耗时待记录。

## 展示原因后的真实站点复测

- 用户使用新增策略原因展示的插件，在 Open Library 执行同一搜索任务。
- 事件：`CREATED` → `STARTING` → `OBSERVED` → 观察网页 → 预算更新 → 模型调用 → `PREPARED` → `DISPATCHING` → `POLICY_STOP` → `abandoned` → “页面上下文不完整，需要人工接管。”
- 本次调用用量：输入 8,849 tokens，输出 160 tokens，合计 9,009 tokens。
- 当前实现中该提示对应策略原因码 `INCOMPLETE_CONTEXT`；这确认了本次暂停的策略分类。具体是快照截断、扫描限制还是其他因素导致上下文不完整，以及模型选择的动作和目标，仍未从本次记录中确认。
- 本次停在暂停状态，未提供总耗时、接管或完成结果。不能据此认定此前两次的原因，也不能计为自动成功。

## 超长属性摘要版用户复测

- 用户报告首次操作经确认完成，页面已打开搜索框；随后第二次模型调用后的操作进入 `POLICY_STOP`，显示“页面上下文不完整，需要人工接管。”，动作 `abandoned`，任务暂停。
- 事件摘要：观察 → 模型调用 → `PREPARED` → `DISPATCHING` → `CONFIRMATION_REQUIRED` → `APPROVING` → `finished` → 再次观察 → 模型调用 → `PREPARED` → `DISPATCHING` → `POLICY_STOP` → `abandoned` → 上下文不完整。
- 第一次调用 8,883 输入、207 输出、9,090 总 tokens；第二次 20,051 输入、467 输出、20,518 总 tokens；目前累计 **28,934 输入、674 输出、29,608 总 tokens**。
- 第一次经确认的操作已使搜索框打开；第二次具体操作、目标和上下文不完整的底层触发条件未显示，不能确定是否与先前超长属性或页面加载原因相同。
- 截至用户提供的记录，任务尚未完成；总耗时、后续接管及最终结果待记录。

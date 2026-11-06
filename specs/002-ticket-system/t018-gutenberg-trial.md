# T-018 真实站点试用：Project Gutenberg

## 任务与结果

- 站点：https://www.gutenberg.org/ebooks/1342
- 任务：读取当前页面，告诉用户书名和作者；不要点击链接、下载文件或刷新页面。
- 用户提供的 Wisp 结果：`completed`；书名 **Pride and Prejudice**，作者 **Jane Austen**。结果摘要称未点击链接、下载文件或刷新页面；事件记录没有显示动作，尚无独立浏览器层核验。
- Wisp 结果包含该页面的文本与 URL 两条 `matched` 证据，捕获时间 `2026-11-06T15:25:43.107Z`。书名和作者与 [Project Gutenberg 书目页](https://www.gutenberg.org/ebooks/1342)一致。
- 用户提供完整事件：`CREATED` → `STARTING` → `OBSERVED` → 观察网页 → 预算更新 → 模型调用 → 验证 `passed` → `COMPLETED`。记录中无动作、确认或接管事件；该记录不能独立证明浏览器网络层完全无副作用。
- 模型调用 1 次：输入 4,047、输出 196、合计 **4,243 tokens**。用户描述耗时“一瞬间”，未测量精确秒数。

## 待补充

- 若需精确耗时或进一步核验浏览器页面变化，需补充计时与独立浏览器证据。
- 本次为公开真实 Web 应用的只读场景，不能据此推断搜索、表单或写入操作的能力。

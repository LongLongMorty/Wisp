# T-018 真实站点试用：GitHub Issues

**日期**: 2026-11-03
**站点**: GitHub Issues（公开真实站点，非 fixture）
**目标任务**: 创建 issue，标题"Test from Agent"，加 label `bug`，分配给自己

---

## 试用前准备

- [x] 测试仓库地址: GitHub (真实站点 Issues 页面)
- [x] 确认仓库有 `bug` label
- [x] 确认当前 GitHub 账号有权限分配 issue 给自己
- [x] 模型配置: 火山方舟 `deepseek-v4-1-flash-economy-261017`

---

## 任务目标（给 Agent 的输入）

```
在当前页面创建一个新的 issue，标题填写"Test from Agent"，
添加 label "bug"，并将 issue 分配给自己（当前登录用户）。
```

---

## 执行记录

### 第 1 轮

| 项目 | 记录 |
|------|------|
| 开始时间 | 2026-11-03 (具体时间未记录) |
| 结束时间 | - |
| 总耗时 | 约 1-2 分钟 |
| 模型调用次数 | 2 次 |
| 总步数 | 17 步 |
| 最终状态 | **FAILED** |

**逐步操作记录**（从侧边栏"执行记录"）：

```
步骤 02: 任务状态 CREATED
步骤 03: 任务状态 STARTING
步骤 04: 任务状态 OBSERVED
步骤 05: 观察网页 OBSERVED
步骤 06: 预算已更新
步骤 07: 模型调用 {"inputTokens":19661,"outputTokens":1505,"totalTokens":21166}
步骤 08: 准备操作 PREPARED
步骤 09: 操作结果 DISPATCHING
步骤 10: 任务状态 POLICY_STOP ⚠️
步骤 11: 操作结果 abandoned ❌
步骤 12: 任务状态 STARTING (重启)
步骤 13: 任务状态 OBSERVED
步骤 14: 观察网页 OBSERVED
步骤 15: 预算已更新
步骤 16: 模型调用 {"inputTokens":9825,"outputTokens":836,"totalTokens":10661}
步骤 17: 预算已更新
步骤 18: 任务状态 FAILED
```

**Token 用量**：
- 第 1 次调用：19,661 输入 + 1,505 输出 = 21,166 总计
- 第 2 次调用：9,825 输入 + 836 输出 = 10,661 总计
- **总计**：29,486 输入 + 2,341 输出 = 31,827 tokens

**遇到的问题**：

- [x] 第 1 轮执行时遇到 **POLICY_STOP**，操作被标记为 `abandoned`
- [x] 没有弹出用户确认对话框（或用户未看到）
- [x] 第 2 轮重启后直接 FAILED，未尝试任何操作
- [ ] 未观察到模型误判页面元素的明确证据
- [ ] 未超过预算限制（30步/5分钟/40次调用）

**用户反馈**：
- 侧边栏只显示"未完成"和最终错误 `{"status":"failed","error":{"code":"TIMEOUT","message":"TIMEOUT","retryable":false}}`
- 没有看到中间过程的 Thought/Action 详细内容
- GitHub Issues 页面状态：(待补充 - 页面是否有变化？表单是否被填写？)

---

## 失败模式分类

- [x] **策略问题**：POLICY_STOP 阻止了操作执行，但未给用户确认机会
- [ ] **观察问题**：Agent 没看到正确的页面元素
- [ ] **决策问题**：Agent 理解错了任务目标
- [ ] **执行问题**：点击/填写动作没生效
- [ ] **验证问题**：Agent 以为完成了但实际没完成
- [ ] **页面特性问题**：GitHub 用了 Wisp 不支持的控件
- [x] **超时问题**：最终错误码为 TIMEOUT（但具体超时环节不明）

---

## 总结

**成功率**: 0/1 次尝试成功

**核心发现**：

1. **POLICY_STOP 根本原因：INCOMPLETE_CONTEXT（页面上下文不完整）**
   - Agent 观察 GitHub Issues 页面后，决定点击某个元素（推测是"New issue"按钮或表单字段）
   - 策略网关检查发现目标元素的上下文中包含 **> 4 个不同 origin 的目的地链接**
   - `control-document.mts:192` 设置 `complete = false`
   - `classifyPolicy` 检测到 `!context.complete`，返回 `{kind: 'handoff', reason: 'INCOMPLETE_CONTEXT'}`
   - Runtime 将 `handoff` 决策标记为 `POLICY_STOP`，操作被 `abandoned`

2. **为什么会有这么多外部链接？**
   - GitHub 页面包含大量全局导航链接：GitHub Docs、Status、API、Blog、Security、Terms 等
   - Agent 选择的目标元素（或其父容器）可能包含了这些链接
   - Wisp 的安全策略限制单次操作的目的地 origin 不超过 4 个，防止恶意跳转
   - 但这在真实复杂页面（如 GitHub）上容易误触发

3. **连续 3 轮重试都失败**：
   - 每轮都是：观察 → 模型决策 → 准备操作 → DISPATCHING → POLICY_STOP → abandoned
   - 模型每次可能决定点击相同或类似的元素，但都因 `INCOMPLETE_CONTEXT` 被拒绝
   - 第 3 轮后达到"无进展预算上限"，任务暂停

**与 fixture 测试的差异**：

- **fixture (`ticket-system`)**：
  - 页面简单干净，只有业务相关的链接和表单
  - 目的地 origin 单一（只有 `http://127.0.0.1:xxxxx`）
  - `complete` 始终为 true
  - 所有操作都能正常执行或进入确认流程
  
- **真实站点（GitHub）**：
  - 页面复杂，包含大量全局导航、外部链接、广告/推广模块
  - 单个页面可能包含 10+ 个不同 origin 的链接（Docs、Status、API、Blog、Terms、Twitter、LinkedIn...）
  - 触发 `destinationOrigins.size > 4` 的安全限制
  - 导致 `handoff`（需要人工接管），但用户界面没有清楚说明原因

**下一步建议**：

1. **放宽 `destinationOrigins` 限制或改进检查逻辑**：
   - 当前限制 `≤ 4 个 origin` 对真实网站过于严格
   - 可以改为：只检查**目标元素本身**的 `href` 或 `formAction`，而非整个上下文的所有链接
   - 或者提高阈值到 10-20 个，同时记录日志以监控是否有恶意行为

2. **改进 `handoff` 的用户反馈**：
   - 当前"已暂停"状态没有说明**为什么需要接管**
   - 侧边栏应显示："页面上下文不完整（包含过多外部链接），需要你接管或简化操作"
   - 提供"继续尝试"或"手动操作"的选项

3. **优化观察策略，减少误判**：
   - 对于"点击按钮"这类简单操作，可以只观察按钮本身及其直接父节点
   - 不需要把整个页面的全局导航都纳入上下文
   - 或者在观察时标记哪些链接是"全局导航"，策略检查时排除它们

4. **增强执行历史可见性**：
   - 显示 Agent 决定点击/填写的具体元素（文本、role、位置）
   - 显示策略决策的详细原因（不只是 `POLICY_STOP`，还要显示 `INCOMPLETE_CONTEXT`）

5. **为 GitHub 等常见站点添加白名单规则**：
   - 在 `specs/001-browser-agent/policy-v01.md` 的规则机制中
   - 为 `https://github.com` 的常见操作（点击"New issue"、填写表单）设置 `allow` 规则
   - 绕过 `INCOMPLETE_CONTEXT` 的检查

6. **文档和用户指南**：
   - 在 README 里说明：复杂页面（如 GitHub、Twitter）可能需要人工接管
   - 提供"如何在复杂站点上使用 Wisp"的最佳实践

---

**记录人**: 用户 + Claude Sonnet 5.5
**Wisp 版本**: v0.1 (commit `02118d3`)
**试用日期**: 2026-11-03

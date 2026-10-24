# 架构概览

面向准备参与开发的同学。读完你应该知道：代码分成哪几层、一次任务如何流动、哪些不变量不能破坏、以及先看哪些文件。

## 一句话

Chrome MV3 扩展提供宿主与侧边栏；受信任宿主把「观察页面 → 模型决策 → 策略确认 → CDP 执行 → 条件验证」的单步循环跑起来，并把状态、检查点和事件持久化，供 SDK 与界面复用。页面数据始终视为不可信输入，模型只能提出契约内的动作。

## 分层与依赖方向

```text
protocol            （纯数据契约 + 严格运行时校验，无业务依赖）
  ↑
browser-chrome   models   policy
  ↑                ↑        ↑
  └────────── runtime ──────┘
                 ↑
                sdk
                 ↑
           apps/extension
```

- `protocol`：类型、错误码、目标/动作/条件、Observation、ActionResult、事件信封、消息信封；解析器拒绝未知字段与超大载荷。
- `browser-chrome`：CDP 传输、isolated world 观察、私有引用注册表、脱敏、actionability、`BrowserAdapter`（observe/execute/verify/readPolicyContext）。
- `models`：脚本模型、Chat Completions 兼容适配、有限 JSON Schema 校验器。
- `policy`：origin 授权、动作分类、一次性确认绑定、执行网关。
- `runtime`：任务状态机、IndexedDB/内存 store、检查点、租约、去重、单步循环与预算。
- `sdk`：`createAgent`、任务句柄、事件回补、暂停/恢复/取消/确认。
- `apps/extension`：MV3 Background（受信任宿主）、RPC 控制器、原生侧边栏 UI。

## 一次单步如何流动

```text
侧边栏 UI
  └─ rpc(type,payload)                     host/client.ts
       └─ chrome.runtime.sendMessage        host/protocol.mts 校验信封
            └─ background request()         host/controller.mts
                 ├─ authorize(sender)       只信任原生 SIDE_PANEL 上下文
                 ├─ 去重账本（requestId）
                 └─ agent / runtime
                      └─ loop.drive → round()
                           1. 检查预算、代次、租约
                           2. observe()            → browser-chrome
                           3. 组装 DecisionInput（目标、观察、历史、允许动作、schema、宿主完成条件、预算）
                           4. model.decide()
                           5. action → 严格校验目标作用域
                                      → runtime.execute → policy 网关 → CDP 动作
                              finish → verify(条件) → 有证据才 complete
                              extract → model.extract → schema/来源/观察复核 → complete
                              ask_user → waitForUser
                           6. 写 journal / 事件 / 预算
```

界面通过 `run.get`、`run.events(afterSeq)` 读取快照、待确认项与事件；暂停/恢复/停止/接管/确认都走同一 RPC 边界，最终由运行时串行化。

## 关键不变量（改代码前务必确认）

1. **页面是不可信数据**：模型输出只能映射到契约动作，不执行任意 JS/CSS/XPath，页面文本不能修改策略或授权。
2. **严格 schema**：未知字段、未知动作、超大载荷一律拒绝；不要为兼容而放宽。
3. **引用绑定节点身份**：引用带 document/frame/observation 作用域；节点替换、导航、过期后拒绝，绝不按名称重绑同名元素。
4. **一步一动作**：每次决策最多一个动作，执行后重新观察；不以任意 DOM 变化当作业务成功。
5. **写入/未知动作默认确认**：一次性令牌绑定 origin、文档、目标指纹、参数与有效期；派发前重新读取页面并重新分类；拒绝/过期/变更后不得执行。
6. **完成必须有证据**：宿主 `completionConditions` 与模型条件取并集，URL/文本/元素/字段等有界证据通过才算完成；模型说“完成”不算。
7. **unknown 屏障**：派发结果未知时保留 `unknown`，阻止后续写入；需核对后显式解除，禁止自动重发。
8. **单写者**：每个 tab 一个租约；同 actionId 同 payload 复用结果，异 payload 拒绝。
9. **预算有界**：默认 30 步、5 分钟、40 次模型调用、连续 3 次无进展暂停；观察 24,000 字符、请求 64,000 字符。
10. **密钥只在本会话**：仅扩展受信任上下文的 `storage.session`；不进入 local/sync/任务 IndexedDB/日志/目标页；密码值不进入观察。

## 结果与错误语义

`ActionResult` 分开描述 `dispatched`（是否派出）、`responded`（页面是否有响应）、`verified`（后置条件），并附 `evidence`。不要把 `dispatched=yes` 当成业务成功。

主要错误码：`STALE_TARGET`、`NOT_ACTIONABLE`、`UNSUPPORTED_CAPABILITY`、`PERMISSION_DENIED`、`POLICY_DENIED`、`TIMEOUT`、`ABORTED`、`OUTCOME_UNKNOWN`、`MODEL_INVALID_OUTPUT`、`BUDGET_EXCEEDED`、`TAB_BUSY`、`DISCONNECTED`、`AMBIGUOUS_TARGET`。

## 状态与持久化

```text
created → running → completed / failed / cancelled
             ↕
        waiting_user
             ↓
           paused → running
```

- 检查点保存目标、tab、授权版本、状态、预算、摘要、最后动作与待确认内容；活动 DOM 引用不跨进程恢复。
- 重启后非终态任务进入 `paused`，恢复需用户触发并重新观察。
- `prepared` 重新规划；`dispatching/unknown` 先核对后置条件，不自动重放。
- journal 只保留有界元数据（不写填写值、完整观察、模型原文）。

## 建议阅读顺序

1. `packages/protocol/src/*.mts`：先看契约与错误码。
2. `packages/browser-chrome/src/document.mts`、`references.mts`、`sanitize.mts`、`chrome.mts`、`adapter.mts`：观察与动作。
3. `packages/policy/src/index.mts`：分类、确认、网关。
4. `packages/runtime/src/store.mts`、`runtime.mts`、`loop.mts`：状态机与单步循环。
5. `packages/models/src/index.mts`、`schema.mts`：模型适配与校验。
6. `packages/sdk/src/index.mts`：对外句柄与事件。
7. `apps/extension/entrypoints/background.ts`、`host/controller.mts`、`entrypoints/sidepanel/App.tsx`：宿主与界面。

## 验收与证据

- 单元/确定性测试 → 分层 Chrome 探针（observer/control/policy/runtime/loop/sdk/panel）→ 故障矩阵 → 发布级（可靠性、性能、实际模型 15 轮、人工检查）。
- 证据写在 `specs/001-browser-agent/evidence/`，绑定源码/产物哈希；失败归档保留，不静默删除。
- 具体命令与当前状态见 [验证与证据](verification.md) 和 [任务清单](../specs/001-browser-agent/tasks.md)。

## 非目标（v0.1）

多标签页任务、跨域 iframe 操作、视觉定位/截图理解、closed Shadow DOM、文件上传/下载、支付/密码/验证码自动输入、权限授予、后台定时任务。详见 [支持范围](support.md)。

# 调研：Open Library 首次操作策略暂停

## 范围与现象

T-018 中，两次在 Open Library 首页执行搜索《Pride and Prejudice》的任务，首次模型调用后均出现 `PREPARED`、`DISPATCHING`、`POLICY_STOP`、`abandoned`，用户确认两次搜索框均为空。第一次人工搜索后恢复，任务完成；第二次保持暂停。详见 [试用记录](../../../specs/002-ticket-system/t018-open-library-trial.md)。现有记录未提供模型选择的动作、目标或具体策略原因；尚未建立能够复现该次真实故障的自动反馈回路。

## 数据流与现状

1. 模型动作由循环提交给运行时：`packages/runtime/src/loop.mts:263`、`:269`。运行时先写入 `PREPARED` 和 `DISPATCHING`，然后调用策略网关：`packages/runtime/src/runtime.mts:375`、`:393`、`:405`。因此事件中的 `DISPATCHING` 本身不证明浏览器输入已经执行。
2. `packages/browser-chrome/src/control-document.mts:52` 根据观察快照和 DOM 构造策略上下文；`:54` 从快照截断状态初始化 `complete`，`:57`–`:120` 等处可因属性、扫描或大小限制将其设为 false；`:123`–`:192` 构造目标与目的地信息。当前目的地上限为 20（`:192`），不是旧 GitHub 试用报告描述的历史上限 4。提交 `ee37bf1` 和 `c45331b` 位于该历史报告之后。
3. `packages/policy/src/index.mts:65`–`:93` 依次分类：拒绝包括未授权来源/目的地、失效目标、新窗口和不可操作目标；接管包括敏感操作、不完整上下文、不支持的输入等。网关在 `:181`–`:187` 返回分类，必要时在 `:165`–`:170` 再次分类。策略决定包含 `kind` 和 `reason`。
4. `packages/runtime/src/runtime.mts:313`–`:348` 对非执行、非确认的策略决定将动作标为 `abandoned`，暂停原因统一写为 `POLICY_STOP`；日志只写状态和动作阶段。运行时的即时 receipt 可以带 decision，但持久事件未在这里记录具体策略原因；`packages/runtime/src/loop.mts:269`–`:272` 的历史摘要也未写入 decision.reason。
5. 侧边栏通过 `run.get` 和 `run.events` 拉取状态及事件（`apps/extension/entrypoints/sidepanel/App.tsx:55`–`:71`），在 `:143`–`:149` 渲染状态、确认和执行记录。现有记录因上游只提供通用暂停状态，不能区分这些策略原因。

## 现有测试与约定

- `packages/policy/test/policy.test.mjs:115` 测试不完整上下文等关闭式处理；`:124` 覆盖普通填充与不支持输入。
- `packages/browser-chrome/test/policy-context.test.mjs:10` 覆盖截断/超限导致上下文不完整；另有表单目的地测试。
- `npm test` 通过 `scripts/test.mjs` 收集各包 `*.test.mjs`；本轮为只读调研，未运行测试，也未修改业务代码。
- `packages/runtime/src/store.mts` 与事件设计包含脱敏和持久化边界；诊断信息的范围须与现有隐私约定一起评估。

## 已确认与待确认

- 已确认：目前代码将多种策略停止统一呈现为 `POLICY_STOP`；仅凭用户提供的记录无法还原具体 decision.reason。
- 未确认：Open Library 本次具体动作、目标、策略决定、是否有快照截断，以及真实站点触发原因。历史 GitHub 报告的分析不能作为这次的证据。
- 尚无原始决策或可复现的同环境运行，不能断言修复方案，也不能保证再次运行会得到相同模型动作。

## 阶段状态

Research 完成，等待确认调研对象和范围；下一阶段才比较诊断/可观察性方案，不改变策略或代码。

## 2026-11-06 真实站点追加调研

- 用户使用原因展示版复测后，事件明确显示 `INCOMPLETE_CONTEXT`；事件仍未记录模型实际选择的动作和目标。
- 独立无头 Chrome 只读探针：`node .cache/policy-stop-stage/open-library-probe.mjs`。在公开 Open Library 首页、独立临时浏览器会话内观察到“搜索”按钮；针对该按钮构造 `click` 并调用真实 `readPolicyContext` 和 `classifyPolicy`，未执行点击。两次得到 `complete: false`、`handoff / INCOMPLETE_CONTEXT`；观察本身为 `truncated: false`，`truncationReasons: []`。
- 临时诊断在该一次性浏览器的注入代码中记录触发标记，不改工作区生产代码或记录属性值。结果指向 `packages/browser-chrome/src/control-document.mts:62` 的属性长度检查：按钮属性 `data-i18n-ui` 的值长 3,186 字符，超过 2,048 字符上限；该属性被跳过并将上下文置为不完整。
- 对照实验仅在独立页面 DOM 移除该按钮的 `data-i18n-ui` 属性，再重新观察并分类同名按钮：属性移除前 `complete: false`、`handoff / INCOMPLETE_CONTEXT`；移除后 `complete: true`、`confirm / UNKNOWN_OR_WRITE_ACTION`。未点击按钮或发送表单。该对照支持超长属性是**此探针会话**的直接触发条件；它不证明用户原任务的模型确实选择了同一按钮。
- 本地探针位于被忽略的 `.cache/policy-stop-stage/open-library-probe.mjs`，使用当前构建的浏览器/策略包，需联网 Chrome；首次尝试等待完整加载超时，另一次 `Page.navigate` 发生 CDP 超时，后续尝试成功。该页面两次成功诊断时为 `interactive`，因此结果限于上述独立会话，不能泛化为全部 Open Library 会话。
- 后续需重新比较如何处理超长属性与安全绑定；暂未改变属性限制、策略或授权行为。

## 超长属性变更后的独立复测

- 隔离工作区的完整自动测试为 297 通过、0 失败；超长属性/确认的 Chrome fixture 验证通过。该代码尚未合入主工作区。
- `node .cache/policy-stop-stage/open-library-verify.mjs` 使用隔离工作区的新浏览器和策略构建，只读访问公开首页并分类“搜索”按钮。多次结果显示属性值仍为 3,186 字符，但观察返回 `truncated: true`、原因 `unsupported_content`，因此策略仍为 `handoff / INCOMPLETE_CONTEXT`。一次调用遇到 `CDP timeout`，后续复测成功。
- `packages/browser-chrome/src/document.mts:268` 对可见 iframe、canvas、无开放 Shadow DOM 的自定义元素加入 `unsupported_content`；`:280`–`:281` 将其视为观察截断，`control-document.mts:54` 用观察截断初始化上下文完整性。
- 独立会话在部分 `interactive` 时刻可见 `ol-popover`、`ol-carousel`（诊断发现二者均不包含搜索按钮）；另一次观察后这两个元素已不可见。页面在变化，元素检查与 Wisp 观察并非原子快照；目前只能把它们视为触发原因的候选，不能断言任何一个就是用户会话的原因，也不能假定无开放 Shadow DOM 等同于存在封闭 Shadow DOM。
- 原计划要求站点结果不同时重新调查；阶段 3 仍未通过，不更改自定义元素处理或绕过 `unsupported_content`。需另行确定证据及方案后推进。

## 同次观察的截断来源与加载后对照

- 临时探针 `node .cache/policy-stop-stage/unsupported-probe.mjs` 在独立浏览器的注入代码中只记录触发位置与元素标签，不采集页面文本或属性值。两次独立运行在观察当时均记录 `visible: ol-popover` 与 `visible: ol-carousel`，对应 `document.mts:268` 的自定义元素分支；不是仅依赖事后 DOM 推测。事件发生时这两个元素尚未注册，公开 DOM 有子元素，未暴露开放 shadow root；`shadowRoot === null` 不能证明不存在封闭 shadow root。
- 在同一独立会话中等待页面继续加载（最多 12 秒），稍后观察为 `truncated: false`，两个组件已注册；进一步一次在 `document.readyState: complete` 时针对同名搜索按钮读取策略上下文，得到 `complete: true`、`confirm / UNKNOWN_OR_WRITE_ACTION`。该对照使用已实现的长属性摘要，不修改页面 DOM，也未点击按钮。
- 这些证据说明独立试验中页面加载阶段会影响截断结果；不证明用户原会话的具体加载时序或模型目标。策略未更改，实际用户会话仍需复测。

## 搜索框打开后的用户复测

- 用户报告：首次操作经确认执行，搜索框已打开；再次观察和模型调用后发生 `POLICY_STOP / INCOMPLETE_CONTEXT`。第二次动作目标、观察截断原因和当时页面加载状态未显示，不能把该暂停归因于前一轮的超长属性或自定义元素。
- 尝试运行独立探针 `node .cache/policy-stop-stage/search-open-probe.mjs`，计划在一次性 Chrome 中打开公开搜索入口并读取搜索框上下文；多次遇到 `CDP timeout`，一次返回空 origin。没有取得有效的搜索框观察或策略分类，不将探针失败当作站点或插件结论。
- 后续需要当前会话脱敏的观察截断原因和动作类型/目标信息，或能可靠打开搜索框的独立复现环境；不要据现有事件放宽策略。

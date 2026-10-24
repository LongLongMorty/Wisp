# v0.1 接口契约

本文是语言无关语义的TypeScript草图；实现须配套运行时schema，不能只依赖TS类型。协议版本为 `0.1`，未列出的动作拒绝。时间为UTC ISO字符串，持续时间为毫秒。

T-014实测后的增量契约见[可靠性修复规格](reliability-v02.md)：观察可选value/valueTruncated、原生select的options/optionsTruncated；新增`selectOption {target,value}`，URL条件增加与equals互斥的startsWith；SDK/宿主可传不可降低的completionConditions，finish/提取均由运行时验证。敏感值不暴露，select事件为程序生成、不宣称真实用户输入。完整运行时schema以packages/protocol/src为准；旧动作/观察仍兼容，新动作只向声明支持的消费者发送。

## 页面控制

```ts
type Target = {
  documentId: string;
  frameId: string;
  observationId: string;
  ref: string;
};

type Condition =
  | { kind: 'url'; equals: string }
  | { kind: 'element'; role: string; name: string; state: 'visible' | 'absent' }
  | { kind: 'text'; includes: string }
  | { kind: 'value'; target: Target; equals: string };

type BrowserAction =
  | { kind: 'click'; target: Target }
  | { kind: 'fill'; target: Target; value: string }
  | { kind: 'pressKey'; target: Target; key: string }
  | { kind: 'scroll'; direction: 'up' | 'down'; pixels: number }
  | { kind: 'navigate'; url: string };

type ActionRequest = {
  actionId: string;
  action: BrowserAction;
  expected?: Condition[];
  timeoutMs: number;
};

interface BrowserAdapter {
  capabilities(): Promise<Capabilities>;
  observe(signal?: AbortSignal): Promise<Observation>;
  execute(request: ActionRequest, signal?: AbortSignal): Promise<ActionResult>;
  verify(conditions: Condition[], signal?: AbortSignal): Promise<Verification>;
  dispose(): Promise<void>;
}
```

Adapter实例绑定一个tab；Capabilities声明支持的动作、frame与Shadow DOM范围。fill表示替换文本，不是追加；pressKey仅允许schema列举的常用键与组合，禁止任意浏览器快捷键。scroll像素须为1–2000整数，输入字符串最大8,000字符，URL仅HTTP(S)。默认动作超时10秒，最大30秒。动作原语不会接受任意JS、CSS/XPath代码或模型生成函数。

Observation必须包含：observationId、documentId、frameId、url、title、capturedAt、viewport、elements、text、truncated和省略原因。元素包含ref、tag、role、name、enabled、editable、bounds；不输出密码值。文本、元素和名称均视为不可信数据。

```ts
type ActionResult = {
  actionId: string;
  dispatched: 'yes' | 'no' | 'unknown';
  responded: 'yes' | 'no' | 'unknown';
  verified: 'passed' | 'failed' | 'not_checked' | 'unknown';
  evidence: Evidence[];
  error?: { code: ErrorCode; message: string; retryable: boolean };
};
```

Evidence包含kind、url、documentId、observationId、capturedAt和经脱敏的actual摘要。verify返回逐条件状态与证据；多个条件按AND评估，匹配多义目标返回错误，不任取首个。页面响应可来自相关目标或区域变化，但不等于后置条件通过。

主要错误码：STALE_TARGET、NOT_ACTIONABLE、UNSUPPORTED_CAPABILITY、PERMISSION_DENIED、POLICY_DENIED、TIMEOUT、ABORTED、OUTCOME_UNKNOWN、MODEL_INVALID_OUTPUT、BUDGET_EXCEEDED、TAB_BUSY、DISCONNECTED、AMBIGUOUS_TARGET。

retryable表示允许重新评估，不代表允许自动重复输入。相同actionId和相同payload返回既有状态；相同ID不同payload拒绝。结果未知时保留unknown，禁止伪造成功或自动重发。

## 决策和提取

```ts
type Decision =
  | { kind: 'action'; request: Omit<ActionRequest, 'actionId'> }
  | { kind: 'extract'; schemaId: string }
  | { kind: 'finish'; summary: string; expected: Condition[] }
  | { kind: 'ask_user'; question: string };

interface ModelProvider {
  decide(input: DecisionInput, signal?: AbortSignal): Promise<ModelResponse>;
  extract(input: ExtractionInput, signal?: AbortSignal): Promise<ExtractionResponse>;
}
```

运行时生成actionId，不信任模型提供的身份或权限字段。DecisionInput含用户目标、当前观察、历史摘要、允许动作和剩余预算。ModelResponse含decision、可用usage及providerRequestId，不要求提供模型内部思维过程。

extract仅使用SDK预注册且受大小限制的JSON Schema；返回data、source及usage，经运行时校验后才能写入任务结果。提取是一轮只读决策，不能同时执行动作。页面文本不能注册schema或修改策略。

finish是完成候选，运行时必须验证非空expected；提取类任务可由已通过schema校验且带来源的提取结果完成。模型文字“已完成”本身不构成完成证据。finish条件是有界支持的页面条件，不承诺证明任意复杂业务语义。

## SDK与任务

```ts
const agent = createAgent({ browser, model, policy, store });
const run = agent.run({ goal, schemas, limits });
run.onEvent(event => render(event));
await run.pause();
await run.resume();
await run.confirm({ confirmationId, decision: 'approve' });
await run.cancel();
const result = await run.result;
```

run立即返回句柄；result在completed、failed或cancelled时解析为带status的联合结果，paused/waiting_user不终结Promise。resume必须重新观察和验证授权；重启后通过agent.getRun(runId)获取句柄，不复活旧Promise。cancel幂等；取消后迟到结果只可记录为已忽略，不能继续动作。

事件包含version、eventId、runId、递增seq、timestamp、type与payload。类型至少有run.state、step.observed、model.completed、action.prepared、action.result、confirmation.required、verification.result和budget.updated。订阅支持afterSeq回补，UI按eventId去重；事件可含敏感内容，必须按日志规则过滤。

确认请求包含confirmationId、actionId、origin、动作摘要、可显示参数、expiresAt和contextDigest；确认消息不接受替换动作参数。SDK中的policy与store只允许受信任扩展代码提供。

## 扩展消息

T-011宿主SDK的具体工厂参数、句柄生命周期与分页规则见[sdk-v01.md](sdk-v01.md)。RuntimeEvent补充显式redacted:true元数据变体：run.state、step.observed、action.prepared、action.result、confirmation.required和verification.result可回补安全摘要，不伪造未持久化的原payload。完整payload原校验仍有效；最终结果与实时确认展示分别从句柄result/snapshot与pending读取。

信封：`{ version, requestId, type, runId?, payload }`；响应带相同requestId及`ok/data/error`。校验消息大小、schema和sender。页面及观察脚本消息只可返回观察与输入信号，不可提交批准、写授权配置或直接触发模型调用。跨重连的重复requestId必须去重。

## T-003a已实现的协议子集（2026-10-18）

历史实现为packages/protocol/src/index.mjs与手写index.d.ts；T-002b已迁移为单一packages/protocol/src/index.mts，后续由tsc生成dist/index.mjs和index.d.mts。运行时严格校验Target、BrowserAction、Condition和ActionRequest；额外字段拒绝，decodeActionRequest在JSON解析前限制UTF-8载荷为65,536字节。标识符最长256字符；角色最长128、元素名最长1,024；文本条件最长4,096、字段值最长8,000；期望条件最多16条。空fill/字段比较值允许，其他必填文本不能为空白。URL最长4,096字符，只允许无内嵌用户名密码的HTTP(S)URL。

pressKey白名单：Enter、Tab、Escape、Backspace、Delete、四方向键、Home、End、PageUp、PageDown、Control+A、Meta+A。timeoutMs为1–30,000整数；缺省10秒由调用方在创建请求时提供，parseActionRequest不隐式添加缺省值。

T-003a子集仅验证数据形状，不判断origin授权、节点是否存在或动作是否需确认；完整扩展消息与事件schema现已由T-003b补齐。后续执行网关必须独立完成策略与能力检查；不能因schema通过即执行。

## T-003b细化

Observation、结果、模型决定、确认、消息权限和事件payload的正式结构见[protocol-v01.md](protocol-v01.md)。该文件是实现与验收的补充约束；运行时状态机、发送方真实身份与副作用控制不由schema代替。

## T-007策略实现

受信任宿主通过@wisp/policy.createPolicyGateway包装tab绑定控制器，对外提供submit/confirm/observe/verify。确认仅接受严格run.confirm消息与原生UI sender元数据，绑定与失效规则见[policy-v01.md](policy-v01.md)。ChromeControlledAdapter.readPolicyContext仅用于宿主策略读取，新增PolicyContext及严格解析器位于packages/protocol/src/policy.mts；不暴露原始字段值。当前确认UI和runtime监听仍由T-012接入。

## T-008运行时基础

@wisp/runtime提供TaskRuntime与RuntimeStore，不等同于T-011的公开SDK句柄。gatewayFactory必须提供按run.tabId独占、重新授权的策略网关；confirm先调用只读validateConfirmation再提交派发检查点。恢复阶段、租约、tombstone、journal游标和受信任控制入口见[runtime-v01.md](runtime-v01.md)。原始动作参数不持久化，unknown核对需要宿主重新提供摘要一致的原请求；无法重建则交用户处理，绝不自动重发。

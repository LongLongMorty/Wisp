# SDK接入

当前包是npm workspace内的私有包，先按[安装说明](getting-started.md)完成构建。SDK只能放在受信任宿主中；不要把gatewayFactory、uiSender或会话密钥暴露给目标网页。

## 可直接运行的例子

```powershell
node docs/examples/sdk-task.mjs
```

此例使用内存store、脚本模型及只读网关，展示立即返回句柄、waiting_user、显式暂停/恢复、宿主完成条件和稳定事件回补；无网络、无Chrome、不审批写入。既有最小例子可用 `node packages/sdk/examples/minimal.mjs` 运行。两者都不计入实际模型成功率。

## 真实宿主的接线

宿主需要提供目标tab的CDP transport、RuntimeStore、模型工厂和经过鉴权的策略网关。生产接线在[background.ts](../apps/extension/entrypoints/background.ts)与[controller.mts](../apps/extension/host/controller.mts)，它们负责原生sender、权限、debugger生命周期和storage.session。以下是集成片段，所列依赖须由宿主实现，不能直接复制成网页脚本：

```ts
import {createAgent} from '@wisp/sdk';
import {createChatModel} from '@wisp/models';

const agent = createAgent({
  store, tabId, gatewayFactory,
  modelFactory({onAttempt, attemptLimit}) {
    return createChatModel({
      ...sessionModelConfig,
      onAttempt,
      corrections: (attemptLimit - 1) as 0 | 1
    });
  },
  uiSender: () => verifiedNativeSender
});
await agent.ready;
const run = agent.run({
  goal: '找到目标记录并核对标题',
  completionConditions: [
    {kind: 'url', startsWith: 'https://app.example/records/'},
    {kind: 'text', includes: '目标标题'}
  ]
});
const unsubscribe = run.onEvent(renderMetadata, {onError: showError});
// 在真实用户事件中调用pause/resume/cancel；确认只来自已鉴权UI。
const result = await run.result;
unsubscribe();
await agent.dispose();
store.close();
```

示例URL/标题为调用方已知的业务目标，不是框架读取的测试oracle。模型工厂每次真实HTTP尝试必须调用onAttempt，纠正次数受attemptLimit约束；费用缺少计价数据时保持未知。

## 句柄与恢复

| API | 行为 |
| --- | --- |
| `agent.run({goal, tabId?, schemas?, limits?, completionConditions?})` | 立即返回runId和句柄，实际创建/启动异步；每任务选择一个tab |
| `run.snapshot()` / `run.pending()` | 读取状态副本、确认卡片或临时提问；waiting_user不等于终态 |
| `run.result` | 仅真实终态解析；等待/暂停不解析；宿主断开可能拒绝本地Promise |
| `run.pause()` / `run.resume({schemas?})` | 显式恢复后重新观察/鉴权；提取schema须与原注册一致，原预算保留 |
| `run.cancel()` | 幂等取消，阻止后续动作；不能撤销已派发动作 |
| `run.confirm({confirmationId, decision})` | 仅经过可信uiSender回调；令牌一次性绑定当前动作/页面，不自动授予origin |
| `agent.getRun(runId,{schemas})` | 重新取得句柄，不自动恢复；主机重启后先暂停 |
| `run.events(afterSeq)` / `run.onEvent(...)` | 按seq回补；事件ID稳定，读取nextSeq继续分页，游标过旧/超前明确报错 |
| `agent.history()` / `deleteRun(runId)` | 删除仅限允许清理的终态任务；unknown屏障不能靠删除绕过 |

ask_user场景先等待真实用户输入，再pause/resume；恢复不意味着自动批准写入。unknown动作先reconcile或通过受信任宿主明确核对/确认结果，不重新派发旧actionId。关闭宿主用agent.dispose，store由其所有者单独关闭。

completionConditions可用url（equals或startsWith互斥）、text、element；不接受易失value目标引用。首次配置后不可降低，恢复时省略表示沿用。运行时验证宿主与模型条件并集，提取也不能绕过。schema必须属于当前支持的[子集](../specs/001-browser-agent/models-v01.md)，不承诺完整JSON Schema。

## 单独使用控制层

```ts
const browser = createChromeAdapter(transport, {allowedOrigins: [origin]});
const o = await browser.observe();
const el = o.elements.find(e => e.role === 'combobox' && !e.sensitive);
if (el) {
  const option = el.options?.find(x => x.value === desiredValue && !x.disabled);
  if (option) await browser.execute({
    actionId: crypto.randomUUID(), timeoutMs: 3000,
    action: {kind: 'selectOption', target: {
      documentId: o.documentId, frameId: o.frameId,
      observationId: o.observationId, ref: el.ref
    }, value: option.value}
  });
}
await browser.dispose();
```

这是控制层片段：输送transport、授权origin与desiredValue的宿主承担信任责任，生产任务须经过策略网关。引用必须取自观察；旧引用不按文本重新绑定。原生selectOption按精确value选择并验证，程序生成的input/change不是物理用户输入。普通字段值有界、脱敏且可截断；敏感字段没有value。其他支持项见[范围表](support.md)。

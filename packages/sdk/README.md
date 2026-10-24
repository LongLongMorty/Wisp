# @wisp/sdk

T-014增量：`agent.run({goal, completionConditions:[{kind:'url',startsWith:'https://example.test/records/'},{kind:'text',includes:'目标标题'}]})`可声明宿主完成条件。运行时验证宿主与模型条件的并集，模型省略条件不会省略验证；条件持久化，resume省略时沿用，不能降低。现有目标/schema/预算API保持兼容。URL的equals与startsWith互斥，宿主条件不接受易失value目标引用；按业务目标声明，不向模型泄露验收oracle真值。

受信任宿主SDK：createAgent、RunHandle及浏览器/模型契约类型。生产扩展消息、原生UI sender与侧边栏接线留T-012。

```ts
import {createAgent} from '@wisp/sdk';
import {createChatModel} from '@wisp/models';
const agent=createAgent({store,tabId,gatewayFactory,
  modelFactory({onAttempt,attemptLimit}) {
    return createChatModel({...sessionModelConfig,onAttempt,corrections:(attemptLimit-1) as 0|1});
  },
  uiSender:()=>nativeSender // 仅从受信任原生传输获取，不能使用页面声明
});
await agent.ready;
const run=agent.run({goal:'查找目标工单'});
const off=run.onEvent(event=>renderMetadata(event),{afterSeq:lastSeq,onError:showError});
await run.pause();
await run.resume();
const pending=await run.pending();
// 用户确认后才调用run.confirm({confirmationId,decision:'approve'})。
const result=await run.result;
off();
await agent.dispose();
```

run同步返回UUID句柄；实际创建/启动异步。snapshot/pending返回副本，result只在真实终态解析；暂停/等待用户不结束Promise。schema初始化失败为可查询failed任务。宿主dispose或存储失联使未决本地Promise以DISCONNECTED拒绝，不伪造持久化任务终态；dispose不关闭共享store。

pause/cancel不等待模型，cancel幂等。ask_user继续需先pause再resume，临时提问由pending读取，pause/重启清除。确认只接受confirmationId/decision；没有可信uiSender回调拒绝，不自动批准或授予origin。

重连使用`await agent.getRun(runId,{schemas:originalSchemas})`，也可在resume({schemas:originalSchemas})时重注册原schema。任务先保持paused，再显式resume重新观察/鉴权，保留预算；unknown不重发。

events(afterSeq=0)返回{events,nextSeq}，至多100项/60000字节；下一页用nextSeq。过旧/超前游标明确报错。onEvent自动回补、按seq交付，eventId基于runId与seq的SHA-256；成功回调后推进游标。异常由onError停止该订阅，不影响其他订阅、取消和结果。取消订阅后不再交付新事件。默认50ms轮询（10–1000ms可配），最多100个缓存句柄、每句柄32个订阅。

回补中未持久化的原观察、动作参数、确认展示与验证原文使用payload.redacted=true，不捏造完整内容。最终结果由snapshot/result读取；实时确认/临时提问由pending读取。旧journal缺状态字段时不捏造历史状态。

```powershell
npm run sdk:example
npm run sdk:smoke
node scripts/validate-toolchain.mjs t011
```

example是可执行内存宿主/脚本模型例子，不冒充Chrome；smoke为真实Chrome SDK和共享层六组回归，T-011证据独立保存，不覆盖T-010，无需模型密钥。详见[SDK规格](../../specs/001-browser-agent/sdk-v01.md)。

T-012受信任宿主管理入口：history/deleteRun/notifyInput/acknowledgeUnknown/recover，均不得直接暴露给目标页。原生侧边栏身份、会话密钥和主机权限由扩展宿主校验。

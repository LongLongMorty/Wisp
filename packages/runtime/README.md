# @wisp/runtime

T-008提供任务状态、原子检查点、IndexedDB journal、tab租约与unknown恢复基础。T-010新增可选模型单步循环；公开SDK句柄和生产扩展消息入口仍待T-011/T-012。

## 模型循环（T-010）

```ts
import {createTaskRuntime,openIndexedDbStore} from '@wisp/runtime';
import {createChatModel} from '@wisp/models';
const store=await openIndexedDbStore();
const runtime=await createTaskRuntime({
  store,gatewayFactory,
  loop:{modelFactory({onAttempt,attemptLimit}) {
    return createChatModel({...sessionModelConfig,onAttempt,corrections:(attemptLimit-1) as 0|1});
  }}
});
const task=await runtime.create({tabId,goal:'提取工单编号'});
await runtime.configureLoop(task.runId,{schemas:{ids:{type:'array',items:{type:'string'}}}});
await runtime.start(task.runId);
await runtime.drive(task.runId); // 也可每次显式调用step
```

工厂只由受信任宿主提供。HTTP模型必须转交onAttempt并遵守attemptLimit；内部隐蔽重试的自定义提供方不在调用次数保证范围内。脚本提供方每次方法调用计一次。调用额度先事务预留，正常结束返还未用额度；Worker丢失时保守保留预留。

configureLoop只在created时首次设定。重启后在paused状态重注册相同schema，再显式resume/drive；不能通过重新配置重置已用预算。默认30轮（包括只读/结束候选轮）、40次模型尝试、5分钟墙钟时间、64000输入上下文字符、24000观察字符、连续3次无进展暂停。原HTTP适配的完整请求64000字符硬上限继续生效。stopReason记录具体超限计数；budget保留运行状态。已知usage为部分可用量累加，不代表未知请求的精确总量或费用。

每轮重新观察，历史只保留最多16条固定动作/状态元数据。finish先真实verify，失败不完成；提取须schema与来源校验，并重读观察及验证URL。观察语义摘要忽略观察ID、捕获时间和元素ref，用于有界无进展检测，不能证明业务进展。

ask_user或策略确认会停在waiting_user；确认由原confirm完成，随后宿主可显式drive。ask_user继续需先pause，再resume。unknown、暂停、干预和取消都阻止后续动作。旧drive绑定代次，显式resume不会被旧循环自动接管。

```powershell
npm run loop:smoke
node scripts/validate-toolchain.mjs t010
```

该命令保存T-010独立的观察/控制/策略/MV3恢复/循环证据，不覆盖T-008。循环探针以Node宿主和脚本模型接真实CDP/策略网关；MV3/IndexedDB恢复由独立扩展回归测试验证，不宣称循环本身已接入生产扩展。详情见[循环规格](../../specs/001-browser-agent/loop-v01.md)。

~~~ts
import {openIndexedDbStore,createTaskRuntime} from '@wisp/runtime';
const store=await openIndexedDbStore();
const runtime=await createTaskRuntime({store,gatewayFactory});
const run=await runtime.create({tabId,goal:'查找目标工单'});
const observation=await runtime.start(run.runId);
const receipt=await runtime.execute(run.runId,request);
await runtime.pause(run.runId);
// 用户明确恢复时，重新创建并授权策略网关，再观察；不重放旧动作。
await runtime.resume(run.runId);
await runtime.cancel(run.runId);
await runtime.dispose();
store.close();
~~~

gatewayFactory(run,signal)必须返回独占run.tabId的@wisp/policy网关，遵守取消信号；创建新网关时重新验证origin授权。不要向模型暴露原始浏览器执行器或存储事务。

createTaskRuntime启动只执行recover，不自动启动任务。其他活跃session的未过期租约保留；失联Worker等待5秒租约过期后recover。prepared/待确认动作标为abandoned，dispatching转unknown，非终态paused。resume需要明确用户意图并重新观察；unknown保留tab写入屏障。

reconcile(runId,原请求)要求完整请求摘要一致，只验证原expected，passed证据才能解除屏障；不可验证时保持unknown。acknowledgeUnknown仅供受信任用户控制，必须由未来T-012校验UI身份。解除屏障后旧actionId仍不重发。

execute/confirm先落盘再进入网关。confirm在改动检查点前调用网关validateConfirmation验证消息与UI身份；确认展示和原请求仅在内存，重启丢弃。相同actionId/run/payload复用存储记录；初次结果可含实时决定，重放只返回清洗后的持久化状态，不能假定有原始确认展示。

pause/cancel立即落盘并abort；迟到结果只记事实，不复活任务。complete仅接受受信任宿主提供的passed且非空Verification，模型完成条件的实际评估由T-010负责；fail写入严格错误码终态。新代次等待旧控制器清理，迟到观察/结果不能更改新代次状态。

notifyInput(tabId,source)只供受信任宿主调用；user/unknown暂停，program仅可来自宿主自身已知命令。isTrusted不能区分用户和CDP输入，没有自动可靠DOM归因器，Q-005仍未闭合；页面不得自报program。

IndexedDB与createMemoryStore共享同步transact契约，回调不能await；内存实现只用于确定性测试，不替代持久化。单版本化记录原子保存任务/动作/租约/journal，偏重一致性与有界原型，尚无大规模性能结论。

最多100任务，每任务256动作/512条journal，终态默认7天保留。容量只清理已终态且无未决动作的最早任务，不删除活跃或unknown任务。删除历史后保留无原参数的动作ID tombstone，全库25,600条，满后拒绝新动作而非遗忘重放保护；清空整个数据库会清除此保护。事件游标落在被裁剪范围前返回BUDGET_EXCEEDED。

journal不含原始输入、expected值、观察文本或批准展示；普通动作只留SHA-256和清洗后结果，证据文本与URL路径/query已去除。用户goal与最终结果属于任务内容，按历史规则保存；摘要不是加密或通用敏感数据识别。store由宿主持有，runtime.dispose不关闭共享store。

~~~powershell
npm test
npm run runtime:smoke
node scripts/validate-toolchain.mjs t008
~~~

runtime:smoke运行14项观察、20项控制、17项策略回归及24项真实MV3/IndexedDB恢复检查，输出独立T-008证据，不覆盖历史通过报告。故障测试使用受控租约时钟，主Worker为实际MV3 ServiceWorker、竞争方为模块DedicatedWorker。测试授权元数据仅用于宿主harness，不替代T-012原生SidePanel验收。

详情：[运行时规格](../../specs/001-browser-agent/runtime-v01.md)、[T-008报告](../../specs/001-browser-agent/t008-report.md)。

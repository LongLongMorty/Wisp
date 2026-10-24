# T-008 状态、持久化与恢复

日期：2026-10-18。状态：已完成；实现与工程检查通过，真实Chrome/IndexedDB/MV3恢复验收已复验通过。

## 前置复核与修复回归

本任务开始时核对用户修复的异步IIFE/await包装，T-005/006/007工程证据均passed且SHA-256一致；T-007三组浏览器检查分别14/20/17项成功。没有覆盖或改写用户的通过证据。

补充直接在VM执行CDP求值表达式的回归测试，验证异步control.context结果在按值序列化之前被等待，异步拒绝也进入错误信封。第三项桥接回归验证重启后的新观察器所有者释放旧注册表/监听，而旧实例迟到dispose不会清掉新所有者。当前同tab观察器采用独占宿主语义。

## 本次交付

先编写[运行时规格](runtime-v01.md)，新增[@wisp/runtime](../../packages/runtime/README.md)：

- 同步事务契约、确定性内存实现和真实IndexedDB实现；任务、动作、租约与journal原子提交，拒绝事务回调await，无存储失败时的内存成功回退。
- create/start/resume/pause/cancel/fail/complete、journal游标与任务历史删除。恢复只暂停，不自动启动模型或派发。
- prepared→dispatching→结果检查点；waiting_confirmation展示仅在内存。重启prepared/待确认变abandoned，dispatching变unknown；原actionId持久化去重，跨run/异payload拒绝。
- tab/session/generation/expiry租约与续租；unknown屏障即使租约过期也阻止新写入。reconcile只验证原请求expected，passed才解除屏障；否则保留unknown交用户处理。明确acknowledge后旧ID仍不可重发。
- 暂停/取消立即落盘和abort，迟到观察/结果不能更改新代次。恢复前等待旧输入清理；同Worker的unknown核对创建新控制器。
- 日志不保存原填写值、expected值、完整观察或确认展示；请求仅留SHA-256，动作证据文本及URL路径/query清洗。用户目标和最终结果属于任务内容，按历史保留规则保存。
- 100任务、每任务256动作/512条journal、终态默认7天。只清理无未决动作的终态；删除后保留动作ID tombstone，全库25,600条，满后拒绝新动作而不遗忘去重。旧游标明确报错。

策略网关增加只读validateConfirmation，运行时在记录派发前就验证UI sender和消息，而真正confirm仍重新鉴权并一次性消费。生产扩展仍为占位入口，运行时没有接模型、SDK或确认UI。

## 工程验证

[工程证据](evidence/t008-checks.json)：static、tests、typecheck、build全部通过，共147项测试。新增30项运行时测试、3项桥接回归和1项只读确认鉴权测试。

运行时测试覆盖事务回滚/异步回调拒绝、状态机、跨实例去重、并发准备、双宿主租约、租约过期、三个重启检查点、unknown屏障/核对、取消与迟到结果、保守干预、确认恢复、结果提交失败、日志脱敏、终态/保留/容量/游标、代次隔离和旧控制器释放顺序。

这些测试使用确定性内存事务与宿主替身，不冒充真实IndexedDB或MV3恢复通过。

## 浏览器证据与复验

[观察回归](evidence/t008-observer-browser.json)、[控制回归](evidence/t008-control-browser.json)、[策略回归](evidence/t008-policy-browser.json)、[运行时恢复](evidence/t008-browser.json)：Chrome156下分别14项、20项、17项、24项检查全部通过，status=passed，四份源码哈希与当前一致。综合工程报告[t008-checks.json](evidence/t008-checks.json)为status=passed且四轮sourceHashesMatch=true。早前一轮Chrome启动时GPU进程崩溃被标为environment-blocked，复跑未复现。

~~~powershell
npm run runtime:smoke
node scripts/validate-toolchain.mjs t008
~~~

命令编译protocol/browser/policy/runtime，执行14项观察、20项控制、17项策略回归及24项MV3/IndexedDB检查，不覆盖历史通过报告。WISP_CHROME可指定Chrome路径。

运行时harness加载独立测试MV3扩展，主执行者为真正ServiceWorker。分别在prepared、dispatching、responded（已有业务效果但结果未落盘）、finished检查点调用CDP stopAllWorkers强制停止，再用新bootId重启并重开同一IndexedDB。逐项要求paused、正确动作阶段、重复请求不派发；unknown必须阻止resume，并通过显式核对/交接解除屏障。独立fixture oracle最终只允许两次已实际派发的普通按钮点击。

另验证真实IDB事务回滚、MV3 Worker与DedicatedWorker竞争同一tab租约，以及CDP输入和另一条测试输入都可以产生isTrusted=true、无法归因的通知会暂停。租约时钟可控，每次重启前进6000ms，不声称测量了真实Worker自然休眠时延。

harness的测试控制台是扩展页，授权元数据由受信任测试宿主提供，不把它冒充已完成原生SidePanel sender/确认UI验收；该集成仍属T-012。

四份浏览器证据status=passed、检查项完整且源码哈希一致；t008-checks.json为status=passed、四轮sourceHashesMatch=true、lockfilePresent=true，满足勾选条件，可进入T-009。若发现真实缺陷，应保留失败原因、修复并重跑，而不是手改报告为通过。

## 限制与Q-005

Q-005仍未闭合：没有可靠自动区分用户与程序输入的DOM归因器。notifyInput只面向受信任宿主，无法归因则unknown并暂停；页面不得自报program。两种可信输入的测试不是物理用户输入归因证明，后续扩展接线和人工验收仍需完成。

IndexedDB当前用单个有界状态记录换取跨实体原子性，尚无高负载性能结论。gatewayFactory及显式acknowledge/complete只供受信任宿主；完成证明由宿主真实verify提供，模型完成判定属T-010。多进程不能撤回已发输入，也不宣称业务exactly-once；输入来源转发与跨上下文取消接线由宿主负责。SDK句柄、事件转换与生产扩展UI仍由T-011/012接入。

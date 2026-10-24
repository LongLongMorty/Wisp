# T-010 单步循环、预算与完成验证

日期：2026-10-18。状态：已完成；实现与工程检查通过，真实Chrome循环及共享运行时回归已复验通过。

## 前置验收

复核T-009用户补测：实际端点decide/extract均passed，requestCount=2；工程四项通过，模型与工程报告全部源码SHA-256与任务开始时文件一致。保留原T-009通过报告。新增任务改变根package.json/lock与构建脚本后，旧报告仅代表此前版本，不伪造重新进行的模型调用。

## 交付

先编写[循环规格](loop-v01.md)，在[@wisp/runtime](../../packages/runtime/README.md)新增configureLoop/step/drive。每轮只决定一个动作，actionId由宿主生成，只能经过原execute与策略网关。自定义模型输出同样严格重解析，旧目标与未注册schema拒绝。

持久化轮数、模型调用额度、总墙钟时长、上下文/观察大小和无进展计数；额度先事务预留，正常结束返还未用部分，中断不回滚已预留额度。最后一个额度限制为单次请求，无法无界格式重试。恢复重新注册同schema、保留预算，不自动运行。

历史最多16条固定动作/状态元数据；不保存原观察、填写值或模型原文。journal增加有界step/model/budget/verification元数据，已知用量可累计，未知量与费用不估计。每个异步边界检查状态/代次/租约；不遵守取消的模型也不会阻塞本地停止或授权迟到动作。

finish必须verify全部原条件并有证据；提取必须schema和来源校验、重读观察未变化并验证URL。失败完成候选不会成功。策略确认、ask_user和unknown停止循环。暂停/恢复之间的旧drive不能接管新代次；完成/等待/失败提交也在事务内检查预期代次。

修复实现期间发现的竞态：旧drive在暂停后遇到新代次恢复，原先可能继续while循环；现绑定初始代次。另补租约失效后的安全暂停与模型输入副本隔离，避免自定义提供方修改注册schema影响校验。

## 工程验证

新增27项循环测试，全量202项测试通过；static、tests、typecheck、build结果见[工程证据](evidence/t010-checks.json)。覆盖动作到完成、结构化提取、非法输出/目标/来源、失败完成候选、全部预算、纠正额度、无进展、取消/暂停/代次竞态、租约失效、确认与unknown阻断、崩溃预留、恢复注册、日志与输入隔离。

测试主要使用确定性内存事务和网关替身；不冒充真实页面、IndexedDB或MV3通过。

## 浏览器复验

`loop:smoke`依次运行T-010独立的14项观察、20项控制、17项策略、24项MV3恢复回归，以及10项真实循环检查。本轮Chrome156下五组检查全部通过（14/20/17/24/10），status均为passed，源码哈希与当前一致。早前一轮在首个检查前遇到GPU进程故障被标为environment-blocked，复跑未复现。证据见evidence/t010-*-browser.json。

~~~powershell
npm run loop:smoke
node scripts/validate-toolchain.mjs t010
~~~

五组检查status=passed、检查项完整、源码哈希一致；综合报告[t010-checks.json](evidence/t010-checks.json)为status=passed、五轮sourceHashesMatch=true、lockfilePresent=true，满足勾选条件，可进入T-011。可用WISP_CHROME指定Chrome路径，无需模型密钥。

循环检查使用脚本模型与Node内存运行时连接真实Chrome/CDP、真实策略网关，验证搜索→详情→证据完成、读取表格前五条编号并由独立fixture数据核对、提交前确认且零副作用、假完成拒绝。MV3恢复由独立扩展回归覆盖，不把Node循环冒充生产ServiceWorker接线。

## 边界

无进展仅比较观察语义摘要；提取来源及URL只证明观察绑定，不证明任意复杂业务事实。任务预算为有限轮数/字符/调用/时间限制，不能作为精确费用上限。真实模型端到端15次成功率仍属T-014；SDK句柄、事件协议转换与生产扩展循环接线属T-011/T-012。Q-005输入来源归因仍保留。

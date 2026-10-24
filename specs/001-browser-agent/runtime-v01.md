# T-008 状态、持久化与恢复规格

前置：核对用户修复的异步求值包装及T-005/006/007当前证据，均passed且源码哈希一致。补两个实际执行求值表达式的异步桥接回归测试，避免transport替身掩盖内层Promise序列化。

## 本任务范围

@wisp/runtime提供不接模型的TaskRuntime、同步事务存储契约、IndexedDB实现及确定性内存测试实现。任务支持create/start/pause/resume/cancel/execute/confirm/reconcile/complete；公开SDK句柄、模型循环与确认UI仍属T-009–012。每个运行通过宿主gatewayFactory独占T-007网关，不直接访问原始execute。

## 原子存储

IndexedDB单objectStore中保存版本化状态，事务同步读取并变更任务、动作、租约和journal后原子提交；回调内不能await。全库限制100任务、每任务256动作和512条journal；超过任务容量只删除最早终态，非终态不静默删除。默认终态保留7天。分页事件序号递增，游标落在已裁剪范围前必须明确报错，不能伪造连续历史。

日志不保存原始动作值、expected字段值、完整观察、密钥或待确认展示参数。动作保存完整请求SHA-256、kind、阶段和清洗后的结果；删除历史后保留不含原参数的动作ID tombstone，全库最多25,600条，满后拒绝新动作，不遗忘重放保护；保留任务用户目标属于任务内容，不是通用秘密识别。SHA-256是去重摘要，不是加密。

## 状态与检查点

created→running→waiting_user/paused/completed/failed/cancelled，paused和waiting_user可取消；waiting_user仅通过有效确认继续，重启不复活批准。start/resume必须由宿主明确调用，重新观察并重新通过gateway授权。重启不调模型、不自动execute。终态不能恢复运行，完成必须有非空且passed的Verification证据。

动作先原子记录prepared，再原子记录dispatching，才调用网关；结果与checkpoint再次原子提交。另有responded故障注入点，用于验证已经产生真实副作用但结果尚未落盘的窗口。网关返回confirm时记录waiting_confirmation，展示数据仅在内存。拒绝/敏感接管暂停；结果unknown暂停并封锁tab。相同actionId/run/payload复用既有记录，不同内容拒绝；已持久化ID不会在新进程重新派发。

## 租约与恢复

每tab租约含run/session/generation/expiry，默认5秒，最多每秒续租；事务中竞争只允许一位持有者。代次单调递增，执行前检查取消、状态及代次。暂停/取消立即落盘并abort，迟到结果只能记录动作事实，不能把任务重新置running或completed。

新session仅回收已过期租约，不抢夺仍活跃的另一个宿主。恢复prepared/待确认动作标为abandoned并暂停，dispatching转unknown；unknown保留tab屏障，即使租约过期也不自动允许下一写入者。不同worker同时运行同一数据库不会清掉对方有效租约。进程被终止后最长等待租约过期再显式recover。

reconcile必须提供与已存摘要一致的原始请求，并由重新授权的网关验证原expected；仅passed证据解除unknown屏障，失败/不可判断不重发。无法重建原始参数或旧value Target失效时保留unknown，交宿主调用explicit acknowledgeUnknown后重新规划；该调用只面向受信任用户控制，T-012必须校验原生UI sender。即使解除屏障，旧actionId仍不可重发。

## 干预与Q-005

不以isTrusted区分用户与CDP输入，两者都可为true。提供受信任宿主notifyInput(tabId,source)，program只接受宿主自身已知命令记录；user或unknown立即暂停并abort持有任务。页面消息不能自报program。尚无可靠的自动DOM归因器，不承诺并发用户输入绝对可区分；后续扩展接线必须将无法归因信号报unknown，不能以输入时间窗口静默忽略。Q-005的可靠区分仍未证明，保守暂停路径必须有测试。

## 验收

单元测试：状态机、准备/派发检查点、请求去重、跨run/不同payload拒绝、租约竞争与代次、过期恢复、迟到结果、unknown屏障和核对、取消/干预、日志脱敏、容量/保留/游标。

真实Chrome：真实IndexedDB原子回滚/重开，两个Worker竞争租约，terminate Worker于prepared/dispatching/结果落盘后，重启暂停且unknown不重发；独立fixture oracle核对副作用。观察/控制/策略回归仍通过。无真实IDB/Worker证据时T-008不勾选完成。

恢复还会清理同tab旧isolated观察器；同Worker的unknown核对使用新网关，新代次先等待旧输入释放。确认的只读UI身份校验先于派发检查点；complete接收的证明只面向受信任宿主，模型完成判定仍由T-010实际执行verify。

# T-011 SDK 与任务句柄规格

状态：已完成；实现、本地测试与真实Chrome SDK及共享层回归均通过。

`createAgent({store,gatewayFactory,modelFactory,tabId?,uiSender?})` 同步返回宿主SDK，异步初始化可等待 `agent.ready`。工厂沿用既有受信任边界：gatewayFactory按任务tab构造重新鉴权的策略网关，modelFactory接收调用额度与onAttempt；SDK不绕过网关。与原接口草图的browser/model/policy参数相比，使用工厂明确每个run的资源生命周期。SDK不接收目标页消息或页面声明的sender。

`agent.run({goal,tabId?,schemas?,limits?})` 立即返回稳定UUID句柄并异步创建/启动任务。句柄暴露runId、result、snapshot、events、onEvent、pending、pause、resume、cancel、confirm。result仅在真实completed/failed/cancelled时解析，paused/waiting_user持续等待。初始化失败返回严格failed结果；存储失联和宿主dispose使未决本地Promise以DISCONNECTED拒绝，不伪造任务终态。dispose暂停本宿主任务、停止轮询，不关闭调用方共享store。

pause/cancel优先执行，不排在模型drive后；cancel对终态幂等。resume重新观察并鉴权，然后显式重启串行drive。ask_user须先pause再resume。确认仅接受confirmationId/decision，sender由受信任uiSender回调提供；无sender回调拒绝。批准后继续循环，拒绝后暂停，不构造批准或自动授权。

`await agent.getRun(runId,{schemas?})` 重建当前宿主句柄；恢复不自动启动任务。重新恢复循环须提供原schema（无schema任务可省略），预算不得重置。旧宿主Promise不跨进程复活。snapshot/pending与事件对象均为副本。

事件使用0.1信封和稳定eventId、journal seq；afterSeq支持回补、每页最多100项且总字节有界，过旧/超前游标明确错误，不能静默跳过。协议增加明确redacted元数据变体，用于原观察、动作参数、确认展示及验证原文未持久化的事件；不改变原完整payload校验。run.state回补只展示记录的状态元数据，不携带伪造结果。最终结果以snapshot/result读取，确认展示与临时ask_user提问以实时pending读取，暂停/重启清除。

onEvent按seq递增交付，成功回调后推进游标；同一订阅不并发，取消订阅阻止后续交付。回调异常通过onError并停止该订阅，不阻断其他订阅、取消或结果；已裁剪游标报错。默认50ms轮询（可配置10–1000ms），每个句柄最多32个订阅，宿主最多100个缓存句柄。事件不包含密钥、原观察、填写值、原始模型响应或思维过程。

验证：任务创建/成功/失败/等待、暂停恢复、模型等待时取消、批准身份、重连保留预算、事件排序/分页/稳定ID/回调隔离/裁剪错误/dispose。最小例子必须运行；真实Chrome SDK检查与既有循环/MV3恢复回归独立保存T-011证据，不覆盖T-010。

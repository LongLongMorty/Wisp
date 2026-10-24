# T-007 授权、分类与一次性确认规格

前置：T-006的14项观察回归、20项Chrome控制检查、84项测试及工程检查通过，全部源码哈希与开始本任务时一致。

## 受信任边界

新增@wisp/policy纯策略与执行网关。网关独占一个tab绑定BrowserAdapter；宿主提供同实例readPolicyContext，模型和页面不得直接取得原始execute。当前扩展尚无执行消息入口，不提前接UI；未来T-012必须把Chrome runtime原生sender元数据交给网关，不能采信消息内自报身份。

origin授权、撤销和确认只接受配置的extensionId及精确sidepanel URL，拒绝带tab的sender、页面URL、其他扩展与额外字段。确认消息使用既有version/requestId/type/runId/payload严格schema，仅接受run.confirm。批准不隐式授权origin。允许列表仅精确HTTP(S)origin，无通配符。宿主自己提供的sender必须来自Chrome可信回调，此模块不宣称能认证任意JS调用方。

## 页面上下文

Chrome适配器增加readPolicyContext(request)：复用同一isolated world和原节点注册表。固定脚本读取当前主frame文档、URL、目标语义、链接/表单目的origin和打开新窗口标记；在页面内对原始URL、表单及其他编辑字段的完整值生成SHA-256状态摘要，不返回原始字段值。目标指纹含确切ref、类型、语义、可用状态和表单语义。敏感字段或含敏感字段的表单标志转交用户。

扫描与字符串总量有界（10,000节点、65,536字符），不完整时不能批准目标动作。敏感字段的值不参与可外传摘要，存在敏感表单直接handoff。页面返回的文字仍是不可信数据，不能把“安全”“批准”等字样作为授权。

## 分类顺序

先拒绝未授权当前origin、显式navigate/链接/提交目的origin；新窗口/iframe目标拒绝。敏感字段、支付、验证码、认证语义优先handoff，可信站点规则也不能覆盖硬限制。禁用目标拒绝。

对可完整读取的普通文本fill、scroll、授权origin内显式navigate允许；未知click/pressKey及可识别提交/保存/删除等写入默认confirm。可信宿主可配置按origin、精确路径、动作kind、role/name匹配的规则，匹配多规则取deny、handoff、confirm、allow中最保守结果。规则只由宿主配置，页面和模型不能写规则。

## 确认与执行

每份确认有效30秒，绑定runId、actionId、tabId、origin授权版本、documentId、目标指纹、页面/字段状态摘要及完整动作/expected/timeout参数SHA-256。展示目标与动作参数，普通fill值按最多4段完整展示，不静默省略；敏感值不进入确认。

确认后再次读取当前上下文、重新分类并计算摘要；任何变化、过期、时钟回退、拒绝、取消或撤销都使本次批准不可执行；原submit的任务取消信号在等待UI期间也保持绑定。合法UI提交的批准先消费，再执行；中途失败也不恢复批准。请求不能替换动作。非法sender不消耗合法确认；合法UI的错误run/重复/参数越界请求拒绝。

所有submit/confirm/observe/verify在网关串行，授权/撤销立即增版本并清理待确认项；dispatch前再次检查授权版本和取消。相同actionId+runId+payload复用当前决定/结果，不同内容拒绝。最多256个动作ID与确认ID、128个待确认项，容量到达即拒绝，不能通过驱逐去重记录重放。dispose中止待处理工作、清空授权和确认并释放adapter。

这是进程内一次性批准；Worker重启不恢复待确认状态，跨进程去重与持久化属于T-008。无法撤回已发送输入，也不承诺拦截任意页面脚本导航或完全消除检查后竞态。

## 验证

单元测试：默认未知确认、规则保守合并、敏感handoff、origin拒绝、sender伪造、精确绑定、过期/拒绝/重复/改字段/导航/撤销/取消/容量及并发请求，无效批准没有execute调用。

真实Chrome在可重置fixture上证明：表单未批准无提交；批准恰一次；拒绝/过期/字段变化/导航后不提交；页面伪造批准无效；敏感表单接管；未授权链接与显式导航拒绝。用独立oracle核对提交数和业务内容。保留当前观察/控制回归证据；实际浏览器未通过时T-007不勾选完成。

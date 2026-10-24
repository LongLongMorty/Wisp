# T-012 原生侧边栏与扩展宿主

状态：实现与工程检查通过；原生Chrome回归环境阻塞，人工检查未执行，待补测。

生产WXT扩展ServiceWorker承载SDK、IndexedDB和Chrome debugger传输；React侧边栏只发送有版本/requestId的严格RPC。仅接受runtime.id一致、URL精确sidepanel.html、frameId=0、documentId存在，且runtime.getContexts核对为SIDE_PANEL的原生sender。tab页面、iframe、其他扩展页及payload声明身份均拒绝。

提供当前普通HTTP(S)tab选择、会话模型配置、精确origin授权/撤销、目标与限制/提取schema输入、任务进度/脱敏事件/结果证据、确认批准/拒绝、暂停/恢复/停止/接管、历史删除、unknown人工核对解除屏障。危险操作无自动批准。实时确认展示origin/动作/参数/过期时间，批准只提交confirmationId/decision。

权限声明sidePanel/tabs/storage/debugger及可选HTTP(S)host权限；由用户点击直接请求所需主机权限，后台另按精确origin校验，Chrome host权限不是任务授权。模型端点主机权限独立请求。默认无授权站点，无模型配置、无请求。密钥与配置只存storage.session，显式TRUSTED_CONTEXTS，不进入local/sync/IndexedDB/日志/响应。保存后清空输入；查询只返回配置元数据和hasKey，清除会话先停止任务。云端数据传输与费用未知明确展示。

grant/revoke与模型变更不从页面触发。网关创建时重新核对当前tab与会话授权，复用实际已验证的原生UI sender，不用伪造sender。确认临时绑定该次原生消息，串行提交；停止不排在模型请求后。关闭最后侧边栏连接暂停任务，重新打开不自动恢复；Worker重启按现有恢复规则暂停，密钥仍只在浏览器会话内。

RPC发起/恢复/确认/配置/授权/删除命令先将requestId及摘要预留到会话ledger，再执行。重复相同请求复用响应，异payload拒绝；Worker中断的预留返回OUTCOME_UNKNOWN，禁止自动重复。ledger上限256，不删除旧去重记录来继续执行。读取不占ledger；暂停/停止/接管/撤销/清密钥为安全收紧操作，不受ledger满或会话存储故障阻止，重复只会继续收紧，不触发页面写入。响应大小有界、错误只含固定码。授权每次请求检查，不因命中缓存跳过。

Q-005仍未闭合：不声称DOM事件能可靠区分CDP/物理输入。提供明确接管，Debugger断开/目标tab关闭会暂停；手动操作前应接管。不会以isTrusted伪造可靠自动归因。

验证：原生sender与伪造页/iframe拒绝、权限/会话秘密边界、请求重放/中断/并发、授权撤销/停止优先、历史保留与unknown不重发；真实打包扩展在原生SIDE_PANEL上下文做RPC/配置/授权/任务/确认/停止/重开/删除/人工布局检查。脚本模型与真实模型分别记录，不将Node宿主冒充生产Worker；T-014仍负责实际模型15次端到端验收。

API依据：[storage.session](https://developer.chrome.com/docs/extensions/reference/api/storage)、[原生消息上下文](https://developer.chrome.com/docs/extensions/reference/api/runtime)、[可选权限](https://developer.chrome.com/docs/extensions/reference/api/permissions)、[debugger](https://developer.chrome.com/docs/extensions/reference/api/debugger)。

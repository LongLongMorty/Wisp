# T-012 原生侧边栏与生产扩展宿主

日期：2026-10-18。状态：已完成；自动七组浏览器检查与五项人工检查均通过。

## 前置复核

核对T-011用户补测：观察14/控制20/策略17/MV3恢复24/循环10/SDK11项全部passed，static/tests/typecheck/build/sdkExample通过，任务开始时全部源码SHA-256匹配。保留T-011通过证据，后续修改由T-012独立回归验证。

## 交付

先编写[侧边栏规格](panel-v01.md)。生产WXT ServiceWorker现承载SDK、IndexedDB、会话模型适配、原生Chrome debugger传输与策略网关。React侧边栏提供模型配置、当前tab选择、精确origin授权/撤销、目标/schema/步骤上限、任务历史、事件/结果证据、确认批准/拒绝、暂停/恢复/停止/接管、unknown人工核对与历史删除。

原生sender必须匹配runtime.id、sidepanel.html、documentId与frame/lifecycle，再以runtime.getContexts核对真实SIDE_PANEL；普通扩展tab、iframe及payload伪造身份不获权限。确认sender临时绑定已验证原生消息，授权网关创建时重新验证上下文和精确origin。没有测试专用后门或自动批准。

密钥只保存在显式TRUSTED_CONTEXTS的storage.session，不进入local/sync/任务IndexedDB/日志/响应；保存清空密码输入，查询仅返回hasKey。模型与目标主机权限独立请求，后台另查Wisp精确origin；模型调用前复核主机权限，撤销模型主机权限会清配置并暂停任务。Chrome主机权限忽略端口的匹配能力不等同Wisp精确origin授权。

请求账本在浏览器会话内先预留后执行，重复请求复用结果、异payload拒绝，中断预留返回OUTCOME_UNKNOWN；上限256不忘记旧请求。停止/接管/撤销/清密钥为幂等安全收紧操作，不因账本满或会话保存失败被挡住。未知业务动作不自动重发。

同tab debugger连接等待旧拥有者清理再交接；正常detach不伪造成新拥有者用户干预。最后已验证侧边栏连接关闭/原生关闭事件、Debugger断开或目标tab关闭均暂停。Worker重启后旧租约失效约5秒再recover，不自动启动模型。

SDK增加受信任history/deleteRun/notifyInput/acknowledgeUnknown/recover管理接口；resume可重注册原schema，以支持先读取历史、再显式恢复且不重置预算。

## 工程验证

新增25项宿主测试与3项SDK管理/恢复回归，全量254项测试通过；static/tests/typecheck/build/sdkExample结果见[工程证据](evidence/t012-checks.json)。生产WXT产物实际编译，manifest校验拒绝默认全站host权限、content script、外部消息入口和web-accessible资源。构建保留可序列化页面函数，不对其做压缩改写。

测试覆盖原生身份拒绝、严格RPC、密钥边界、权限与Wisp授权分离、请求重放/并发/Worker中断/容量/存储故障、停止优先、授权及模型主机撤销、历史删除、schema恢复与可信接管通知。

首次全量复验暴露旧模型共享超时测试的负载敏感性：并发时100ms内第二次请求尚未发出，导致次数断言失败，见[首次工程报告](evidence/t012-initial-checks.json)。将该测试改为可控计时：第一请求后推进70ms，纠正请求到达后再推进30ms，必须在原100ms截止点超时；没有放宽时长或删掉次数/用量断言，生产模型实现未改动。

这些测试中的原生API与网关是替身；不能冒充真实Chrome、权限提示或UI布局通过。

## 浏览器与人工验收

```powershell
npm run panel:smoke
```

产生T-012独立七组证据：观察14、控制20、策略17、MV3恢复24、循环10、SDK11、原生侧边栏26项。原生探针使用WXT打包代码、真实ServiceWorker/SIDE_PANEL/IndexedDB/Chrome debugger/策略网关，以及本地确定性HTTP模型；不把普通扩展页或Node内存宿主冒充侧边栏。自动探针临时manifest仅增加loopback必选权限，实际权限提示不自动接受，需要另做人工验证。

## 补测修复记录（2026-10-18）

首次自动化补测暴露并修复以下缺陷（均保留失败原因，不手改证据为通过）：

- 产品缺陷：Chrome 侧边栏消息的 `MessageSender` 不提供 `documentId`（也不提供 `tab`），而 `authorize` 要求 `sender.documentId` 并用 `getContexts({documentIds:[...]})` 绑定，导致原生侧边栏的每个 RPC 都被 `PERMISSION_DENIED` 拒绝、面板完全不可用。修复：`host/controller.mts` 不再强制 `documentId`；`entrypoints/background.ts` 的 `isPanel` 改为要求 `sender.url` 等于 sidepanel URL 且 `sender.tab` 缺失，并确认存在匹配的 `SIDE_PANEL` 上下文（有 `documentId` 时仍按文档绑定），普通扩展 tab 与页面仍被拒绝。headed 与 headless 行为一致，确认是产品缺陷而非无头限制。
- 探针缺陷：`PANEL_CONFIRM` 的中间点击未声明 `expected` 后置条件，循环在页面异步更新“操作已记录”前立刻重新观察，导致模型重复提议点击并再次进入确认。修复：按契约给该点击补 `expected:[{kind:'text',includes:'操作已记录'}]`（不放宽任何断言）。
- 探针缺陷：重放 `run.start` 的断言用 `JSON.stringify` 比较，而 receipt 经 `storage.session` 往返后键顺序变化（内容相同）。修复：改为按 requestId/type/ok/data.runId 的结构化比较。
- 探针缺陷：`chrome.sidePanel.close()` 在 CDP 已附着面板文档时不会卸载该文档，面板端口不断开，故未触发暂停；直接用 `Target.closeTarget` 卸载面板文档（等价于真实关闭）后，运行正确转为 `paused`，证明产品“关闭即暂停”路径成立。

修复后 `npm run panel:smoke` 的七组检查全部 passed：观察14、控制20、策略17、MV3恢复24、循环10、SDK11、原生侧边栏26项；`t012-checks.json` 中除 `manualPanel` 外全部 `sourceHashesMatch=true`。

## 人工验收

自动化使用临时 manifest 副本仅增加 loopback 必选权限，不覆盖真实权限提示与人工可读布局。已由实际检查者使用未改动产物按[人工检查](panel-manual.md)完成权限提示、布局、确认展示、接管/停止与隐私五项，并记录：

```powershell
npm run panel:smoke
node scripts/record-panel-manual.mjs --passed=permissions,layout,confirmation,takeover,privacy --reviewer=local-user
node scripts/validate-toolchain.mjs t012
```

[人工证据](evidence/t012-manual.json) `status=passed`，`reviewer=local-user`，五项具名检查通过。七组浏览器检查完整 passed、五项人工记录 passed、源码与打包产物哈希全部匹配，综合 `t012-checks.json` `status=passed`，据此勾选 T-012。使用说明见[扩展README](../../apps/extension/README.md)。

## 保留边界

Q-005仍未解决：没有可靠DOM物理用户/CDP输入归因器；UI要求手动操作前先接管，不以isTrusted声称自动识别。会话RPC账本在浏览器重启/扩展重载后清除，持久化动作去重与unknown屏障仍由IndexedDB保留。最终目标/结果按历史规则保留，不承诺识别自由文本中的全部隐私。真实模型15次端到端成功率和性能采样仍属T-014。

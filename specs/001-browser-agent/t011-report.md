# T-011 SDK 与任务句柄

日期：2026-10-18。状态：已完成；实现与工程检查通过，真实Chrome SDK及共享层回归已复验通过。

## 前置验收

核对T-010用户补测：观察14、控制20、策略17、MV3恢复24、真实循环10项均passed；工程四项通过，全部记录的源码SHA-256与任务开始时文件一致。没有覆盖T-010通过证据；本任务对共享协议/运行时的修改由T-011独立回归验证。

## 交付

先编写[SDK规格](sdk-v01.md)，交付[@wisp/sdk](../../packages/sdk/README.md)：createAgent同步入口、异步ready、立即返回的任务句柄、result/snapshot/events/onEvent/pending/pause/resume/cancel/confirm、getRun重连及dispose。

沿用受信任gatewayFactory/modelFactory，避免绕过origin授权与动作确认。句柄取消不等待模型；paused/waiting_user不结算result。确认仅转交confirmationId/decision与受信任宿主sender，重复并发确认拒绝。恢复重新观察/鉴权并保持预算，旧drive释放后才启动新循环。初始化schema失败仍可查询failed任务快照。

事件从持久化journal回补，eventId由runId/seq的SHA-256确定；支持afterSeq、至多100项/60000字节分页、顺序交付、取消订阅、回调异常隔离和过旧游标报错。最多100个句柄、每句柄32个订阅，默认50ms轮询。

协议增加显式redacted元数据分支；原完整payload校验保留。原观察、填写参数、确认展示和验证原文未持久化时不重建或伪造。运行时新增安全状态字段、confirmation.required通知和临时提问读取；最终结果以snapshot/result获取，实时确认/提问以pending获取。提问仅在宿主内存中，暂停/重启清除。未校验payload getter不会被分支判断求值。

提供[可执行最小示例](../../packages/sdk/examples/minimal.mjs)，接入构建、类型检查、测试和T-011验收命令。修复测试暴露的暂停后立即恢复占用竞态，以及配置失败后无法读取持久化失败快照的问题。

## 验证

新增24项SDK/协议测试，全量226项测试通过；static、tests、typecheck、build与sdkExample结果见[工程报告](evidence/t011-checks.json)。最小例子实际运行completed并回放事件。

测试覆盖创建、成功/失败、等待不结束、取消与迟到决定、恢复与预算保留、确认身份/并发一次、重连、分页/稳定ID/顺序/裁剪、取消订阅、同步与异步回调异常隔离、输入/元数据校验及快照副本。

六组浏览器探针（观察14/控制20/策略17/MV3恢复24/循环10/SDK11）本轮全部passed，源码哈希与当前一致；早前一轮在首个检查前因Chrome GPU进程故障标为environment-blocked，复跑未复现。

```powershell
npm run sdk:example
npm run sdk:smoke
node scripts/validate-toolchain.mjs t011
```

smoke保存T-011独立观察14、控制20、策略17、MV3恢复24、循环10及SDK11项证据；本轮全部passed、检查完整、源码哈希一致；sdkExample通过；综合报告[t011-checks.json](evidence/t011-checks.json)为status=passed、各轮sourceHashesMatch=true、lockfilePresent=true，满足勾选条件，可进入T-012。WISP_CHROME可指定Chrome路径，无需模型密钥。

SDK探针以Node宿主/内存store/脚本模型接真实CDP与策略网关，验证立即句柄、证据完成、事件排序/稳定ID/脱敏、重新打开终态、等待与恢复、取消时限与无迟到导航、副作用oracle。MV3/IndexedDB由共享层独立回归覆盖，不冒充SDK生产ServiceWorker接线。

## 边界

SDK只供受信任宿主使用；页面消息不能直接获得SDK、store或sender回调。真实扩展传输、sender绑定与侧边栏仍属T-012。宿主dispose使旧本地Promise拒绝DISCONNECTED，重连创建新句柄，不复活旧Promise。事件是有界脱敏元数据，不是原始观察/动作详情档案。Q-005仍保留；实际模型15次端到端成功率与性能采样属T-014。

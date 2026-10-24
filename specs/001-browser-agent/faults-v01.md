# T-013 确定性与真实 Chrome 故障验收

状态：已完成；故障矩阵与真实Chrome复验通过。依赖 T-004–012；关联 AC-01–12。实际模型成功率和性能采样属于 T-014。

## 验收设计

复用七组真实浏览器套件，但在本次运行生成独立的 `t013-*` 证据，不复制 T-012 的通过记录。新增运行时与真实策略实现的组合测试：并发重复动作、载荷冲突、确认重放、审批期间撤销授权、确认前目标变化、取消期间迟到结果以及崩溃检查点恢复。组合测试仅替换浏览器与存储，不能冒充真实 Chrome。

故障矩阵逐项指定套件和断言名称；缺项、重复名称、失败、证据过期都不通过，不能仅凭总数量验收。真实 Chrome 使用已有引用身份、独立副作用 oracle、原生 SIDE_PANEL sender 和实际 MV3 Worker 终止探针。prepared/dispatching/responded/finished 四个终止位置必须分别记录恢复状态与无重发结果。

## 运行与证据

1. `npm run faults:smoke`：构建、确定性组合测试、七组真实浏览器检查、故障矩阵汇总。
2. `node scripts/validate-toolchain.mjs t013`：static/tests/typecheck/build/sdkExample，以及当前源码绑定的故障矩阵。

输出 `t013-deterministic.json`、七组 `t013-*-browser.json`、`t013-faults.json`、`t013-checks.json`。每次运行保留历史快照，当前证据记录时间、环境、失败原因、源码和生产构建 SHA-256。启动失败归为环境阻塞；已有断言后失败归为失败；二者均不满足验收。

T-013 通过需要工程检查、组合测试、七组浏览器与矩阵全部通过。沿用已完成的 T-012 人工验收，不重新声称完成权限弹窗或真实用户输入归因；若修改产品代码导致人工验收覆盖的行为变化，必须注明需要补验。Q-005 仍保留；fixture 模型不能替代 T-014 的真实模型任务。

## 需求追踪

| 验收 | 确定性测试与真实Chrome断言 |
| --- | --- |
| AC-01 | observer/control；semanticControls、replaceExisting、禁用/遮挡、openShadow |
| AC-02 | loop；search.actualDetail、singleActions、completedWithProof |
| AC-03 | loop extract.oracleFiveRows/boundSource；models/loop非法schema测试 |
| AC-04 | observer reference.*、control noReplacementClick；组合 changedTarget |
| AC-05 | control save.loadingNotComplete/failureIsNotSuccess；loop finish.unverifiedRemainsRunning |
| AC-06 | policy confirmation.*；panel confirm.*；组合 confirmReplay/revokedApproval |
| AC-07 | sdk cancel.*、panel stop.*及closeReopenPaused；组合 cancelLateResult |
| AC-08 | runtime worker四检查点；新增survivor五断言及组合recovery四检查点 |
| AC-09 | runtime lease、control deduplicate、panel request.*；组合 concurrentDuplicate |
| AC-10 | policy authorization.*、sensitiveFormHandoff；panel sender.*、privacy.*；protocol严格输入测试 |
| AC-11 | models超时/纠正/取消、loop持久化预算/无进展测试，由全量tests门禁执行 |
| AC-12 | observer预算与已有performance、panel历史删除/隐私；运行时保留策略测试。T-014另做发布性能采样 |

所有命名浏览器断言见 `fault-matrix.json`（127项），另有10项组合断言。全量267项测试由工具链门禁执行，不能用10项组合测试替代。

# T-013 故障验收实现报告

状态：已完成；实现、工程检查与真实Chrome复验均通过。

## 交付

- 先行规格 `faults-v01.md` 与可执行 `fault-matrix.json`：七组浏览器127项命名断言，另加10项组合故障断言；缺项、重名、失败、源码过期均拒绝通过。
- `packages/runtime/test/faults.test.mjs`：真实运行时与策略网关配合浏览器替身/内存store，覆盖并发去重、载荷冲突、并发审批、批准重放、撤销后重授、目标变化、读取期间撤销、取消迟到结果、四检查点恢复。
- `runtime-browser.mjs`：T-013额外运行真实MV3宿主存活、DedicatedWorker打开共享IndexedDB进行恢复、旧宿主返回的交叉场景。保留原四轮真正终止Worker场景。运行时套件由24项增加为29项；其余套件14/20/17/10/11/26项。
- `faults:smoke`生成独立t013证据，重跑前归档旧记录到 `evidence/t013-runs/` 并清除当前通过状态，防止子进程失败沿用旧通过证据。工具链新增t013入口，重新核对每份报告SHA-256、源码/构建指纹与命名断言。

## 发现与修复

首次新增组合测试9/10通过，responded恢复场景失败，原始输出见 `evidence/t013-initial-deterministic.txt`。新宿主恢复后清空run的sessionId/generation，但旧宿主的finish仅比较action宿主和tab generation。新宿主尚未申请新租约时，旧响应仍可把unknown改为finished，解除恢复屏障。

修复 `packages/runtime/src/runtime.mts` 的finish：同时核对run仍属于当前session及action generation；恢复已清除的宿主不能再写完成结果。保留取消后对已派发响应的记录语义。修复后10项组合测试全部通过，另有3项证据门禁反例测试；全量267项通过。

## 当前验证

`node scripts/validate-toolchain.mjs t013` 的static/tests/typecheck/build/sdkExample全PASS。`faults:smoke`真实Chrome在首个断言前GPU进程退出，七组报告为environment-blocked，未将启动失败视为产品通过；矩阵及综合状态为incomplete。无真实模型调用或费用。

## 复验结果

```powershell
npm run faults:smoke
node scripts/validate-toolchain.mjs t013
```

本轮在可运行Chrome上完成复验，`faults:smoke`生成`t013-faults.json`：故障矩阵137/137（观察14、控制20、策略17、运行时29、循环10、SDK11、原生侧边栏26）与10项组合故障断言全部通过，各套件`status=passed`、源码哈希一致。`t013-checks.json` `status=passed`、`faultMatrix` 八套件（含deterministic）`sourceHashesMatch=true`、`lockfilePresent=true`，据此勾选T-013。可用WISP_CHROME指定Chrome路径；原生侧边栏要求真实SIDE_PANEL，不回退普通tab。

T-012已完成人工检查按原产物记录保留，未改写为当前构建的人工证明。本次仅修改运行时完成结果的宿主隔离，没有改变权限/确认UI；新恢复行为已通过上述真实MV3回归。Q-005及实际模型15次任务/发布性能采样仍保留到后续任务。

# T-015 文档与需求追踪报告

状态：已完成文档范围；独立校验结果见[evidence/t015-checks.json](evidence/t015-checks.json)。T-014严格聚合incomplete保持原样，详见下文。

## 交付

- [安装与首次运行](../../docs/getting-started.md)：锁文件安装、构建与真实侧边栏加载、会话配置、授权、fixture及排查；没有声明本轮执行了全新联网安装。
- [SDK接入](../../docs/sdk.md)与[可执行示例](../../docs/examples/sdk-task.mjs)：受信任宿主边界、模型工厂预算回调、等待/恢复、完成条件、事件、原生选择及生产实现入口。新增例子无网络/Chrome且只读，不计入实际模型成绩。
- [权限与数据流](../../docs/security.md)：manifest权限、精确origin、过滤后出站信息、密钥与普通业务数据、存储/清理、批准与接管边界。
- [支持范围](../../docs/support.md)：声明125与实测156区分、原生控件/框架限制、Q-001/003/004/005遗留与Node实测范围。
- [验证说明](../../docs/verification.md)、[追踪表](traceability.md)/[机器清单](traceability.json)：5项US、17项FR、7项NFR、12项AC共41条的实现、证据及使用说明。

独立命令 `node scripts/validate-docs.mjs` 检查本地链接、41条覆盖、静态语法、生产构建、既有/新增SDK例子、发布证据复核与旧报告字节不变。它生成独立T-015证据，不运行模型/Chrome或重签旧阶段报告。

## T-014证据复核发现

实际项目的原始结果均passed：故障137/137、可靠性15/15、deepseek-flash三类各5/5、零未授权副作用、性能与四项人工。当前performance归档p95约29.9ms、停止约1.1ms；历史另有约31.5ms的一轮。

但T-015开始时，`t014-checks.json`与严格collectRelease为incomplete。live/performance/reliability唯一过期项是release-v01.md：实测后把“状态”行更新为已完成。内存中恢复旧状态行可精确重现原SHA-256，其他文件和代码/产物完全相同；manual当前指纹匹配，故障矩阵当前通过。

文档校验只接受这个精确可证明的状态行差异：每项原始判定仍须通过、每个非差异文件必须逐一匹配，任何代码或其他文档内容变化都会失败。它没有放宽T-014发布验证器，也没有改写其严格incomplete。原16份T-013/T-014报告字节不变，摘要写入T-015报告供复核。

T-015完成表示文档范围与独立校验完成；“所有机器发布报告全绿”仍需按冻结规格后的原流程复验。未发布Chrome商店/npm，没有把Q-005或任意网站兼容声明为已解决。

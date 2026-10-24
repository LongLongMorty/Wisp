# 验证与证据阅读

## 日常检查

```powershell
npm run check
npm test
npm run build
node scripts/validate-docs.mjs
```

文档检查会构建并运行两个确定性SDK示例、检查本地链接/需求覆盖、复核已有发布证据和产物。它不调用实际模型、不启动Chrome，也不替代浏览器或人工检查。T-015输出独立 `evidence/t015-checks.json`，不重写旧阶段报告。

## 发布复验

| 命令 | 检查范围 |
| --- | --- |
| `npm run faults:smoke` | 观察14/控制20/策略17/运行时29/循环10/SDK11/面板26 + 组合10，共137个断言 |
| `npm run release:reliability` | 普通字段、敏感过滤、原生/React选择、宿主完成条件等15项 |
| `npm run release:performance` | 200候选/200可见、30次observe、p95≤500ms；返回数受预算限制，不要求返回200；本地cancel<1秒、无迟到副作用 |
| `npm run release:live` | 已配置实际提供方后，固定三类各5轮；每类至少4次成功，所有轮零未授权副作用 |
| `npm run release:smoke` | 前述完整流程；故障/可靠性前置失败时不运行已配置模型的15轮 |
| `node scripts/validate-toolchain.mjs t014` | 工程检查与当前源码/构建、实测、人工证据的严格绑定 |

真实模型调用可能计费：最多600次HTTP尝试/15轮，总任务时限最多75分钟。仅在本机会话设置WISP_MODEL_ENDPOINT、WISP_MODEL_NAME和可选WISP_MODEL_API_KEY；密钥不进入仓库/对话。人工步骤见[发布人工检查](../specs/001-browser-agent/release-manual.md)，只能由实际检查者记录，不能复制既有通过。

## 已有成绩和证据边界

本地候选验证：`node scripts/package-candidate.mjs`，先确保文档与闭合证据当前有效（需要时依次执行 `node scripts/validate-docs.mjs`、`node scripts/validate-closure.mjs`）。候选工具在新目录离线安装锁定依赖，执行check/test/build及SDK示例，比较已验收扩展与两次隔离构建，生成源码/扩展ZIP和SHA256SUMS。记录见[T-017报告](../specs/001-browser-agent/t017-report.md)。工具不调用模型或启动Chrome；缓存不足会失败，不自动改为在线安装。联网补验需显式运行 `node scripts/package-candidate.mjs --online`。存在ZIP不等于通过，必须检查机器报告status。

实际归档的deepseek-flash三类各5/5，faults137/137、reliability15/15、四项人工通过。当前performance JSON为30样本、p95约29.9ms、返回115元素、状态取消约1.1ms；较早一次补测约31.5ms，具体结果以对应timestamp的JSON为准。测量包含本地CDP往返/观察/序列化，不含模型与导航等待，不能拿来声称云端任务总耗时。

T-015开始时复核发现：`t014-checks.json`目前为incomplete，而各项实测结果为passed。唯一差异是 `release-v01.md` 在实测后修改了状态行；在内存中恢复原状态行，SHA-256精确等于live/performance/reliability保存的原指纹。代码与构建及其余文件完全一致，人工记录当前指纹匹配。T-015记录这一精确文档差异，保留原报告，不把严格综合状态改写成passed。

T-016另设 `node scripts/validate-closure.mjs` 完成冻结证据复核，详见[闭合规格](../specs/001-browser-agent/closure-v01.md)和[复核报告](../specs/001-browser-agent/t016-report.md)。它固定16份原始报告摘要，重算现有结果门槛与全部代码/构建指纹，仅接受可以精确还原旧摘要的那一次状态行变化。输出为独立的 `t016-closure.json`，不会把旧严格聚合改写为passed，也不新增人工签字或付费模型运行。后续代码、规范正文或未冻结的状态变动均不能沿用本次例外。

阅读时区分旧严格报告、原实测成绩与新复核结论。若要求原t014验证器自身全绿，仍需在冻结规格后按原流程复验；不能手改哈希或伪造人工/模型记录。验收闭合不等于已经公开发布。

历史重跑在evidence/t013-runs、t014-runs等目录归档，失败不能从成功率分母中静默删除。一般先排除控制、观察、完成契约及端点配置问题，再重跑同一模型；不能靠换模型或放宽门槛掩盖失败。

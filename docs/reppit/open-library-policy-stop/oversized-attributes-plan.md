# 超长属性完整摘要 Implementation Plan

**目标：** 对目标或关联表单的有界超长属性生成完整摘要并绑定到指纹，让本次探针中的搜索按钮能进入原有确认流程，同时维持现有权限和安全边界。

**依据：** [方案 B](oversized-attributes-proposal.md) 与 [调研记录](research.md)。在已包含策略原因展示改动的隔离工作区继续；不将试验性修改合并到主工作区。

## 固定约束

- 单属性值长度 0–2,048 沿用原表示；2,049–65,536 对完整值摘要；大于 65,536、属性名超过 64 或属性数量超过 64 时继续标记不完整。
- 长属性按完整原始字符串长度计入现有 262,144 字符总预算；超过总预算保持不完整，不计算该属性摘要。节点、文本、目的地等其他限制不变。
- 对 `JSON.stringify(属性值)` 的 UTF-8 编码计算 SHA-256，避免不同孤立代理字符被 UTF-8 替换为相同字节；长值表示包含独立类型标记、属性名、原始长度和摘要，不能与短值表示混淆。
- 完整属性名与值、目标名称、字段值、URL 或密钥不得新增输出到日志、协议或持久数据；不豁免任何属性名。
- 异步摘要失败时不得将上下文当作完整或执行动作；已授权来源、敏感操作、确认和重检规则均不变。原 `value` 属性的既有处理保持不变。

## 阶段 1：上下文摘要与边界

**修改：** `packages/browser-chrome/test/policy-context.test.mjs`、`packages/browser-chrome/src/control-document.mts`。

- [x] 在 `policy-context.test.mjs` 增加目标属性与表单属性测试：长度 2,048 和 2,049 可完整处理；3,186 可完整处理；65,536 可完整处理，65,537 不完整；属性名超限、数量超限和总预算超限仍不完整。确认上下文输出不含原始长属性值。
- [x] 增加指纹测试：相同长值指纹稳定；同长度值末尾变化、不同属性名、长短表示混淆尝试及不同孤立代理字符均得到不同指纹；排序变化不影响指纹。保留敏感值现有行为的测试。
- [x] 增加摘要失败测试：通过受控的 `crypto.subtle.digest` 故障注入验证上下文拒绝或不完整；恢复全局状态，避免影响其他测试。
- [x] 运行 `node --test packages/browser-chrome/test/policy-context.test.mjs`，记录新增断言失败及退出码，确认测试能捕捉当前缺陷。
- [x] 修改 `control-document.mts` 的 `attributes` 为有界异步处理：分别构造带类型的短值和长值记录；长值摘要完整 JSON 字符串，按原始长度计预算，超限或错误保守处理；调用者对目标与表单摘要均 `await` 后再计算目标指纹。保持独立世界 `createDocumentController.toString()` 注入可运行。
- [x] 重跑 `node --test packages/browser-chrome/test/policy-context.test.mjs`，要求退出码 0、失败数 0；将命令、输出摘要及任何偏差记录到本文件后再推进。

## 阶段 2：策略确认与真实浏览器

**修改：** `packages/policy/test/policy.test.mjs`、`packages/browser-chrome/test/` 相关浏览器探针；必要时扩展 `fixtures/web/` 的受控页面。

- [x] 添加策略联动测试：具有完整长属性摘要的普通点击进入 `confirm`；确认前仅改变该属性值时，旧确认被拒绝且无浏览器副作用；敏感目标、超限和未授权目标仍按原规则拒绝或接管。
- [x] 在真实 Chrome 中建立带 3,186 字符属性的可控按钮场景，使用生产注入链、真实策略网关和确认流程验证：未确认前无点击、原样确认仅一次执行；值改变后旧确认不执行。补充超限场景以验证仍不能执行。
- [x] 运行新增测试和对应浏览器探针，记录实际命令、通过/失败数与浏览器版本；执行 `npm run check`、`npm run build`，均须退出 0。浏览器测试不可用或任一检查失败时停在本阶段，不声称通过。
- [x] 若规范中的上下文预算描述与当前代码有差异，在 `specs/001-browser-agent/policy-v01.md` 准确记录本次实现和既有约束，不改写历史验收证据；随后回写本计划结果。

## 阶段 3：回归及 Open Library 复测

**修改：** `specs/002-ticket-system/t018-open-library-trial.md`、本计划；必要时只在 `.cache/` 存放临时只读探针。

- [x] 运行 `npm test`、`npm run check`、`npm run build`；记录退出码及实际通过/失败数。
- [x] 在独立 Chrome 会话重跑 Open Library 搜索按钮探针，记录实际属性长度、上下文完整性和分类；不删除属性，也不执行点击。若结果不同，记录事实并重新调查。
- [ ] 使用本次构建的插件由用户复测原任务；记录实际事件、确认/接管、耗时和完整模型用量，不获取密钥。仅将该次运行结果作为该次证据。
- [ ] 将测试与试用结果写入试用报告及本计划；真实复测未完成时保持该步骤未勾选，不宣称 T-018 或修复完全通过。

## 执行记录

- 阶段 1：`node --test packages/browser-chrome/test/policy-context.test.mjs` 首次退出 1，8 项中 6 通过、2 失败，分别为 2,049 字符仍不完整和长属性变化不影响指纹。实现后同命令退出 0，8 项通过、0 失败。摘要故障测试只在长属性摘要调用时注入故障；未记录属性值。
- 阶段 2：`node packages/policy/test/long-attribute-browser.mjs` 输出 `Long-attribute browser: PASS; checks=16; browser=Chrome/156.0.8078.80`，退出 0。验证未批准不点击、属性变化使旧确认失效、重新确认仅执行一次，以及超限、敏感目标、未授权来源仍拦截。`node --test packages/browser-chrome/test/policy-context.test.mjs packages/policy/test/policy.test.mjs` 为 34 通过、0 失败；`npm run check` 和 `npm run build` 均退出 0。
- 偏差：长属性和策略联动断言放入真实网关与真实浏览器的 `packages/policy/test/long-attribute-browser.mjs`，而非再在只使用模拟上下文的 `policy.test.mjs` 中重复；现有策略单元测试仍一并执行。更新 `policy-v01.md` 以区分观察和策略上下文现行预算。
- 阶段 3 自动回归：`npm test` 退出 0，297 通过、0 失败；阶段 2 的 `npm run check` 与 `npm run build` 退出 0。
- 独立站点复测：`node .cache/policy-stop-stage/open-library-verify.mjs` 多次观察到目标 `data-i18n-ui` 长 3,186，但观察结果为 `truncated: true`、`unsupported_content`，策略依然 `handoff / INCOMPLETE_CONTEXT`。诊断在部分 `interactive` 时刻看到可见 `ol-popover` 与 `ol-carousel`（均未包含搜索按钮）；另一次观察后它们已不可见，显示页面状态有变化。一次 CDP 调用超时。不能据此把用户原任务归因于这些元素，也不能声称真实站点已修复。
- 追加调查：`node .cache/policy-stop-stage/unsupported-probe.mjs` 在独立页面的同次观察中记录 `ol-popover` 和 `ol-carousel` 触发 `unsupported_content`；等待加载后观察不再截断，组件已注册，其中一次在页面 `complete` 后同名按钮分类为 `complete: true`、`confirm / UNKNOWN_OR_WRITE_ACTION`。详见调研记录；该探针未点击按钮。自动检查及独立探针通过不等于真实用户任务验收通过。
- 用户会话复测：首次操作经确认并打开搜索框；第二次模型调用后的操作再次 `POLICY_STOP / INCOMPLETE_CONTEXT`，任务暂停，完整目标未完成。两次调用合计 28,934 输入、674 输出、29,608 总 tokens；底层原因与第二次动作目标未显示。详见 `specs/002-ticket-system/t018-open-library-trial.md`；真实任务尚未验收通过。

# 策略暂停原因展示 Implementation Plan

> 执行使用 superpowers:executing-plans；每个阶段独立验证并在本文件回写结果，再进入下一阶段。

**Goal:** 对新发生的策略暂停展示脱敏的具体原因，支持后续真实站点诊断。

**Architecture:** 保留既有 `POLICY_STOP` 状态及动作日志，额外写入一条 `action.result` 脱敏事件，其 summary 是固定白名单原因码；SDK 透传这些码，侧边栏映射为中文说明。未知原因统一为 `POLICY_REASON_UNKNOWN`，不改变策略决定和动作执行。

**Tech Stack:** TypeScript、Node 内置测试、React、WXT、Chrome MV3。

**Spec:** [方案 B](proposal.md)，现状见 [research.md](research.md)。

## 全局约束

- 不修改授权、确认、策略阈值、动作重放及恢复语义；只处理实际 `deny`/`handoff` 决定。
- 可记录的原因码仅限 `ORIGIN_NOT_GRANTED`、`DESTINATION_NOT_GRANTED`、`STALE_TARGET`、`UNSUPPORTED_WINDOW`、`NOT_ACTIONABLE`、`SENSITIVE_OPERATION`、`INCOMPLETE_CONTEXT`、`UNSUPPORTED_INPUT`、`SITE_RULE`；其余固定为 `POLICY_REASON_UNKNOWN`。
- 不记录目标文本、输入值、URL、密钥或任意异常信息；既有历史保持可读取且不补造原因。
- 不承诺旧任务原因可恢复；真实页面重试的诊断结果只属于该次运行。

## 审查重点

1. 未知或恶意原因字符串：仅记录固定回退码（阶段 1 测试）。
2. 旧事件没有原因：继续读取并显示通用暂停（阶段 2 测试）。
3. 正常执行、确认、非策略暂停：不得误报策略原因（阶段 1 测试）。
4. 持久事件和 SDK 输出不得包含输入、目标、URL 或任意字符串（阶段 1、2 测试）。
5. 多次暂停或重启后：原因事件按时间顺序展示，旧原因不替代新原因（阶段 2 验证）。

## 文件职责

- `packages/runtime/src/runtime.mts`：写入受限原因事件；`packages/runtime/test/runtime.test.mjs`：运行时行为及脱敏测试。
- `packages/sdk/src/index.mts`：白名单摘要透传；`packages/sdk/test/sdk.test.mjs`：事件格式、兼容性与脱敏测试。
- `apps/extension/entrypoints/sidepanel/App.tsx`：中文原因说明与回退；`apps/extension/test/` 现有面板测试：界面和历史行为。
- `specs/002-ticket-system/t018-open-library-trial.md`：记录重新试用的实际结果；本计划记录每阶段命令、输出及偏差。

## 阶段 1：产生并安全传递原因

- [x] 在 `packages/runtime/test/runtime.test.mjs` 增加真实 gateway 决定驱动的测试：`handoff/INCOMPLETE_CONTEXT` 和 `deny/DESTINATION_NOT_GRANTED` 保留原暂停及 abandoned 行为，并分别产生包含对应码的 `action.result` 事件；未知字符串落为 `POLICY_REASON_UNKNOWN`；确认、执行和非策略暂停不产生原因事件；断言事件不包含输入值、目标或 URL。
- [x] 运行 `node --test packages/runtime/test/runtime.test.mjs`，记录新增断言的失败输出，确认测试能捕捉缺失原因的现状。
- [x] 在 `packages/runtime/src/runtime.mts` 的 `finish` 中，仅在存活的 `deny`/`handoff` 决定上，将白名单原因或回退码作为新增 `action.result` 事件的 reason 写入；保留 `POLICY_STOP` 和现有阶段事件，不记录任意 decision 内容。
- [x] 在 `packages/sdk/test/sdk.test.mjs` 添加断言：新增已知码及回退码经事件转换保留，任意不受信任原因仍显示 `REDACTED`；旧事件和事件顺序不变。
- [x] 运行 `node --test packages/sdk/test/sdk.test.mjs`，记录新增断言失败；在 `packages/sdk/src/index.mts` 的 summary 白名单加入上述固定码。
- [x] 运行 `node --test packages/runtime/test/runtime.test.mjs packages/sdk/test/sdk.test.mjs`；要求退出码 0、失败数 0。记录命令、实际输出和偏差；失败时停在本阶段。

## 阶段 2：侧边栏展示

- [x] 在 `apps/extension/test/` 的现有面板测试增加可观察断言：原因事件显示对应中文解释；未知码显示通用提示；旧 `POLICY_STOP` 不伪造原因；两次不同暂停各自保留对应事件和顺序。
- [x] 运行该测试文件，记录新增断言失败；如现有面板测试无法在正确层验证渲染，先记录障碍并确定可运行的 UI 测试入口，不以源代码字符串断言替代行为测试。
- [x] 在 `apps/extension/entrypoints/sidepanel/App.tsx` 中将固定原因码映射为简短中文说明，保留原始 `POLICY_STOP` 与动作记录，不显示任意未知字符串。
- [x] 运行对应面板测试以及 `npm run check`、`npm run build`；要求退出码 0。用真实 Chrome 加载构建产物，检查已知原因及旧历史的呈现，记录观察结果；失败时停在本阶段。

## 阶段 3：回归与真实试用

- [x] 执行 `npm test`，记录实际通过数、失败数和退出码；执行 `npm run build`，记录结果。
- [ ] 使用新构建的插件在 Open Library 首页重试原任务，记录策略原因、动作阶段、是否接管、耗时及模型调用用量；由用户在现有 Chrome 会话运行，不收集密钥或页面原文。若未复现则明确记录，不能把结果归因于此前两次。
- [ ] 更新 `specs/002-ticket-system/t018-open-library-trial.md` 及本计划的验证结果；若发现原因只说明潜在缺陷，另走方案决策，不在本计划内放宽策略。

## 执行记录

- 基线：隔离工作区 `npm ci --offline --cache E:\Wisp\.cache\npm` 退出 0；首次 `npm test` 因内部包未构建报 `ERR_MODULE_NOT_FOUND`（72 通过、11 失败）。执行 `npm run build` 退出 0 后，`npm test` 为 290 通过、0 失败。
- 阶段 1：新增运行时和 SDK 定向测试先后因缺少原因事件及摘要被 `REDACTED` 失败；完成实现后执行 `node --test packages/runtime/test/runtime.test.mjs packages/runtime/test/faults.test.mjs packages/sdk/test/sdk.test.mjs`，72 通过、0 失败，退出 0。真实网关覆盖 `INCOMPLETE_CONTEXT`；未知原因和输入/目标脱敏、执行/确认/用户暂停不误报均有测试。
- 偏差：真实网关联动测试放在现有 `packages/runtime/test/faults.test.mjs`，因为该文件已有实际网关夹具；白名单恶意值使用可控网关测试。
- 阶段 2：新增 Chrome 原生侧边栏测试先在原因展示步骤超时（`Native panel: failed; checks=10`）；实现映射后，`$env:WISP_PANEL_POLICY_EVIDENCE='1'; node apps/extension/test/panel-browser.mjs` 输出 `Native panel: passed; checks=30`，退出 0。覆盖真实策略原因、人工注入的旧 `POLICY_STOP` 和未知原因事件及顺序；注入的事件只用于界面兼容性，不是实际策略运行证据。`npm run check`、`npm run build` 均退出 0。已查看无头 Chrome 侧边栏截图；截图显示整体面板，原因文本由 DOM 断言验证。
- 偏差：浏览器脚本支持 `WISP_PANEL_POLICY_EVIDENCE=1`，将本次报告写入缓存以免覆盖历史证据。旧事件与未知原因通过测试 IndexedDB 注入，真实网关原因来自实际运行。
- 阶段 3 自动回归：`npm test` 退出 0，294 通过、0 失败；`npm run build` 退出 0，输出 `WXT MV3 manifest and entry resources: PASS`。
- 真实 Open Library 复测：用户报告执行到 `POLICY_STOP`，新事件显示“页面上下文不完整，需要人工接管。”，对应 `INCOMPLETE_CONTEXT`；一次调用 8,849 输入、160 输出、9,009 总 tokens。详见试用报告。未提供耗时、接管及最终结果；具体截断来源和此前两次原因未确认。策略行为保持不变。

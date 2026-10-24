# T-014 发布验收实现报告

状态：已完成；自动验收（含实际模型15轮）与四项人工检查均通过，T-014已勾选。

## 实测后的设计修复（v0.2）

保留下文两个DeepSeek模型的原始失败成绩，未换模型、未降低门槛。修复规格见[reliability-v02.md](reliability-v02.md)：

- 观察返回普通字段的脱敏有界value及原生select选项/选中状态，敏感字段及不完整扫描不暴露值。标签剔除嵌套控件文字，保持“状态”等名称稳定；观察仍遵守预算。
- 新增selectOption贯穿协议、控制桥、策略与模型提示。原生单选精确value匹配，input/change后验证；拒绝旧引用/缺失/禁用/重复选项，执行后不确定保留unknown。程序事件不冒充可信用户输入；自定义/多选不支持，策略默认仍确认。
- SDK与面板RPC接受首次配置后不可降低的completionConditions，暂停/恢复沿用；finish和提取均验证宿主条件与模型条件并集。搜索宿主仅提供任务标题和详情路由前缀，不泄露oracle记录ID。模型只报URL也必须通过标题验证。
- 提示v0.2补多条件finish、完整按键名单、selectOption、字段状态与填写完整性说明；历史记录目标ref/派发/验证/错误元数据，不写字段值。修复失败reason滞留STARTING，live报告补stopReason/failureCode。
- 新增独立15项真实Chrome可靠性探针，完整release:smoke在故障/可靠性前置失败时不发起已配置模型的15轮请求。实际模型运行仍由同一提供方/模型完成，脚本探针不计入成功率。

当前进程没有模型环境配置，不能自动重跑用户本地的DeepSeek会话，也未读取/持久化临时密钥。变更后旧证据需按新源码重新生成；不将旧成绩写成通过。

建议先 `npm run release:reliability`（原生/React选择及宿主完成条件），通过后在配置同一DeepSeek模型的会话执行 `npm run release:smoke`，再完成四项人工检查及t014工具链验收。修复交付不等于T-014已通过。

v0.2本轮工程验证：290项测试全PASS（较275项新增15项），static/typecheck/build/sdkExample全PASS。新可靠性探针与浏览器回归在首个断言前GPU启动崩溃，状态environment-blocked；实际模型not-configured、人工not-run。五组release依赖的sourceHashesMatch均true，综合incomplete。旧实测失败和本轮重跑记录均由脚本归档保留；没有将脚本模型计入实际模型成绩。

## 交付与边界

先行规格见[release-v01.md](release-v01.md)。新增实际模型15轮运行器、性能采样、四项人工检查记录器与t014工具链入口。每类固定5轮，每类≥4轮通过，任何副作用均阻断；不能重排、删掉失败轮或用脚本模型计入分母。独立核对搜索详情URL/文本、表格真实筛选控件及五条完整数据、表单实际字段和提交确认。门禁重新根据保存的fixture结果与真值计算判定，不只读取status或声称的成功次数。

模型使用受信任Node宿主调用真实HTTP端点，经过生产运行时/策略/CDP操作真实Chrome，存储采用每轮全新的内存store；它没有宣称15轮发生于生产侧边栏。当前源码的T-013原生MV3/侧边栏回归与本轮人工检查另设门槛。未改动产品代码或放宽策略。正常搜索沿用T-010报表任务，含“登录”等关键词的目标仍可能被保守转人工。

性能使用真实performance页面200个可见按钮、30次连续完整observe，保留原始样本与p95；另测挂起模型期间本地cancel响应及零迟到副作用。该挂起模型是明确标识的替身，不计入15次实际模型任务；UI停止时限由真实检查者另外测量。

## 初版执行与补测记录（历史）

- 新增8项门禁行为测试通过；全量275项测试、static/typecheck/build/sdkExample全PASS，lockfilePresent=true，见 `evidence/t014-checks.json`。
- 当前进程未设置WISP_MODEL_ENDPOINT/WISP_MODEL_NAME，实际模型报告为not-configured，未发生真实模型请求或费用。
- 补测修复性能门禁：原`performancePassed`要求`returnedElements===200`，与24,000字符观察预算（实测返回115个）及NFR-006（200可见候选+p95）冲突；现改为要求页面200候选/200可见、返回元素>0、p95≤500ms、停止<1s且无迟到副作用。修复后`npm run release:performance`通过：30样本、p95≈31.5ms、returnedElements=115、stop stateMs≈1.1ms。
- T-013故障矩阵重跑137/137 passed；综合仍为incomplete，仅因实际模型not-configured与人工not-run。
- 四项发布人工检查未进行，manual为not-run。既有T-012人工通过记录未复制到本轮。
- T-013完成记录按原源码保留；本轮复验通过故障运行器归档旧证据后生成当前结果。Chrome环境阻塞不能冒充当前源码的回归通过。

最终 `t014-acceptance.json`及综合报告为incomplete，live/performance/manual和当前faultMatrix均sourceHashesMatch=true；状态不是源码过期造成，仍需实际执行通过。每次重跑先归档到 `evidence/t014-runs/`，T-013回归另有独立归档。报告包含环境/版本、配置摘要、提示源码SHA-256、15轮预算/用量/journal和有界业务证据，不保存密钥、模型原文、请求头或完整DOM。

## 补验顺序

在运行验收的本地终端设置实际提供方的WISP_MODEL_ENDPOINT、WISP_MODEL_NAME、WISP_MODEL_API_KEY（可选WISP_MODEL_JSON_MODE=off），不要把密钥发送到对话或写入仓库。

```powershell
npm run release:smoke
```

该命令先重跑当前T-013故障矩阵，再运行真实模型15轮和独立性能采样；人工未记录时非零退出且incomplete属于预期。可单独用 `npm run release:live` 或 `npm run release:performance` 补跑对应项，失败轮会归档。任何重跑均不能删除失败记录或手改证据。

随后由真实检查者按[release-manual.md](release-manual.md)完成四项、创建观察记录并运行：

```powershell
node scripts/record-release-manual.mjs --passed=confirmation,pauseResume,capability,dataFlow --reviewer=local-user --notes=.cache/t014-manual-notes.json
node scripts/validate-toolchain.mjs t014
```

## 实际模型执行结果（本轮）

v0.2源码复验时又发现并修复两个缺陷：

- T-013控制探针仍按旧标签名查找React受控输入（v0.2稳定标签名后变为`React输入 initial`），导致控制套件0项通过、矩阵降到117/137。改为按`React输入`前缀匹配后，矩阵恢复137/137。
- 运行时提取完成缺陷：`packages/runtime/src/loop.mts`把完整的`ExtractionResponse`（含`usage`/`providerRequestId`）写入`RunResult.extraction`，而结果schema只允许`schemaId/data/source`，`runtime.complete`因此抛`Invalid protocol field: extraction.fields`。脚本模型不带usage所以此前未暴露；真实模型带usage时table提取必然失败。现只保存`schemaId/data/source`。

修复后使用临时DeepSeek密钥、`deepseek-flash`实际执行15轮（每场景5轮，真实HTTP/运行时/策略/CDP，每轮独立内存store）：

- search 5/5、table 5/5、form 5/5，全部 `noEffects=true`，`score={complete:true,safe:true,passed:true}`，`t014-live.json status=passed`。
- 更早的失败样本（含`deepseek-v4-pro`与flash的3/5）已按脚本归档，未删除或改写。

复验顺序：故障矩阵137/137、独立可靠性15/15、性能（30样本p95≈31.5ms）、实际模型15轮均passed；四项人工检查（confirmation/pauseResume/capability/dataFlow）由实际检查者完成并以reviewer=local-user记录，`t014-manual.json status=passed`。`t014-acceptance.json status=passed`，五套件（live/performance/reliability/manual/faultMatrix）均`sourceHashesMatch=true`，据此勾选T-014。

## 已知限制

Q-005真实用户与程序输入来源仍不能可靠区分，未知信号保守暂停。跨域iframe、支付/密码/验证码等能力不在支持范围。固定fixture的实际模型结果不代表任意网站可靠；观察/摘要有限，修复后v0.2的15轮成功率尚未测得，旧版两模型成绩保留如上。发布前仍需满足真实模型各类≥4/5、所有轮零未授权副作用、性能/停止门槛、人工记录和当前源码全部指纹匹配。T-015文档与追踪核对留待本任务真实完成。

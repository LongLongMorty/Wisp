# 决策与待验证事项

## 2026-10-20 T-015文档与追踪交付

交付docs安装/SDK/权限数据流/支持范围/证据说明及可执行只读SDK例子，41条US/FR/NFR/AC逐项连接实现、验收与局限。根README作为当前入口，包内阶段README保留历史，避免仅为状态说明改动已验收源码清单。文档验收使用独立validate-docs脚本，不触发模型/Chrome、不改原T-013/T-014 JSON。

复核实际项目全部passed，但T-014严格综合JSON为incomplete。唯一差异为release-v01.md在实测后更新状态行；内存恢复旧状态行精确重现旧SHA-256，其他源文件/构建均一致。独立文档复核仅接受这个可证明的差异并记录原严格状态；任何其他代码/文档变化都会失败，不修改原发布门槛。T-015完成表示文档交付完成，不声称旧综合报告已转绿、已公开发布或Q-005已闭合。见[t015-report.md](t015-report.md)。

## 2026-10-18 T-014实测后的框架修复

DeepSeek实测暴露观察与执行契约不足，优先修复框架而不换模型规避。普通字段/选择状态补入脱敏有界观察，selectOption为固定原生单选操作且验证结果，保持默认确认/敏感接管/授权与unknown屏障；自定义和多选不支持，事件不冒充用户。模型选择值须来自当前观察中唯一且启用的选项。

完成条件由受信任宿主声明并持久化，首次配置后不能降低；模型finish/提取均不能省略宿主条件。URL前缀避免把oracle记录ID作为答案传给模型。提示与任务版本0.2，历史只含目标ref/验证等元数据，普通字段值由当前观察提供。补错误reason/stopReason，保留原失败结果；新增确定性回归与15项真实Chrome可靠性门禁，先验证控制再跑同一模型，前置失败不产生15轮付费调用。T-014已通过真实模型15轮与四项人工验收并勾选。

## 2026-10-18 T-014发布验收运行器（实际模型未达门槛）

开始时复核T-013矩阵137/137 passed及当前源码指纹。新增固定三类各5轮的真实模型运行器、独立fixture结果判定、30次真实Chrome观察采样、挂起模型取消测量、四项带观察记录的人工验收和t014工具链门禁。实际模型不使用脚本输出，普通搜索/筛选仅在fixture明确站点规则下放行，提交仍需原策略确认；目标名称包含登录等词时的保守接管不放宽，正常搜索沿用T-010报表任务并在调用模型前固定版本。

补测修复性能门禁：原`performancePassed`要求`returnedElements===200`，与24,000字符观察预算（实测返回115）及NFR-006（200可见候选+p95）冲突；改为要求200候选/200可见、返回元素>0、p95≤500ms、停止<1s且无迟到副作用。修复后`release:performance`通过（30样本、p95≈31.5ms、returnedElements=115、stop≈1.1ms），T-013矩阵重跑137/137 passed。

随后用临时DeepSeek密钥实际执行15轮：`deepseek-flash` search 0/5、table 0/5、form 1/5；`deepseek-v4-pro` search 0/5（business正确但完成证据缺title文本条件）、table 0/5（下拉未改变、第3次决策后失败）、form 3/5。无未授权副作用，但无场景达到≥4/5，score.passed=false。可复现原因包括系统指令finish示例只演示url单条件、table的pressKey下拉操作未成功、表单填写不稳定。未修改门槛或改用脚本模型；人工仍未执行。要达成门槛需换更强模型或先修复finish示例/下拉操作后重跑。见[release-v01.md](release-v01.md)、[t014-report.md](t014-report.md)。

v0.2源码复验。又修复两个缺陷：T-013控制探针仍按旧React标签名查找，v0.2稳定命名后控制套件0项通过、矩阵降至117/137，改为`React输入`前缀匹配后恢复137/137；`loop.mts`把含`usage`/`providerRequestId`的`ExtractionResponse`整体写入`RunResult.extraction`，触发`Invalid protocol field: extraction.fields`，真实模型table提取必失败（脚本模型无usage故此前未暴露），改为只存`schemaId/data/source`。修复后：故障矩阵137/137、可靠性15/15、性能通过；`deepseek-flash`实际15轮 search 5/5、table 5/5、form 5/5，`live=passed`。四项人工检查（confirmation/pauseResume/capability/dataFlow）由实际检查者完成并以reviewer=local-user记录，`manual=passed`；`t014-acceptance.json status=passed`，据此勾选T-014。见[t014-report.md](t014-report.md)。

Node受信任宿主/内存store的15轮不冒充生产扩展实际模型15轮；原生宿主由当前T-013回归与本轮人工覆盖。发布结果绑定源码/生产构建/脚本，保留失败与重跑记录。

## 2026-10-18 T-013完成

T-012原产物自动/人工证据已通过，保留原记录。T-013增加显式137项断言矩阵、10项运行时/策略组合故障测试和5项真实MV3旧宿主存活回归，重跑独立t013证据并归档旧记录。全量267项及static/typecheck/build/sdkExample通过。

组合测试暴露真实恢复缺陷：recover清除run宿主后，旧宿主finish仍可接收迟到响应，将unknown变为finished。现同时检查run.sessionId和run.generation，阻止已被恢复的旧宿主写入结果；首次失败输出保留。真实Chrome复验：故障矩阵137/137（观察14/控制20/策略17/运行时29/循环10/SDK11/侧边栏26）与10项组合断言全部passed，各套件sourceHashesMatch一致；综合t013-checks.json status=passed。复验见[t013-report.md](t013-report.md)，未复制T-012证据冒充本轮。

## 2026-10-18 T-009完成

新增@wisp/models脚本队列与显式配置的Chat Completions兼容HTTP适配。采用本地严格Decision校验和有限JSON Schema子集，未知关键字拒绝；提取来源由输入观察绑定。响应体有界，总超时覆盖格式纠正与读取；最多一次纠正，无HTTP错误自动重试或隐式模型切换。用量只记录服务返回的已知token量，无价格配置不估算费用。每次请求前通过onAttempt提供预算入口，单步循环与全局预算留T-010。

新增28项测试，全量175项与工程检查通过。真实端点复验使用 DeepSeek 的 OpenAI 兼容 Chat Completions 端点（JSON object 模式，`deepseek-flash`）：decide 与 extract 两项均通过，requestCount=2；live证据[t009-model-live.json]status=passed、四轮工程检查通过、sourceHashesMatch=true。Q-004部分闭合：已确认一个可替换端点的请求结构与决定/提取响应兼容；扩展上下文的CORS、更多提供方与端到端任务成功仍待验证。不使用HTTP fixture替代真实模型验收。见[模型规格](models-v01.md)和[T-009报告](t009-report.md)。

## 已采纳的初始方案

| 编号 | 决策 | 理由与影响 |
| --- | --- | --- |
| D-001 | 扩展作为首个宿主，控制层与Runtime独立 | 对齐真实浏览器登录态和开发者复用目标；网页内嵌宿主后续另立spec |
| D-002 | 先端侧执行，不强制端侧推理 | 先解决可靠执行；模型端点通过适配器替换 |
| D-003 | 一次一个动作，执行后再观察 | 减少基于过时状态连续执行；牺牲部分吞吐换取可验证性 |
| D-004 | DOM语义摘要优先，CDP输入；视觉定位后置 | 控制首版复杂度；Canvas与复杂视觉控件明确不支持 |
| D-005 | 旧引用拒绝，不自动匹配相似节点 | 降低错误目标执行风险；必要时重新观察规划 |
| D-006 | unknown结果先核对，禁止自动重发 | 网页副作用不提供统一幂等保证；本地去重不能保证远端exactly-once |
| D-007 | 写入和未知语义默认确认，高风险转人工 | 适配真实登录环境；启发式识别存在局限，不宣称完美分类 |
| D-008 | 以任务检查点与动作日志恢复 | 不依赖Worker常驻，不跨重启复用DOM引用 |
| D-009 | 第一版密钥仅会话内持有 | 降低持久化凭据处理范围；浏览器重启后需重新配置 |
| D-010 | 不直接复制参考项目作为基础代码 | 先明确自身契约；确需复用时核对具体版本、许可、依赖和运行边界 |

这些是可修改的项目设计，并非已经完成的能力。

## 技术验证清单

| 编号 | 问题 | 默认处理 | 解决时点 |
| --- | --- | --- | --- |
| Q-001 | Chrome最低版本、debugger附着与detach实际行为 | 暂按125+，探针验证并记录 | T-001 |
| Q-002 | DOM节点身份如何跨观察保存，移除重建如何可靠失效 | 私有注册表，不用文本匹配替代身份 | T-001、005 |
| Q-003 | CDP输入对受控输入、contenteditable和open Shadow DOM是否符合范围 | 对fixture验证；失败则限定支持控件并同步spec | T-001、006 |
| Q-004 | 首个实际模型端点、CORS与请求结构兼容性 | 提供方可替换；先验证一个端点，不承诺全部兼容；T-009已确认一个DeepSeek兼容端点，CORS与更多提供方T-014复核 | T-009前 |
| Q-005 | 用户手动干预检测与程序输入如何区分 | 输入/导航信号结合执行检查；检测不可靠时保守暂停 | T-001、008 |
| Q-006 | 500ms观察门槛是否在目标机器可达 | 记录基线，优化或明确修改规格，不静默放宽 | T-005、014 |

## 后续候选，非v0.1承诺

- 业务工具注册与页面协作协议，优先使用应用明确提供的领域能力。
- 多标签页、同源及跨域iframe控制，完整frame/session路由。
- 截图、视觉定位与视觉后置条件。
- 浏览器内WebGPU推理与自动模型路由。
- 站点技能、可复用工作流和更丰富的开发者调试工具。

## 参考资料

仅用作工程背景，落地时核对实际版本与源码：

- [Nanobrowser](https://github.com/nanobrowser/nanobrowser)：扩展形态和浏览器控制层参考。
- [Chrome Service Worker生命周期](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)：检查运行时终止和存储设计。
- [Chrome debugger API](https://developer.chrome.com/docs/extensions/reference/api/debugger)：检查控制能力与连接边界。
- [Midscene](https://github.com/web-infra-dev/midscene)、[Stagehand](https://github.com/browserbase/stagehand)：API表达与自动化设计参考，不作为端侧可直接复用的保证。

## 2026-10-18 T-001完成

早前的浏览器子进程崩溃未复现；补充React用例后复跑，12项检查全部通过。见[t001-report.md](t001-report.md)与[evidence/t001-attempts.json](evidence/t001-attempts.json)。

| 编号 | 结论 | 遗留 |
| --- | --- | --- |
| Q-001 | debugger在Chrome156上的attach/detach实际行为已验证；`minimum_chrome_version=125`声明可加载 | 本机无更旧Chrome，125最低版本回归未做，基线暂保留 |
| Q-002 | 私有注册表身份可行：无关变更保持同一节点引用，节点替换后旧引用失效且不重绑新节点 | 协议化引用T-005实现 |
| Q-003 | CDP可信输入覆盖原生input、contenteditable、open Shadow DOM与React 18.3.1受控输入 | 仅固定一个React版本；其他框架后续回归 |
| Q-005 | 未闭合：程序输入与用户输入区分仍待验证 | T-008处理，检测不可靠时保守暂停 |

关键发现：本用例中普通赋值加合成事件没有同步受控状态，而原型setter加合成事件可以。本版选择CDP作为统一输入路径，这是一项工程决策，不是CDP唯一可行的证明；isolated world中的tracker可见性尚未直接验证。

## 2026-10-18 离线工程骨架

复测Chrome曾因GPU子进程异常退出；npm官方注册表连接返回EACCES，缓存不足。采用plan中的T-002a/T-003a拆分，暂用npm workspace、ESM与.d.ts声明推进纯协议模块。WXT/TypeScript/React与Vitest保持后续目标，不声明已安装、编译或验证。上述Chrome阻塞随后未复现，T-001已完成；npm经可达镜像恢复运行。

## 2026-10-18审查修正与T-002b迁移

React结论已收紧；导航断言只接受目标URL成立后的上下文失效错误，已于2026-10-18T02:50:23Z复验通过，12项检查全绿。历史12项成功与当前代码分别记录，不覆盖历史证据。T-002b已完成TS/WXT/React源码及命令迁移，并在可达镜像下装入依赖、生成真实package-lock.json，静态检查、协议测试、类型检查与生产构建全部通过；见[t002b-report.md](t002b-report.md)。环境曾出现的npm请求EACCES为瞬态，复跑后恢复，历史失败记录保留。

## 2026-10-18 T-003b完成

Observation、结果、模型决定、确认、消息和事件均有严格schema，36项协议测试与正式构建通过。发送方角色从受信任传输上下文提供，消息不能自行声明。事件仅记录模型用量和动作元数据，不接受原始推理或填写值；真实鉴权、脱敏和执行策略仍需后续集成。完整结构与边界见[protocol-v01.md](protocol-v01.md)和[t003b-report.md](t003b-report.md)。

## 2026-10-18 T-004交付

本地站点采用独立会话与三端口分离；业务事实由控制服务提供，不向模型暴露oracle凭据。generation阻止重置前的异步请求污染新状态。52项测试与工程检查通过；真实Chrome页面smoke已复验，Chrome156下14项页面断言全部通过（早前的GPU进程故障未复现）。此结果只证明fixture可被真实浏览器与CDP驱动，不等于Agent的AC场景通过，见[t004-report.md](t004-report.md)。

## 2026-10-18 T-005完成

只读观察模块与私有引用注册表在真实Chrome通过验收（14项，p95≈19.2ms）。Q-006初步闭合：本机Chrome156对200候选按钮fixture采样30次，p95约19.2ms，远低于500ms门槛；因24,000字符总预算返回约115个元素，裁剪行为符合规格。Q-002进入协议化引用实现：无关变更保持身份、替换/同对象重插/作用域过期/导航均按规则拒绝旧引用并通过验证。观察仅覆盖本地fixture与open Shadow DOM，任意网站可靠性与规模化p95由T-014复核，见[t005-report.md](t005-report.md)与[观察规格](observer-v01.md)。

## 2026-10-18 T-006完成

BrowserAdapter提供capabilities/observe/execute/verify/dispose，控制层可由受信任宿主独立导入，不依赖模型或侧边栏。真实Chrome复验：观察回归14项（p95≈23.2ms）、控制演示20项全部通过。动作前检查（可见、disabled/aria-disabled/inert、视口中心遮挡、open Shadow DOM命中、两次50ms几何稳定、输入前焦点）与条件等待在fixture上验证；无expected不宣称页面响应或业务成功。同ID同payload在实例内复用结果、异payload拒绝、缓存上限256条。跨Worker去重、origin授权/动作分类/一次性批准与exactly-once仍留T-007/T-008，见[t006-report.md](t006-report.md)与[控制规格](control-v01.md)。

## 2026-10-18 T-007完成

@wisp/policy提供纯分类器与独占tab执行网关：origin授权/撤销、保守站点规则、未知动作确认、敏感接管、一次性批准绑定（run/tab/action/授权版本/文档/目标指纹/字段摘要/完整参数，30秒有效），执行前重读页面并重新分类，批准消费后失败也不恢复。真实Chrome复验：观察回归14项、控制回归20项、策略17项全部通过；策略检查含UI sender伪造、批准/拒绝/重放、改字段/目标/过期/撤销/导航/换参数拒绝、formaction与Enter覆盖目的origin拒绝、敏感表单接管且上下文不含字段值、越权链接与显式导航拒绝，最终oracle仅一次有效提交。

补测中发现并修复一处桥接缺陷：`packages/browser-chrome/src/chrome.mts`的页面求值包装对异步`control.context()`用同步IIFE，CDP `awaitPromise`未等待内层Promise，导致策略上下文缺`origin`。改为异步IIFE并`await`后修复；同步路径不受影响。修复后回归重跑T-005/T-006观测/控制证据以绑定当前源码。Q-005仍未闭合（用户干预区分），留待T-008；真实sender与确认UI由T-012提供。见[t007-report.md](t007-report.md)与[策略规格](policy-v01.md)。

## 2026-10-18 T-008完成

已复核T-007异步桥接修复及重新绑定的通过证据，并新增直接求值/异步拒绝/观察器所有者释放的桥接回归测试。@wisp/runtime提供同步事务契约、确定性内存实现与真实IndexedDB实现；任务/动作/租约/journal原子提交，prepared→dispatching→结果检查点，重启后prepared/待确认变abandoned、dispatching变unknown，原actionId持久化去重，unknown屏障即使租约过期也阻止新写入，reconcile仅验证原expected通过才解除；删除历史保留有界动作ID tombstone，新代次等待旧输入清理。真实Chrome/MV3实测：观察回归14项、控制回归20项、策略回归17项、运行时恢复24项全部通过（含强制stopAllWorkers四次重启、双Worker同tab租约、真实IDB事务回滚、isTrusted但无法归因的输入保守暂停）。综合报告t008-checks.json status=passed、四轮sourceHashesMatch=true。

Q-005仍保留：没有可靠的用户/程序输入DOM归因器；`notifyInput`只面向受信任宿主，无法归因时unknown并暂停，测试中的两种可信输入不构成物理用户归因证明，需后续扩展接线与人工验收，不以isTrusted声称识别用户。见[t008-report.md](t008-report.md)与[运行时规格](runtime-v01.md)。

## 2026-10-18 T-010完成

T-009实际模型决定/提取补测与全套工程证据已验收，任务开始时源码哈希一致。T-010在既有运行时新增configureLoop/step/drive、schema绑定、持久化预算和有限元数据摘要；完成候选须真实验证，提取须schema/来源/观察复核。模型尝试先事务预留额度，正常结束返还未用部分，崩溃保守保留；代次检查阻止旧drive接管恢复后的任务。新增27项循环测试，全量202项及工程检查通过。

真实Chrome复验：观察14项、控制20项、策略17项、MV3恢复24项、循环10项五组全部通过，sourceHashesMatch一致；综合报告t010-checks.json status=passed。循环检查使用脚本模型连接真实Chrome/CDP与真实策略网关，验证搜索→详情→证据完成、表格前五条编号经独立fixture数据核对、提交前确认零副作用、假完成拒绝。生产扩展模型接线与实际模型端到端15次成功率仍属T-011/T-012/T-014，不据此宣称完成。Q-005仍保留。见[循环规格](loop-v01.md)与[T-010报告](t010-report.md)。

## 2026-10-18 T-011完成

核对T-010五组浏览器与工程报告通过且源码哈希一致后进入T-011。SDK使用受信任gatewayFactory/modelFactory和原生sender回调，run立即返回句柄，result仅真实终态解析；暂停/取消优先于模型等待，确认后串行继续，getRun重建本地句柄且不自动恢复。宿主关闭拒绝旧本地Promise而不伪造持久化终态。

持久化journal不包含原始观察/填写值，协议补充明确redacted元数据变体以回补，不构造虚假完整payload。稳定事件ID、分页、游标错误、订阅取消与回调异常隔离均有测试。运行时补状态字段、确认通知、临时提问读取和配置错误码规范化。新增24项SDK/协议测试，全量226项和工程检查通过，最小示例成功。

真实Chrome复验：观察14、控制20、策略17、MV3恢复24、循环10、SDK11六组全部通过，sourceHashesMatch一致；sdkExample通过；综合报告t011-checks.json status=passed。SDK探针以Node宿主/内存store/脚本模型接真实CDP与策略网关，验证立即句柄、事件排序/稳定ID/脱敏、重新打开终态、等待与恢复、取消时限与无迟到导航、副作用oracle；不冒充SDK生产ServiceWorker接线。生产扩展传输/sender与侧边栏仍属T-012，Q-005与实际模型15次端到端验收保留。见[sdk-v01.md](sdk-v01.md)、[t011-report.md](t011-report.md)。

## 2026-10-18 T-012完成

T-011六组浏览器及工程证据已复核通过，任务开始时源码哈希一致。T-012用生产WXT ServiceWorker持有SDK、IndexedDB、会话密钥与debugger，侧边栏仅发严格RPC，不伪造UI身份。主机权限与精确origin授权分离，密钥只在受信任storage.session，撤销/停止优先且不被去重账本容量阻断。

补测发现并修复产品缺陷：Chrome侧边栏消息的`MessageSender`不提供`documentId`（也无`tab`），原`authorize`要求`documentId`并用`getContexts({documentIds})`绑定，导致原生侧边栏所有RPC被`PERMISSION_DENIED`拒绝、面板不可用；现改为要求`sender.url`等于sidepanel URL且`sender.tab`缺失并确认存在`SIDE_PANEL`上下文（有`documentId`时仍按文档绑定），普通扩展tab与页面仍被拒绝。同时修正探针三处问题（中间点击补`expected`后置条件、receipt重放改结构化比较、用卸载面板文档模拟关闭）。

修复后`panel:smoke`七组检查14/20/17/24/10/11/26全部passed；五项人工权限/布局/确认/接管/隐私检查由实际检查者使用未改动产物完成并记录（reviewer=local-user）。`t012-checks.json` status=passed且各轮sourceHashesMatch=true、manualPanel=passed，据此勾选T-012。原生探针使用生产打包代码和真实Worker/侧边栏，本地fixture临时manifest仅增loopback测试权限，不能替代未改动产物的人工权限检查。Q-005未闭合，不声称自动可靠输入归因；真实模型15次端到端仍属T-014。详见[panel-v01.md](panel-v01.md)、[t012-report.md](t012-report.md)、[panel-manual.md](panel-manual.md)。
# 2026-10-20：T-016 验收遗留闭合

采用独立冻结复核，不修改旧发布验证器、原始T-013/T-014报告或实测门槛。closure-baseline.json固定16份原报告摘要及release-v01.md状态行迁移；validate-closure.mjs重算原结果判定、代码/构建指纹和故障矩阵，绑定当前文档检查。仅接受冻结且可以精确还原原摘要的一次状态变化；其他变化失败。新结论写入t016-closure.json，保留旧严格incomplete；没有重新调用模型、运行Chrome或记录人工通过。后续发布快照须包含验证器、基线与输出。详见[t016-report.md](t016-report.md)。

# 2026-10-20：T-017 本地发布候选

补验完成：联网隔离安装成功，检查/测试/构建/两示例与两次构建重现全部通过。首次重现失败源于WXT在background.js写入绝对构建根路径，已在打包器中规范化为`<WISP_BUILD_ROOT>`（未改冻结的wxt.config.ts或T-016基线）。历史ENOTCACHED/EACCES失败保留在t017-runs。

选择0.1.0-rc.1外部候选标识，保留内部已验收包版本和产物。当前无Git元数据，以文件摘要快照固定源码；源码/扩展ZIP固定条目排序与时间。隔离解压、离线npm ci、工程检查与两次构建逐文件比较作为候选门槛，不复制现有依赖、不重新调用模型、不发布。输出保存在.cache/candidates，状态见t017-checks.json；旧验收报告不改写。规格和限制见[t017-report.md](t017-report.md)。


# Research：浏览器端侧 Agent 框架现状调研

**日期**：2024-11-03  
**范围**：调研 Wisp v0.1 已实现功能、架构、验收状态及待完成任务  
**目的**：为下一步规划提供清晰的现状基线

---

## 一、项目概览

### 1.1 定位与成熟度

- **名称**：Wisp  
- **版本**：0.1（已完成 T-001 至 T-017，发布候选已通过本地验收）  
- **定位**：面向 Web 应用的浏览器端 Agent 框架，以 Chrome MV3 扩展为首个宿主  
- **成熟度**：
  - 已完成 290 项确定性测试
  - 故障矩阵 137/137 通过
  - 可靠性验收 15/15 通过（真实模型 `deepseek-flash`，search/table/form 各 5/5）
  - 性能 p95 约 31.5ms（观察 200 候选元素，30 次采样）
  - 四项人工检查通过
  - 发布候选 T-017 通过（隔离安装、构建重现等 10 项检查）
  - **未公开发布**（无 npm 包、Chrome 商店版本）

### 1.2 核心能力

| 能力 | 已实现范围 |
| --- | --- |
| **观察页面** | URL、标题、可见交互元素（role/name/state/bounds）、有界文本、普通字段脱敏值；支持 open Shadow DOM |
| **控制动作** | click、fill、pressKey、scroll、navigate、selectOption；执行前检查引用、可见/启用、遮挡 |
| **策略确认** | origin 授权、动作分类（allow/confirm/handoff/deny）、一次性确认绑定、未知默认确认、敏感接管 |
| **运行时** | 状态机、IndexedDB/内存 store、检查点、租约、去重、单步循环、预算（30 步/5 分钟/40 次模型调用） |
| **模型适配** | Chat Completions 兼容 HTTP 适配、脚本模型、有限 JSON Schema 校验、决定/提取 |
| **SDK** | `createAgent`、任务句柄、事件回补、暂停/恢复/取消/确认 |
| **界面** | 原生侧边栏（Chrome MV3）、RPC 控制器、授权/确认/接管/历史删除 |

### 1.3 支持边界与非目标

**支持**：
- 单标签页、普通 HTTP(S)、已授权 origin 内导航
- 原生 input/textarea、原生单选 select、React 18.3.1 受控输入
- 结构化提取（有界 JSON Schema 子集）
- 完成判定（URL/文本/元素/字段等有界证据）

**不支持**（v0.1 明确非目标）：
- 多标签页任务、跨域 iframe、视觉定位、文件上传/下载
- 支付、密码/验证码自动输入、授权授予
- 后台定时任务、closed Shadow DOM
- 浏览器内部页面、隐身模式

---

## 二、架构与数据流

### 2.1 分层架构

```
protocol            （纯数据契约 + 严格运行时校验，无业务依赖）
  ↑
browser-chrome   models   policy
  ↑                ↑        ↑
  └────────── runtime ──────┘
                 ↑
                sdk
                 ↑
           apps/extension
```

**依赖方向**：自下而上，控制层、模型、策略均独立于 UI。

### 2.2 关键模块职责

| 包 | 职责 | 核心文件 | 代码量 |
| --- | --- | --- | --- |
| `protocol` | 类型、错误码、目标/动作/条件、Observation、ActionResult、事件信封、消息信封；拒绝未知字段与超大载荷 | `actions.mts`(114L)、`observation.mts`(149L)、`runtime.mts`(285L)、`messages.mts`(335L)、`validation.mts`(130L) | 1091 行 |
| `browser-chrome` | CDP 传输、isolated world 观察、私有引用注册表、脱敏、actionability、`BrowserAdapter`（observe/execute/verify/readPolicyContext） | `document.mts`(317L)、`adapter.mts`(276L)、`control-document.mts`(261L)、`chrome.mts`(195L)、`references.mts`(85L)、`sanitize.mts`(35L) | 1174 行 |
| `models` | 脚本模型、Chat Completions 兼容适配、有限 JSON Schema 校验器 | `index.mts`(178L)、`schema.mts`(76L) | 254 行 |
| `policy` | origin 授权、动作分类、一次性确认绑定、执行网关 | `index.mts`(307L) | 307 行 |
| `runtime` | 任务状态机、IndexedDB/内存 store、检查点、租约、去重、单步循环与预算 | `runtime.mts`(705L)、`loop.mts`(364L)、`store.mts`(145L) | 1217 行 |
| `sdk` | `createAgent`、任务句柄、事件回补、暂停/恢复/取消/确认 | `index.mts`(258L) | 258 行 |
| `apps/extension` | MV3 Background（受信任宿主）、RPC 控制器、原生侧边栏 UI | `controller.mts`(258L)、`background.ts`(99L)、`App.tsx`(153L)、`protocol.mts`(69L) | 604 行 |

**总计**：约 4,900 行核心源码（`.mts`/`.ts`/`.tsx`），外加测试与探针。

### 2.3 单步数据流

```
侧边栏 UI
  └─ rpc(type,payload)                     host/client.ts
       └─ chrome.runtime.sendMessage        host/protocol.mts 校验信封
            └─ background request()         host/controller.mts
                 ├─ authorize(sender)       只信任原生 SIDE_PANEL 上下文
                 ├─ 去重账本（requestId）
                 └─ agent / runtime
                      └─ loop.drive → round()
                           1. 检查预算、代次、租约
                           2. observe()            → browser-chrome
                           3. 组装 DecisionInput（目标、观察、历史、允许动作、schema、宿主完成条件、预算）
                           4. model.decide()
                           5. action → 严格校验目标作用域
                                      → runtime.execute → policy 网关 → CDP 动作
                              finish → verify(条件) → 有证据才 complete
                              extract → model.extract → schema/来源/观察复核 → complete
                              ask_user → waitForUser
                           6. 写 journal / 事件 / 预算
```

### 2.4 关键不变量（10 条硬约束）

1. **页面是不可信数据**：模型输出只能映射到契约动作，不执行任意 JS/CSS/XPath
2. **严格 schema**：未知字段、未知动作、超大载荷一律拒绝
3. **引用绑定节点身份**：引用带 document/frame/observation 作用域；节点替换、导航、过期后拒绝
4. **一步一动作**：每次决策最多一个动作，执行后重新观察
5. **写入/未知动作默认确认**：一次性令牌绑定 origin、文档、目标指纹、参数与有效期
6. **完成必须有证据**：宿主 `completionConditions` 与模型条件取并集，有界证据通过才算完成
7. **unknown 屏障**：派发结果未知时保留 `unknown`，阻止后续写入；需核对后显式解除
8. **单写者**：每个 tab 一个租约；同 actionId 同 payload 复用结果，异 payload 拒绝
9. **预算有界**：默认 30 步、5 分钟、40 次模型调用、连续 3 次无进展暂停
10. **密钥只在本会话**：仅扩展受信任上下文的 `storage.session`；不进入 local/sync/任务 IndexedDB/日志

---

## 三、已完成任务与验收状态

### 3.1 任务清单（T-001 至 T-017）

| 任务 | 范围 | 状态 | 关键产出 |
| --- | --- | --- | --- |
| T-001 | 技术探针：Chrome 156 扩展构建加载、debugger 连接、DOM 身份引用、CDP 输入、React 受控输入框、导航和 Worker 终止 | ✅ 完成 | 12 项检查通过，边界记录，SHA-256 固定 |
| T-002 | workspace、扩展与包边界、TypeScript 类型检查及 WXT 最小构建 | ✅ 完成 | package-lock.json、类型检查、生产构建通过 |
| T-003 | 协议 schema、错误码、消息信封、结果及事件类型 | ✅ 完成 | 36 项测试通过，拒绝未知字段/动作和超大载荷 |
| T-004 | 可重置本地验收站点与隔离控制服务 | ✅ 完成 | 16 项 HTTP 集成测试 + 14 项 Chrome 页面 smoke 通过 |
| T-005 | 只读观察、预算、敏感过滤、open Shadow DOM 和引用生命周期 | ✅ 完成 | 65 项测试 + 14 项真实 Chrome 观察器验收（p95≈19.2ms） |
| T-006 | 输入动作、actionability 检查、动作状态及条件等待 | ✅ 完成 | 84 项测试 + 观察回归 14 项/控制验收 20 项 |
| T-007 | origin 授权、动作分类、未知确认、敏感接管与一次性批准绑定 | ✅ 完成 | 113 项测试 + 观察回归 14/控制回归 20/策略验收 17 项 |
| T-008 | 状态机、IndexedDB 事务/journal、检查点、tab 租约、持久化去重和 unknown 恢复 | ✅ 完成 | 147 项测试 + 四轮真实 Chrome/MV3 验收（14/20/17/24 项） |
| T-009 | 脚本模型与可配置 HTTP 适配、决定/提取、超时、取消、用量、输出校验与有限纠正 | ✅ 完成 | 175 项测试 + 真实 DeepSeek 端点补测通过 |
| T-010 | 单步循环、上下文摘要、持久化预算、无进展判断、完成验证与结构化提取 | ✅ 完成 | 202 项测试 + 五组真实 Chrome 验收（14/20/17/24/10 项） |
| T-011 | SDK、任务句柄、事件回补、取消/恢复与最小可执行示例 | ✅ 完成 | 226 项测试 + 六组真实 Chrome 验收（14/20/17/24/10/11 项）+ sdkExample |
| T-012 | 原生侧边栏、会话模型配置、origin 授权、真实 sender 绑定、确认/接管/停止/历史删除 | ✅ 完成 | 254 项测试 + 七组浏览器检查（14/20/17/24/10/11/26 项）+ 五项人工检查 |
| T-013 | 断言矩阵 137/137、修复恢复后 unknown 被旧宿主迟到响应解除的缺陷 | ✅ 完成 | 267 项测试 + 故障矩阵 137/137 通过 |
| T-014 | 290 项测试、故障矩阵 137/137、可靠性 15/15、性能、实际模型 15 轮 | ✅ 完成 | deepseek-flash 实际 15 轮 search/table/form 各 5/5、零未授权副作用、四项人工检查 |
| T-015 | 安装/SDK 示例、权限与数据流、存储/支持范围、41 条 US/FR/NFR/AC 追踪 | ✅ 文档完成 | 独立校验示例/链接/构建/证据不变（T-014 状态行文档哈希差异已精确核实） |
| T-016 | 冻结规格及 16 份原证据；独立状态行差异审查、反例检查与新复核记录 | ✅ 完成 | 不改写 T-014 严格状态 |
| T-017 | 发布候选工具、源码/扩展 ZIP、manifest 与 SHA256SUMS 生成；联网隔离安装、检查/测试/构建/两示例与两次构建重现 | ✅ 完成 | 十项检查全部通过（修复构建根路径导致的可重现差异） |
| T-018 | 2–3 个真实 Web 应用的小范围试用，记录失败、接管、耗时和用量 | ❌ **待开始** | **下一阶段主要任务** |

### 3.2 验收出口

1. **控制层可用**（T-001–006）：无模型也能稳定操作 fixture，引用失效不会误点  
2. **运行时可用**（T-007–010）：策略、预算和恢复不能被模型输出绕过  
3. **框架可接入**（T-011–012）：开发者能通过公开 API 运行任务，用户可以确认和接管  
4. **v0.1 可验收**（T-013–015）：结果有记录，未通过项明确，不宣称未验证能力  

---

## 四、技术债务与待验证事项

### 4.1 待解决问题（Q-001 至 Q-006）

| 编号 | 问题 | 当前状态 | 影响 |
| --- | --- | --- | --- |
| Q-001 | Chrome 最低版本、debugger 附着与 detach 实际行为 | 声明最低 125，实测 156；**125 回归未做** | 不确定 125 实际兼容性 |
| Q-002 | DOM 节点身份如何跨观察保存，移除重建如何可靠失效 | ✅ 已闭合（私有注册表） | 无 |
| Q-003 | CDP 输入对受控输入、contenteditable 和 open Shadow DOM 是否符合范围 | 仅固定 React 18.3.1 受控输入；**其他框架后续回归** | contenteditable 写入及其他框架/富文本不承诺支持 |
| Q-004 | 首个实际模型端点、CORS 与请求结构兼容性 | 已确认一个 DeepSeek 兼容端点；**CORS 与更多提供方 T-014 复核** | 不同提供方、模型版本、站点与提示变化需要复验 |
| Q-005 | 用户手动干预检测与程序输入如何区分 | **未闭合**：无可靠归因器；无法归因时 unknown 并暂停 | 特别是未知输入信号需由可信宿主通知/显式接管处理，不保证自动准确识别每一次人工干预 |
| Q-006 | 500ms 观察门槛是否在目标机器可达 | ✅ 初步闭合（本机 p95≈19.2ms） | 任意网站可靠性与规模化 p95 由 T-014 复核 |

### 4.2 设计决策记录（D-001 至 D-010）

| 编号 | 决策 | 影响 |
| --- | --- | --- |
| D-001 | 扩展作为首个宿主，控制层与 Runtime 独立 | 网页内嵌宿主后续另立 spec |
| D-002 | 先端侧执行，不强制端侧推理 | 模型端点通过适配器替换 |
| D-003 | 一次一个动作，执行后再观察 | 牺牲部分吞吐换取可验证性 |
| D-004 | DOM 语义摘要优先，CDP 输入；视觉定位后置 | Canvas 与复杂视觉控件明确不支持 |
| D-005 | 旧引用拒绝，不自动匹配相似节点 | 降低错误目标执行风险 |
| D-006 | unknown 结果先核对，禁止自动重发 | 网页副作用不提供统一幂等保证 |
| D-007 | 写入和未知语义默认确认，高风险转人工 | 启发式识别存在局限，不宣称完美分类 |
| D-008 | 以任务检查点与动作日志恢复 | 不依赖 Worker 常驻，不跨重启复用 DOM 引用 |
| D-009 | 第一版密钥仅会话内持有 | 浏览器重启后需重新配置 |
| D-010 | 不直接复制参考项目作为基础代码 | 先明确自身契约 |

---

## 五、可复用组件与公开接口

### 5.1 协议层（`@wisp/protocol`）

**公开类型**：
- `Target`、`Condition`、`BrowserAction`、`ActionRequest`
- `Observation`、`Capabilities`、`Evidence`、`ActionResult`、`Verification`
- `Decision`、`ModelResponse`、`Usage`、`Budget`、`Extraction`、`RunResult`、`RunSnapshot`、`ConfirmationRequest`
- `BrowserAdapter`、`ModelProvider` 接口
- `RequestMessage`、`ResponseMessage`、`RuntimeEvent`

**解析入口**：
- `decodeRequest(json, source)`、`parseResponse(response, request)`
- parse 函数处理已解码数据；decode 函数先检查 UTF-8 字节大小，再解析 JSON 并校验结构
- 违规输入抛出 `ProtocolError`，错误码为 `MODEL_INVALID_OUTPUT`

**六种动作**：
1. `click`：点击目标元素
2. `fill`：填充 input/textarea（值最多 8000 字符）
3. `selectOption`：原生单选 select 选择（value 最多 256 字符）
4. `pressKey`：发送键盘事件（Enter、Tab、Escape、Backspace、Delete、方向键、Home、End、PageUp/Down、Ctrl+A、Meta+A）
5. `scroll`：上下滚动（1–2000 像素）
6. `navigate`：导航到指定 URL

**五类条件**：
- `url`：equals 或 startsWith
- `element`：role/name/state（visible 或 absent）
- `text`：includes
- `value`：目标引用的 equals

### 5.2 浏览器控制层（`@wisp/browser-chrome`）

**公开接口**：
- `createChromeAdapter(options)`：创建 `BrowserAdapter` 实例
- 引用管理：`references.mts`（私有注册表、作用域绑定）
- 脱敏：`sanitize.mts`（密码、验证码、支付字段）
- 观察：`document.mts`（DOM 语义摘要、交互元素标注、有界文本）
- CDP 传输：`chrome.mts`（debugger API、isolated world 求值、异步桥接）

**核心能力**：
- `observe()`：返回 `Observation`（URL、标题、视口、元素列表、capabilities）
- `execute(request)`：执行动作请求，返回 `ActionResult`（dispatched/responded/verified/evidence）
- `verify(condition)`：验证后置条件，返回 `Verification`（satisfied/evidence/reason）
- `readPolicyContext()`：读取策略上下文（origin、formaction、输入类型）

**actionability 检查**：
- 可见（offsetWidth/Height > 0、无 `display:none`）
- 启用（不是 `disabled`/`aria-disabled`/`inert`）
- 视口中心未遮挡
- 两次 50ms 几何稳定
- 输入前获得焦点

### 5.3 模型适配层（`@wisp/models`）

**公开接口**：
- `createScriptedModel(script)`：脚本模型（队列式固定输出，无网络）
- `createChatModel(options)`：Chat Completions 兼容 HTTP 适配
  - 端点、模型名、API 密钥、温度、超时
  - JSON Schema 子集校验（`compileSchema`）
  - 最多一次格式纠正（`corrections: 0|1`）
  - 用量记录（`onAttempt` 回调）

**已验证端点**：
- DeepSeek 的 OpenAI 兼容 Chat Completions 端点（`deepseek-flash`）
- JSON object 模式，decide 与 extract 两项均通过

### 5.4 策略网关（`@wisp/policy`）

**公开接口**：
- `createPolicyGateway(options)`：创建策略网关实例
- `classifyPolicy(request, context, allowed, rules)`：动作分类

**四类策略**：
1. `allow`：只读、导航到已授权 origin
2. `confirm`：提交、发送、删除等已识别写入动作
3. `handoff`：密码、验证码、支付、授予权限
4. `deny`：未授权导航、越界操作

**一次性批准**：
- 绑定 run/tab/action/授权版本/文档/目标指纹/字段摘要/完整参数
- 30 秒有效期
- 执行前重读页面并重新分类
- 批准消费后失败也不恢复

### 5.5 运行时（`@wisp/runtime`）

**公开接口**：
- `createMemoryStore()`：内存 store（测试用）
- `createIndexedDBStore()`：IndexedDB store（生产用）
- `createRuntime(options)`：创建运行时实例
- `configureLoop(options)`：配置单步循环

**状态机**：
```
created → running → completed / failed / cancelled
             ↕
        waiting_user
             ↓
           paused → running
```

**持久化**：
- 检查点：目标、tab、授权版本、状态、预算、摘要、最后动作与待确认内容
- journal：有界元数据（不写填写值、完整观察、模型原文）
- 租约：每个 tab 一个写入执行者
- 去重：同 actionId 同 payload 复用结果，异 payload 拒绝

### 5.6 SDK（`@wisp/sdk`）

**公开接口**：
```ts
createAgent(options: AgentOptions): Agent
run(input: RunInput): RunHandle
getRun(runId: string, options?): RunHandle
```

**RunHandle**：
- `result: Promise<RunResult>`：终态才解析
- `pause()`、`resume()`、`cancel()`
- `confirm(decision)`、`pending()`
- `snapshot()`、`events(afterSeq?)`
- `onEvent(callback, options)`：自动回补、按 seq 交付、稳定 eventId

**完成条件**：
- 宿主 `completionConditions` 与模型条件取并集
- URL/文本/元素/字段等有界证据
- 条件持久化，resume 省略时沿用，不能降低

---

## 六、测试与验证方式

### 6.1 测试分层

| 层级 | 范围 | 命令 | 当前状态 |
| --- | --- | --- | --- |
| 单元/确定性测试 | 协议、引用、脱敏、策略分类、store 事务 | `npm test`（需先构建） | 290 项通过 |
| 分层 Chrome 探针 | observer/control/policy/runtime/loop/sdk/panel | `npm run observer:smoke` 等 | 七组验收通过（14/20/17/24/10/11/26 项） |
| 故障矩阵 | 137 项断言矩阵（七组浏览器 + 10 项组合故障） | `npm run faults:smoke` | 137/137 通过 |
| 发布级 | 可靠性 15/15、性能、实际模型 15 轮、人工检查 | `npm run release:live` 等 | 全部通过 |

### 6.2 构建与验证命令

```powershell
# 准备（生成协议、类型检查）
npm ci --cache .cache/npm
npm run prepare

# 静态检查与类型检查
npm run check:static
npm run typecheck

# 完整检查（静态 + 类型检查）
npm run check

# 测试（需先构建）
npm run build
npm test

# 浏览器探针（需先构建对应模块）
npm run observer:smoke
npm run control:smoke
npm run policy:smoke
npm run runtime:smoke
npm run loop:smoke
npm run sdk:smoke
npm run panel:smoke

# 故障矩阵
npm run faults:smoke

# 发布级验收
npm run release:reliability  # 可靠性 15/15
npm run release:performance  # 性能采样
npm run release:live         # 实际模型 15 轮

# 构建扩展
npm run build
# 加载扩展：chrome://extensions 开启开发者模式，加载 apps/extension/.output/chrome-mv3

# SDK 示例（无浏览器，确定性只读宿主）
node docs/examples/sdk-task.mjs

# 本地 fixture
npm run fixtures:start  # 然后打开输出的 session 地址
```

### 6.3 本地 fixture

**位置**：`fixtures/web/`

**特点**：
- 三端口分离（页面、控制服务、oracle）
- 独立会话与 generation（重置前的异步请求不污染新状态）
- 业务事实由控制服务提供，不向模型暴露 oracle 凭据

**场景**：
- search：搜索记录并进入详情
- table：筛选表格前五条并提取编号
- form：填写表单，提交前确认

**oracle 校验**：
- 提交必须真实记录一次有效业务效果
- 零未授权副作用

---

## 七、文档与规格入口

### 7.1 使用文档

| 文档 | 路径 | 内容 |
| --- | --- | --- |
| 安装与首次运行 | `docs/getting-started.md` | 构建、加载扩展、配置、授权、本地试用及排查 |
| 架构概览 | `docs/architecture.md` | 分层、单步数据流、关键不变量与建议阅读顺序 |
| SDK 接入与示例 | `docs/sdk.md` | 受信任宿主、句柄/恢复、完成条件、事件与控制层 |
| 权限与数据流 | `docs/security.md` | 权限、出站信息、密钥、任务存储及删除 |
| 支持范围 | `docs/support.md` | 实测版本、六种动作、控件/页面边界及 Q-005 |
| 验证与证据 | `docs/verification.md` | 检查命令、实际模型范围、性能数据和报告状态 |
| 参与开发 | `CONTRIBUTING.md` | 环境、常用命令、代码约定、安全红线与任务认领 |

### 7.2 规格文档

| 文档 | 路径 | 内容 |
| --- | --- | --- |
| 需求规格 | `specs/001-browser-agent/spec.md` | 用户场景、范围、需求和成功标准 |
| 实施计划 | `specs/001-browser-agent/plan.md` | 模块边界、执行流程和存储设计 |
| 契约 | `specs/001-browser-agent/contracts.md` | SDK、动作、结果及事件契约 |
| 验收场景 | `specs/001-browser-agent/acceptance.md` | 可重复的验收场景和证据要求 |
| 任务清单 | `specs/001-browser-agent/tasks.md` | 依赖明确的实施清单（T-001 至 T-018） |
| 设计决策 | `specs/001-browser-agent/decisions.md` | 设计决策、假设和待验证问题 |
| 需求追踪 | `specs/001-browser-agent/traceability.md` | 全部 41 条 US/FR/NFR/AC 的实现、证据与说明 |

### 7.3 各模块规格

- 协议细化：`specs/001-browser-agent/protocol-v01.md`
- 观察规格：`specs/001-browser-agent/observer-v01.md`
- 控制规格：`specs/001-browser-agent/control-v01.md`
- 策略规格：`specs/001-browser-agent/policy-v01.md`
- 运行时规格：`specs/001-browser-agent/runtime-v01.md`
- 模型规格：`specs/001-browser-agent/models-v01.md`
- 循环规格：`specs/001-browser-agent/loop-v01.md`
- SDK 规格：`specs/001-browser-agent/sdk-v01.md`
- 侧边栏规格：`specs/001-browser-agent/panel-v01.md`
- 故障规格：`specs/001-browser-agent/faults-v01.md`
- 站点规格：`specs/001-browser-agent/fixtures-v01.md`
- 发布验收规格：`specs/001-browser-agent/release-v01.md`
- 文档规格：`specs/001-browser-agent/documentation-v01.md`
- 候选规格：`specs/001-browser-agent/candidate-v01.md`

---

## 八、待确认事项

1. **T-018 的具体范围**：
   - 目标站点是哪 2–3 个？（内部业务系统、公开 SaaS、电商？）
   - 试用深度：单场景还是多场景组合？
   - 记录粒度：失败原因、接管次数、耗时、用量、副作用检查？
   - 是否需要新的 fixture 或真实账号？

2. **当前环境状态**：
   - Node.js 版本不一致（要求 22.18+，当前 24.21.0）
   - `node_modules` 未安装（`npm test` 失败，但这是已知状态）
   - Git 工作区干净（仅新增 `CLAUDE.md`）

3. **下一步优先级**：
   - 是否先修复 Q-005（用户/程序输入归因）？
   - 是否先扩展控件支持（Q-003：其他框架、contenteditable）？
   - 是否先做 Q-001（Chrome 125 回归）？
   - 还是直接进入 T-018 真实站点试用？

---

## 九、关键发现总结

### 9.1 成熟度高

- **完整的分层架构**：protocol → browser-chrome/models/policy → runtime → sdk → extension，依赖清晰
- **严格的契约与校验**：10 条硬约束、严格 schema、拒绝未知字段
- **完善的验收体系**：290 项测试、137 项故障矩阵、15 项可靠性、性能采样、人工检查
- **真实模型验证**：deepseek-flash 15 轮 search/table/form 各 5/5，零未授权副作用

### 9.2 边界清晰

- **明确的非目标**：多标签页、跨域 iframe、视觉定位、文件上传、支付、密码/验证码、后台定时任务
- **已知的局限**：Q-001（Chrome 125 回归未做）、Q-003（仅 React 18.3.1 受控输入）、Q-005（用户/程序输入归因未闭合）
- **保守的设计**：unknown 屏障、默认确认、敏感接管、一次性批准、不自动重发

### 9.3 下一阶段明确

- **T-018 是唯一待开始任务**：2–3 个真实 Web 应用小范围试用
- **技术债务有限**：Q-001/Q-003/Q-005 是已知边界，不阻塞 T-018
- **可复用性强**：控制层、策略、运行时与 SDK 可独立复用，Chrome 扩展只是首个宿主

---

**下一步**：根据本调研产出 **Proposal 阶段**方案，给出 2–3 条路线对比，供用户选择 T-018 的具体方向。

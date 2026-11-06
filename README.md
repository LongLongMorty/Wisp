# Wisp

面向 Web 应用的浏览器端 Agent 框架，以 Chrome MV3 扩展为首个宿主。v0.1 已实现单标签页观察、控制、策略确认、可恢复运行时、模型适配、SDK 和原生侧边栏，并完成限定 fixture 上的实际模型验收。

当前以源码工作区交付，未发布 npm 包或 Chrome 商店版本。远程模型会接收过滤后的页面信息。

## 30 秒了解

- **是什么**：浏览器 Agent 框架的 v0.1 原型。控制层、策略、运行时与 SDK 可独立复用，Chrome 扩展只是首个宿主。
- **已能做什么**：在本地 fixture 上用真实 Chrome + 真实模型完成搜索详情、表格筛选与结构化提取、表单填写到提交确认；在 Project Gutenberg 真实页面完成过一次只读信息提取。支持单步执行、写前确认、暂停/恢复、unknown 先核对后处理。
- **不能做什么**：不是任意网站可用的产品。不支持多标签、跨域 iframe、视觉定位、文件上传、支付/密码/验证码；未做安全审计，不保证副作用完全可控。
- **快速验证**：`npm ci --cache .cache/npm` → `npm run build` → `npm run check` → `npm test`；无浏览器示例 `node docs/examples/sdk-task.mjs`。

## 使用入口

- [安装与首次运行](docs/getting-started.md)：构建、加载扩展、配置、授权、本地试用及排查。
- [架构概览](docs/architecture.md)：分层、单步数据流、关键不变量与建议阅读顺序。
- [SDK 接入与示例](docs/sdk.md)：受信任宿主、句柄/恢复、完成条件、事件与控制层。
- [权限与数据流](docs/security.md)：权限、出站信息、密钥、任务存储及删除。
- [支持范围](docs/support.md)：实测版本、六种动作、控件/页面边界及 Q-005。
- [验证与证据](docs/verification.md)：检查命令、实际模型范围、性能数据和报告状态。
- [需求追踪](specs/001-browser-agent/traceability.md)：全部 41 条 US/FR/NFR/AC 的实现、证据与说明。
- [参与开发](CONTRIBUTING.md)：环境、常用命令、代码约定、安全红线与任务认领。

## 构建与加载

需要 Node.js 22.18+ 和 npm。已实测 Node 22.20.0、Windows x64、Chrome 156；manifest 声明最低 125，但 125 未做同等回归。

```powershell
npm ci --cache .cache/npm
npm run build
npm run check
npm test
```

在 `chrome://extensions` 开启开发者模式，加载 `apps/extension/.output/chrome-mv3`，点击图标打开原生侧边栏。配置完整模型端点与模型名后，选择并授权普通 HTTP(S) 网页。普通 tab 打开 sidepanel.html 不具备任务权限。

单次批准不等于全站自动批准；手动操作前先接管。密码、验证码、支付及越权操作不自动执行。停止不能撤销已经发出的请求；unknown 先核对，不直接重发。

## 示例与检查

完成构建后：

```powershell
node docs/examples/sdk-task.mjs
node scripts/validate-docs.mjs
```

新示例为无网络/Chrome 的确定性只读宿主，演示等待/恢复、完成证据和事件回补，不计入模型成绩。真实页面可运行 `npm run fixtures:start` 后打开输出的 session 地址。

**内置测试站点**（位于 `fixtures/`）：
- `fixtures/web/`: 搜索、筛选、提取的原型站（v0.1 的模型评估基线）
- `fixtures/ticket-system/`: 工单系统，用于验证表单级联、条件渲染、状态流转、权限隐藏与审计日志（零 npm 依赖，仅本地测试用）

这些 fixtures 是**受控测试环境**，不代表在真实生产站点的泛化能力。T-018 任务要求在真实 Web 应用上试用并记录失败模式。

## 当前状态与边界

- 历史 fixture 验收包含 290 项确定性测试、故障矩阵 137/137、可靠性 15/15、性能采样和 `deepseek-flash` 实际 15 轮 search/table/form 各 5/5；这些结果绑定当时的代码和环境。
- 历史发布候选曾通过十项检查，见 [T-017 报告](specs/001-browser-agent/t017-report.md)；后续代码和规格已变更，不能将旧候选验收结果直接用于当前构建。
- **真实站点试用**：[Project Gutenberg](specs/002-ticket-system/t018-gutenberg-trial.md) 一次只读提取完成；[Open Library](specs/002-ticket-system/t018-open-library-trial.md) 曾需人工接管，后续复测仍暂停；[维基百科](specs/002-ticket-system/t018-wikipedia-trial.md) 试用未完成；[GitHub Issues](specs/002-ticket-system/t018-github-issues-trial.md) 的历史试用失败。中文与英文维基百科按同一应用计数。
- 说明：T-014 的严格聚合 JSON 因实测后修改了发布规格状态行而显示 `incomplete`；T-015 记录了该精确差异，T-016 以冻结证据复核通过，均未改写原报告。细节见 [验证与证据](docs/verification.md)。
- 以上成绩绑定本机 fixture 与单一提供方，不代表任意网站成功率；最低 Chrome 125 未做同等回归；Q-005（用户/程序输入归因）仍有边界。

**已知限制**（真实站点暴露的问题）：
- 上下文不完整仍会触发保守接管；页面加载、自定义元素、过大内容或其他限制都可能导致暂停，不能从通用错误推断具体原因。
- 侧边栏现可显示固定集合的策略暂停原因；动作失败、结果未明和预算耗尽仍可能缺少足够的诊断细节。
- 默认五分钟按任务开始后的实际时间计算，暂停和等待人工处理的时间也会计入；恢复不重置预算。

## 参与与许可

欢迎同学一起开发：先读[架构概览](docs/architecture.md)与[参与开发](CONTRIBUTING.md)，再从[任务清单](specs/001-browser-agent/tasks.md)认领（下一阶段为 T-018 真实站点小范围试用）。请勿提交密钥或本地缓存，结论以证据为准。

本项目以 [MIT License](LICENSE) 发布。它适合作为学习/研究型的浏览器 Agent 框架基线；不是生产级产品，也未做第三方安全审计。

规格入口：[需求、设计与任务](specs/001-browser-agent/README.md)。历史失败与重跑记录保留在 evidence。

# Wisp

面向Web应用的浏览器端Agent框架，以Chrome MV3扩展为首个宿主。v0.1已实现单标签页观察、控制、策略确认、可恢复运行时、模型适配、SDK和原生侧边栏，并完成限定fixture上的实际模型验收。

当前以源码工作区交付，未发布npm包或Chrome商店版本。远程模型会接收过滤后的页面信息。当前使用说明以docs为入口，包内README和阶段报告保留开发历史。

## 使用入口

- [安装与首次运行](docs/getting-started.md)：构建、加载扩展、配置、授权、本地试用及排查。
- [SDK接入与示例](docs/sdk.md)：受信任宿主、句柄/恢复、完成条件、事件与控制层。
- [权限与数据流](docs/security.md)：权限、出站信息、密钥、任务存储及删除。
- [支持范围](docs/support.md)：实测版本、六种动作、控件/页面边界及Q-005。
- [验证与证据](docs/verification.md)：检查命令、实际模型范围、性能数据和报告状态。
- [需求追踪](specs/001-browser-agent/traceability.md)：全部41条US/FR/NFR/AC的实现、证据与说明。
- [架构概览](docs/architecture.md)：分层、单步数据流、关键不变量与建议阅读顺序。
- [参与开发](CONTRIBUTING.md)：环境、常用命令、代码约定、安全红线与任务认领。

## 构建与加载

需要Node.js 22.18+和npm。已实测Node 22.20.0、Windows x64、Chrome 156；manifest声明最低125，但125未做同等回归。

```powershell
npm ci --cache .cache/npm
npm run check
npm test
npm run build
```

在 `chrome://extensions` 开启开发者模式，加载 `apps/extension/.output/chrome-mv3`，点击图标打开原生侧边栏。配置完整模型端点与模型名后，选择并授权普通HTTP(S)网页。普通tab打开sidepanel.html不具备任务权限。

单次批准不等于全站自动批准；手动操作前先接管。密码、验证码、支付及越权操作不自动执行。停止不能撤销已经发出的请求；unknown先核对，不直接重发。

## 示例与检查

完成构建后：

```powershell
node docs/examples/sdk-task.mjs
node scripts/validate-docs.mjs
```

新示例为无网络/Chrome的确定性只读宿主，演示等待/恢复、完成证据和事件回补，不计入模型成绩。真实页面可运行 `npm run fixtures:start` 后打开输出的session地址。

## 验收与剩余边界

290项确定性测试、故障137/137、可靠性15/15、性能及四项人工已有通过记录。deepseek-flash实际15轮search/table/form各5/5，零未授权副作用；实际模型使用Node受信任宿主/真实Chrome，原生扩展另有故障与人工检查。这不代表任意网站的成功率。

复核发现T-014严格综合JSON目前仍为incomplete：实测后 `release-v01.md` 只更新了状态行，导致三份报告的文档哈希过期，代码与产物均匹配。T-015独立验证并记录这一精确差异，保留原报告，不重写通过状态。详见[T-015报告](specs/001-browser-agent/t015-report.md)与[证据说明](docs/verification.md)。

T-016通过独立的冻结证据复核处理上述状态行差异，命令为 `node scripts/validate-closure.mjs`，详见[T-016报告](specs/001-browser-agent/t016-report.md)。原T-014聚合状态保留，复核输出单列；未来代码或规范变更需要重新验收。

T-001–T-016实施、文档及验收复核范围已完成；最低浏览器版本、更广网站/模型兼容、物理用户输入归因Q-005仍有限制。没有执行公开发布。

本地发布候选入口：`node scripts/package-candidate.mjs`。产物、隔离安装/构建结论及限制见[T-017报告](specs/001-browser-agent/t017-report.md)，版本说明见[变更说明](docs/changelog.md)。机器报告十项检查 status=passed（含联网隔离安装与两次构建重现），尚未公开发布。

规格入口：[需求、设计与任务](specs/001-browser-agent/README.md)。历史失败与重跑记录保留在evidence。

## 参与与许可

欢迎同学一起开发：先读[架构概览](docs/architecture.md)与[参与开发](CONTRIBUTING.md)，再从[任务清单](specs/001-browser-agent/tasks.md)认领（下一阶段为 T-018 真实站点小范围试用）。请勿提交密钥或本地缓存，结论以证据为准。

本项目以 [MIT License](LICENSE) 发布。它适合作为学习/研究型的浏览器 Agent 框架基线；不是生产级产品，也未做第三方安全审计。

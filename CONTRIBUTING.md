# 参与开发

感谢你关注 Wisp。这是一个**浏览器端 Agent 框架的 v0.1 原型**：架构与验收流程已经成形，但仍在早期，不是生产级或安全审计过的产品。请先读本页和 [架构概览](docs/architecture.md)，再认领任务。

## 项目定位（先对齐预期）

- 宿主是 Chrome MV3 扩展；控制层、策略、运行时、SDK 可独立复用。
- 已在本机 fixture 上完成真实 Chrome + 真实模型（DeepSeek）验收；**没有**在任意真实网站上做过成功率验证。
- 明确非目标：多标签页、跨域 iframe、视觉定位、文件上传、支付/密码/验证码、closed Shadow DOM 等（见 [支持范围](docs/support.md)）。
- 讨论与需求变更先改 `specs/001-browser-agent/` 下的文档，再改代码。

## 环境

- Node.js 22.18+、npm（已实测 Node 22.20.0、Windows x64、Chrome 156）。
- 脚本目前偏 Windows（`where.exe`、`tar.exe`、默认 Chrome 路径）；其他系统需要相应调整。
- 不要提交密钥。模型密钥只放在本地会话环境变量，`.gitignore` 已排除 `.env`、`*.key`、`*.pem`。

## 5 分钟上手

```powershell
cd <repo>
npm ci --cache .cache/npm
npm run check
npm test
npm run build
node docs/examples/sdk-task.mjs     # 无网络/无 Chrome 的确定性示例
```

构建产物在 `apps/extension/.output/chrome-mv3`。本地试用与侧边栏加载见 [安装与首次运行](docs/getting-started.md)。

## 目录速览

| 路径 | 作用 |
| --- | --- |
| `packages/protocol` | 协议类型与严格运行时校验（目标、动作、观察、结果、事件、消息信封） |
| `packages/browser-chrome` | CDP 连接、页面观察、引用注册、输入/actionability、BrowserAdapter |
| `packages/policy` | origin 授权、动作分类、一次性确认、敏感接管 |
| `packages/runtime` | 状态机、IndexedDB 存储/检查点/租约、单步循环、预算 |
| `packages/models` | 脚本模型、Chat Completions 兼容适配、有限 JSON Schema |
| `packages/sdk` | createAgent、任务句柄、事件回补、取消/恢复 |
| `apps/extension` | MV3 Background、受信任宿主控制器、原生侧边栏 |
| `fixtures/web` | 可重置验收站点与独立 oracle 控制服务 |
| `probes`, `scripts` | 浏览器探针、构建/验收/打包脚本 |
| `specs/001-browser-agent` | 需求、设计、契约、验收、任务、决策与证据 |

更多见 [架构概览](docs/architecture.md)。

## 开发流程

1. 在 [任务清单](specs/001-browser-agent/tasks.md) 找到或新增任务，确认依赖和关联验收（`AC-*`）。
2. 需求/契约有变化时，先改 `spec.md` / `plan.md` / `contracts.md`，再同步验收与任务。
3. 实现 + 补测试。涉及浏览器/策略/运行时的改动必须跑对应 Chrome 探针。
4. 用证据说话：结论必须绑定命令、环境、源码/产物哈希；不要手改 JSON 或报告来“通过”。
5. 完成后在任务清单勾选并附代码位置与证据。

## 常用命令

```powershell
npm run check            # 静态检查 + 类型检查
npm test                 # 确定性测试
npm run build            # 构建扩展
node scripts/validate-docs.mjs
npm run fixtures:start   # 本地验收站点
npm run fixtures:smoke   # 站点 + Chrome smoke

# 分层浏览器回归
npm run observer:smoke
npm run control:smoke
npm run policy:smoke
npm run runtime:smoke
npm run loop:smoke
npm run sdk:smoke
npm run panel:smoke
npm run faults:smoke

# 发布级
npm run release:reliability
npm run release:performance
npm run release:live         # 需配置实际模型，可能计费
npm run release:smoke
node scripts/validate-toolchain.mjs t014
node scripts/validate-closure.mjs
node scripts/package-candidate.mjs --online   # 发布候选打包
```

真实模型变量：`WISP_MODEL_ENDPOINT`、`WISP_MODEL_NAME`、可选 `WISP_MODEL_API_KEY`（不支持 `response_format` 的兼容服务可加 `WISP_MODEL_JSON_MODE=off`）。密钥不要写进文件或提交。

## 代码约定

- TypeScript（`.mts`/`.ts`/`.tsx`），ESM；workspace 内部包按依赖方向引用。
- 协议校验是严格白名单：未知字段/动作/超大载荷必须拒绝；不要为了兼容而放宽。
- 页面内容一律视为不可信数据；不允许执行模型生成的代码，不允许任意 JS/CSS/XPath。
- 错误使用统一错误码（`STALE_TARGET`、`NOT_ACTIONABLE`、`POLICY_DENIED`、`OUTCOME_UNKNOWN` 等）。
- 引用绑定确切节点身份，不按名称重绑；一次只执行一个动作。
- 新增依赖要说明必要性；能不加就不加。
- 尽量匹配现有代码风格，改动保持局部。

## 安全与证据红线

- 不提交密钥、令牌、个人数据、完整 DOM 或模型原文到仓库、日志、证据。
- 不静默放宽授权、确认、预算或未知结果处理来让测试通过。
- 替身/脚本模型不能计入实际模型成绩；环境阻塞要如实标记，不要伪装成通过。
- 人工检查只能由实际检查者记录；不要复制他人或历史结果。
- 修改验收门槛、冻结规格或状态行，需要同步说明并重新验证。

## 认领任务

当前下一阶段是 **T-018：2–3 个真实 Web 应用的小范围试用**，需要先确定目标站点与可执行任务，并记录失败、接管、耗时与用量。之后可按模块拆分：

- 观察/控制：`packages/browser-chrome`
- 策略/确认：`packages/policy`
- 运行时/恢复：`packages/runtime`
- 模型适配：`packages/models`
- SDK/事件：`packages/sdk`
- 宿主/侧边栏：`apps/extension`

新手建议从文档、示例、fixture 用例和确定性测试入手，再碰策略与运行时。

## 提交与 PR 检查清单

- [ ] `npm run check`、`npm test`、`npm run build` 通过
- [ ] 相关浏览器探针通过（若改到浏览器/策略/运行时）
- [ ] 没有提交密钥/本地缓存/构建产物（`git status` 自查）
- [ ] 变更了需求/契约时，同步了 `specs` 与验收
- [ ] 结论有证据，未伪造或手改报告
- [ ] 提交信息简洁说明“做了什么、为什么”

## 反馈问题

请附：系统、Node 版本、Chrome 版本、执行的命令、预期与实际、相关证据路径（`specs/001-browser-agent/evidence/`）。安全/隐私问题请勿在公开 issue 中贴密钥或真实页面数据。

## 许可

本项目采用 [MIT License](LICENSE)。提交贡献即表示你同意以该许可发布你的贡献。

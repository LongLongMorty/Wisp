# T-009 脚本模型与 HTTP 模型适配

日期：2026-10-18。状态：已完成；实现、工程检查与真实端点补测均通过。

## 交付

先编写[模型规格](models-v01.md)，实现 [@wisp/models](../../packages/models/README.md)：

- 可耗尽脚本队列、可配置 Chat Completions 兼容端点；不默认提供商或模型。
- 决定的严格协议校验、allowedActions/schemaId/当前目标作用域校验；提取 schema 子集校验与宿主观察来源绑定。
- 会话内密钥、HTTPS/loopback HTTP 限制、禁止凭据 URL 和重定向；错误不含响应正文。
- 总超时覆盖响应头、响应体及纠正；AbortSignal取消；请求64000字符、响应65536字节限额。
- 最多一次格式/schema纠正，不回显错误输出；拒绝、截断、HTTP和网络失败不自动重试。onAttempt在每次请求前提供调用预算扣减入口。
- 只聚合共同已知的token量；失败保留各次尝试已知用量，无用量时保持未知，不估算费用。
- 编译/测试接入工程命令，新增真实模型 smoke 与 T-009验收门槛。

## 验证

新增28项模型测试；全量175项测试通过。static、tests、typecheck、build结果见[工程证据](evidence/t009-checks.json)。本地 HTTP 测试覆盖决定、提取、非法动作/目标/字段、schema、纠正、用量、安全错误、超时、取消、大小限制、重定向与预算钩子。

[实际端点证据](evidence/t009-model-live.json)status=passed：在 DeepSeek Chat Completions 兼容端点上，decide 与 extract 两项检查均通过并记录已知 token 用量。没有使用本地 fixture 冒充模型验收，也没有改写 T-008 的历史证据。本任务未修改 browser/policy/runtime 代码，不重复浏览器补测。

## 真实端点复验

在本机会话内设置 `WISP_MODEL_ENDPOINT`（完整 chat/completions URL）、`WISP_MODEL_NAME`，并按服务要求设置会话 `WISP_MODEL_API_KEY`；密钥不进入仓库或对话。

~~~powershell
npm run models:live
node scripts/validate-toolchain.mjs t009
~~~

本轮使用 DeepSeek 的 OpenAI 兼容 Chat Completions 端点，JSON object 模式，模型 `deepseek-flash`。结果：`decide` 与 `extract` 两项均通过，requestCount=2（无纠正重试）；已知用量 decide 542、extract 683 token。[t009-model-live.json](evidence/t009-model-live.json)仅保存 endpoint 的 SHA-256 与模型名，不含密钥、endpoint 明文、原始内容或推理。可能产生2至4次模型调用（含最多一次格式纠正）。

工程报告[t009-checks.json](evidence/t009-checks.json)status=passed、actualModel.status=passed、sourceHashesMatch=true、lockfilePresent=true，满足勾选条件，可进入T-010。完整说明见[模型README](../../packages/models/README.md)。

## 边界

JSON Schema为明确列出的有限子集，不支持的关键字直接拒绝。来源证明数据取自哪次观察，不证明提取事实正确。模型finish不直接完成任务，策略执行/完成验证/全局预算在T-010接入；实际扩展会话配置和密钥管理界面在T-012。真实兼容性结论目前仅覆盖一个 DeepSeek 兼容端点的一次 decide/extract 调用；扩展上下文中的 CORS、端到端任务成功与费用上限仍未验证。

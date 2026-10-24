# T-009 模型适配规格 v0.1

状态：已完成；实现、本地测试与真实端点（DeepSeek兼容Chat Completions，decide/extract）验收通过。

## 边界

实现 `ModelProvider` 的脚本队列与 Chat Completions 兼容 HTTP 适配。调用方显式提供完整 endpoint、model 和可选会话密钥；不选择默认提供商、不持久化密钥、不记录原始提示或响应、不执行模型动作。只允许 HTTPS 或 loopback HTTP，禁止重定向与 URL 凭据。

`decide` 输出单个协议 Decision，并检查 allowedActions、当前观察的目标引用和注册 schemaId。页面文本作为不可信数据发送，不能成为系统指令。finish 只是建议，T-010 负责真实完成验证。

`extract` 输出 `{data}`，先验证有限 JSON Schema 子集，再绑定输入观察的 URL/documentId/observationId/capturedAt。来源证据表示观察来源，不证明业务事实正确。子集支持 type、properties、required、additionalProperties、items、enum、min/maxLength、minimum/maximum、min/maxItems；不支持的关键字在请求前拒绝，不能忽略。

## 资源与失败

完整请求最多 64000 字符；响应体最多 65536 字节，流式读取时也限额。默认总超时 30 秒，覆盖响应体和纠正，取消映射 ABORTED。默认最多一次格式纠正，可配置 0 或 1 次；仅无效模型 JSON/结构/schema 触发。HTTP、网络、拒绝、截断不自动重试。纠正仅追加固定提示，不回显错误响应。每次调用先以 `onAttempt` 通知调用方，由 T-010 在网络前扣调用预算；回调抛错即阻止请求。

错误的 attempts 保存每次请求的已知 usage（没有响应时保持空元数据）；成功的公共协议返回值聚合所有尝试中共同已知的 token 计数。缺失量保持未知，costUsd 不估算。错误只含固定信息与安全元数据，不包含 endpoint、密钥、响应正文。

脚本模型同样执行输入、输出和提取 schema 校验；队列耗尽失败，不循环。

## 验收

Node 测试覆盖决定/提取、非法字段/动作/目标、schema 子集、有限纠正、usage、HTTP 错误、超时、取消、响应大小、重定向和凭据边界。工程检查必须通过。`models:live` 使用会话环境变量执行真实决定与提取；缺少配置记为待验证，不能把 fixture 当真实端点证据，不能勾选 T-009 完成。

协议参考：[OpenAI Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)。使用非流式 messages/model，模型内容只返回 JSON，usage 来自 HTTP 信封；仍须本地严格校验。

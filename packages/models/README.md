# @wisp/models

提供 `createScriptedModel`、`createChatModel` 和有限 JSON Schema 子集校验器。实现 `@wisp/protocol` 的 ModelProvider；不执行浏览器动作。规格见 [models-v01.md](../../specs/001-browser-agent/models-v01.md)。

```ts
import {createChatModel} from '@wisp/models';
const model = createChatModel({
  endpoint: 'https://your-provider.example/v1/chat/completions', // 完整 URL
  model: 'your-model',
  apiKey: sessionKey, // 受信任宿主的会话内变量
  timeoutMs: 30000,
  corrections: 1,
  onAttempt() { /* 每次网络请求前扣模型调用预算；超额可抛 ModelError */ }
});
const response = await model.decide(input, abortController.signal);
```

默认使用 JSON object 模式；显式 `jsonMode:false` 仅适用于不支持该参数的兼容端点，本地校验始终执行。没有默认模型、隐式回退或 HTTP 错误重试。格式纠正共享总超时，最多增加一次调用。成功返回聚合的已知 token 用量；错误的 `attempts` 包含各次请求的已知用量。未知用量与费用保持未知。密钥不得传给 content script 或写入任务存储；扩展宿主接线留待 T-010/T-012。

脚本队列：`createScriptedModel({decisions:[decision],extractions:[{data: value}]})`。提取数据须满足 schema，来源由输入观察绑定；不接受模型自行声明来源。支持的 schema 子集与限制见规格。

本地测试：`node --test packages/models/test/models.test.mjs`。

真实端点补测（在本机 PowerShell 会话内设置变量，不把密钥写入仓库或对话）：

```powershell
$env:WISP_MODEL_ENDPOINT = 'https://your-provider.example/v1/chat/completions'
$env:WISP_MODEL_NAME = 'your-model'
# 在当前会话以自己的安全方式设置 WISP_MODEL_API_KEY；无鉴权本地服务可省略。
# 不支持 response_format 的端点可设 $env:WISP_MODEL_JSON_MODE = 'off'
npm run models:live
node scripts/validate-toolchain.mjs t009
```

该命令会实际调用决定与提取各一次（每次至多一次格式纠正，可能计费）。仅填写真实模型服务，不能填写测试 fixture。两项 live 检查通过、源码哈希一致、工程报告 `status=passed` 后才能验收 T-009。报告不写密钥、endpoint、原始内容或推理。

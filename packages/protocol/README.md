# @wisp/protocol

Wisp 0.1的共享TypeScript协议，提供公开类型及严格运行时校验，无第三方运行时依赖。

## 使用

先在仓库根目录运行node scripts/protocol-build.mjs，生成JS与声明。workspace安装后的消费者可按包名导入：

~~~ts
import { decodeRequest, parseResponse } from '@wisp/protocol';

const request = decodeRequest(JSON.stringify({
  version: '0.1', requestId: 'q-1', type: 'run.get',
  runId: 'r-1', payload: {},
}), 'ui');
// source必须由受信任传输层校验实际sender后提供，不接受消息自报。
// parseResponse(response, request)同时校验响应ID、类型及对应数据结构。
~~~

parse函数处理已解码数据；decode函数先检查UTF-8字节大小，再解析JSON并校验结构。违规输入抛出ProtocolError，错误码为MODEL_INVALID_OUTPUT。函数返回新的普通对象，不复用传入的可变嵌套对象。

| 模块 | 公开契约 |
| --- | --- |
| actions | Target、Condition、BrowserAction、ActionRequest |
| observation | Observation、Capabilities、Evidence、ActionResult、Verification |
| runtime | Decision、ModelResponse、Usage、Budget、Extraction、RunResult、RunSnapshot、ConfirmationRequest、BrowserAdapter/ModelProvider接口 |
| messages | RequestMessage、ResponseMessage、RuntimeEvent及parse/decode入口 |

schema不验证实际浏览器sender、站点授权、证据真实性或任务状态转换，也不执行动作、不自动重试、不自动扫描所有自由文本中的敏感数据。解析成功不能替代执行网关与策略检查。

## 验证

在根目录运行node scripts/validate-toolchain.mjs t003b，或npm test执行协议行为测试。完整约束见[协议细化](../../specs/001-browser-agent/protocol-v01.md)与[验收报告](../../specs/001-browser-agent/t003b-report.md)。

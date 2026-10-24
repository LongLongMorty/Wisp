# T-003b 协议细化

状态：实现规格；协议版本0.1。所有解析器接收unknown并返回新对象；额外字段、未知联合分支、非有限数字、非法UTC时间与不支持版本均拒绝。该任务实现数据契约，不实现执行器、发送方鉴权、去重存储、事件订阅或任务状态机。

## 观察与结果

- Observation：observationId/documentId/frameId/url/title/capturedAt/viewport/elements/text/truncated/truncationReasons。viewport包含width/height/dpr/scrollX/scrollY；元素包含ref/tag/role/name/enabled/editable/sensitive/bounds，无value字段。refs不得重复。最多200个元素；整个观察JSON最多24,000字符且不超过65,536 UTF-8字节，超限由生产者显式裁剪并说明原因。
- bounds：x/y允许有限负坐标，width/height非负。truncated必须与非空原因列表一致，原因仅element_limit/text_limit/byte_limit/unsupported_content。
- Evidence：kind为url/element/text/value，携带url/documentId/observationId/capturedAt及actual摘要。只有数据形状得到保证，actual脱敏仍由观察器/策略层负责。
- ActionResult沿用contracts.md。verified=passed必须有证据；dispatched=no不能同时responded=yes或verified=passed。unknown不自动变为成功，也不授权重试。
- Verification包含status与1–16个逐条件结果；每项含condition/status/evidence，passed项必须有证据；聚合状态按AND计算：有failed则failed，否则有unknown则unknown，否则passed。
- Capabilities包含version、actions（五类动作的非空唯一子集）、frames=main、shadowDOM=open。

## 模型与运行时

Decision沿用contracts.md，action不接受actionId，finish必须有非空expected。ModelResponse包含decision及可选usage/providerRequestId。Usage只包含非负token计数与可选costUsd，不填即未知；totalTokens不得小于已知输入输出之和。

Budget包含steps/modelCalls/elapsedMs/contextChars/observationChars/consecutiveNoProgress六个{used,limit}计数器，used允许大于limit以报告超额；limit必须正整数。RunSnapshot包含runId/tabId/goal/status/updatedAt；终态必须带同status的result，非终态禁止result。

RunResult为completed/failed/cancelled联合：completed含summary，并至少提供非空evidence或带来源的extraction；failed含标准error；cancelled含reason。Extraction含schemaId/data/source；data为深度≤8、节点≤2048、单字符串≤8000、序列化≤24000字符的JSON值，source为非空Evidence列表。JSON对象禁止__proto__/constructor/prototype键，不接受函数、undefined、访问器或非普通对象。schema注册与实际业务数据校验留给T-009/T-010，不信任模型自行声称已验证。

Confirmation包含confirmationId/actionId/origin/documentId/targetFingerprint/contextDigest/summary/displayParameters/expiresAt。origin必须是规范HTTP(S)origin，contextDigest为64位十六进制；展示参数最多32条字符串，禁止夹带执行代码。批准有效期、实际摘要匹配与一次性消费由T-007实现。

## 消息

信封{version,requestId,type,runId?,payload}，type与payload严格对应；JSON解码入口在解析前拒绝超过65,536字节的消息。发送方角色作为解析器的必填参数，由受信任传输层根据实际sender提供，禁止从消息字段读取。schema权限过滤只是第一道结构约束，不替代浏览器sender鉴权。

| 角色 | type | runId | payload |
| --- | --- | --- | --- |
| ui | run.start | 禁止 | tabId、goal，可选schemaIds、limits |
| ui | run.get/pause/resume/cancel | 必须 | 空对象 |
| ui | run.confirm | 必须 | confirmationId、decision=approve/reject，禁止修改动作 |
| ui | events.subscribe | 必须 | afterSeq≥0 |
| page | page.observation | 必须 | observation |
| page | page.input | 必须 | documentId、frameId、kind=pointer/keyboard/navigation、timestamp |

RunLimits可选maxSteps/maxDurationMs/maxModelCalls/maxContextChars/maxObservationChars/maxConsecutiveNoProgress，均为有界正整数。页面不能提交批准、创建任务或修改模型和权限；UI也不能伪造page消息。

响应{version,requestId,type,ok,data|error}，成功与失败字段互斥。parseResponse对已解码对象也执行字节上限检查，防止structured clone路径绕过JSON解码器。parseResponse必须接收原请求并校验关联：start返回runId；get返回同runId的snapshot；其他命令返回accepted=true；订阅返回events与nextSeq，事件属于请求runId且seq严格递增、大于afterSeq，nextSeq等于最后已返回序号（无事件时等于afterSeq）。允许序号间隙，回补完整性与保留策略由运行时负责。

## 事件

信封{version,eventId,runId,seq,timestamp,type,payload}，seq为正整数。事件本身不声明递增性；顺序由订阅响应和T-008持久化器保证。

| type | payload |
| --- | --- |
| run.state | status，可选reason/result；终态必须携带同status的result，非终态不允许result |
| step.observed | stepId、observation |
| model.completed | stepId，可选usage/providerRequestId；不保存原始模型推理或含填写值的decision |
| action.prepared | stepId、actionId、kind；click/fill/pressKey必须有target，其他动作禁止target；不携带原始填写值 |
| action.result | stepId、result |
| confirmation.required | stepId、confirmation |
| verification.result | stepId、verification |
| budget.updated | budget |

事件与消息各提供parse/decode函数，所有嵌套结果仍经过对应解析器；不能通过外层合法信封夹带未知动作。时间格式限定真实有效的UTC ISO时间（秒或毫秒精度），不检查本机当前时间。

## 本任务验证范围

对应FR-002/005/006/009/012/015与NFR-001的契约层：错误分支、越权角色、未知字段、版本/关联ID不匹配、超大UTF-8消息、引用重复、非法数值时间、结果证据缺失、事件顺序及确认参数注入必须拒绝。不能据此声称AC-10/11整体通过。验收须同时通过协议行为测试、类型断言、正式tsc检查和WXT生产构建。

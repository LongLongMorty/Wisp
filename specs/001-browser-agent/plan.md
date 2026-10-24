# 技术设计

## 实现基线

建议 TypeScript、WXT、pnpm workspace、Vitest；示例侧边栏使用 React。首个适配器为 Chrome MV3 + chrome.debugger。最低 Chrome 版本先按125设计，T-001验证后固化。此处是项目方案，不是外部项目特性的声明。

```text
packages/
  protocol/         schema、公共类型、错误与版本
  browser-chrome/   CDP连接、页面观察、引用注册、输入和等待
  runtime/          单步循环、状态机、预算、取消和检查点
  models/           Provider接口、实际端点适配、测试用脚本模型
  policy/           origin授权、动作分类、确认绑定
  sdk/              稳定公开入口
apps/
  extension/        Background、SidePanel及受限消息桥
fixtures/           可重置本地验收站点
```

依赖方向：protocol ← browser/models/policy ← runtime ← sdk ← extension。browser-chrome 可以通过 SDK 独立使用，但扩展特权必须来自受信任宿主；不能在普通网页中直接取得 debugger 权限。

## 运行上下文

- Background：唯一任务调度入口、模型调用、策略、CDP、租约和存储。不能依赖进程永不退出。
- SidePanel：交互和渲染；关闭面板不自动取消已运行任务，重新打开从存储恢复视图。
- 目标页 isolated world：按需执行预置观察脚本，不执行模型提供的代码；不在页面主世界保存密钥或授权状态。
- 第一版不需要 offscreen document，不部署浏览器内模型。

持久化采用 IndexedDB，设置与小型授权配置使用 chrome.storage.local。重启时将非终态任务变为 paused，恢复由用户触发。断连、导航和 debugger detach 都必须进入明确错误或暂停路径。

## 观察与引用

以DOM语义摘要为基础，不假定普通页面脚本能直接获得完整浏览器无障碍树。提取标签、显式及隐式角色、label/aria名称、可见文本、可用状态与边界。第一版支持主文档及 open Shadow DOM；iframe仅报告边界和不支持状态。

引用在适配器私有注册表中映射到确切节点身份；对外是不透明字符串。包含 tab、文档及观察作用域，导航或执行上下文销毁后失效。节点移除后再出现不得根据名称沿用旧引用。无关区域更新可以保持仍有效的同一节点引用。

观察有数量和字符上限，输出 truncation 元数据。连续滚动获取更多内容属于新的观察。禁止把整个 DOM 常驻放进上下文。

## 单步执行事务

1. 获取标签页执行租约，校验任务未取消及 origin 授权。
2. 观察、过滤、编译有界上下文；模型仅返回下一步决定。
3. schema验证、预算检查和本地策略判定；需要确认时落盘后进入 waiting_user。
4. 批准后重新检查页面、目标及参数；上下文变化使批准失效。
5. 记录动作 prepared；执行前再次检查取消信号和租约，再记录 dispatching。
6. 发送一次输入，记录派发结果。断连窗口中的结果为 unknown；本地 actionId 不能保证网页副作用 exactly-once。
7. 等待与动作相关的条件，报告页面响应和后置条件。没有期望条件时 verified 为 not_checked。
8. 持久化结果、更新摘要和预算；重新观察后推进。

使用 target稳定性检查与动作相关等待，不以通用 network-idle 或任意 DOM mutation 作为业务完成依据。运行时设置每步超时，不无限等待页面静止。

## 状态与恢复

```text
created → running → completed / failed / cancelled
             ↕
        waiting_user
             ↓
           paused → running
```

running可转paused或waiting_user；waiting_user批准有效后转running，拒绝后转paused，取消可从任意非终态进入cancelled。completed必须携带满足条件的证据；无法验证时以paused或failed解释原因。

检查点保存目标、绑定标签页、授权版本、状态、预算、摘要、最后动作及待确认内容。活动DOM引用不跨进程恢复。对 prepared 动作重新规划，对 dispatching/unknown 动作先核对后置条件；无法核对时交用户处理。不得自动重新执行潜在写入。

每个tab使用持久化租约，包含ownerRunId、generation和expiresAt；同一Background内以队列串行化竞争，重启后清理旧generation。租约不能替代对用户干预的检测；记录输入与导航信号，结合执行前重新验证降低竞争风险，不能承诺消除所有竞态。

## 策略与消息边界

策略输出 allow、confirm、handoff、deny。支付/密码/验证码/授权优先handoff；未授权origin和能力越界deny；已识别写入及未知语义confirm。禁止根据模型自报“安全”直接放行。

只读策略和元素启发式不能准确证明任意网站点击没有副作用；支持站点规则覆盖，未知语义保守确认。提示注入防护采用不可信数据分区、固定动作schema、授权范围与执行网关共同约束，不宣称绝对防护。

确认仅由扩展UI消息提交，验证sender、协议版本、runId及一次性confirmationId。批准绑定origin、documentId、目标指纹、完整动作参数摘要及30秒有效期；不得把“允许这次”升级为全站授权。任何不匹配都重新观察并重新确认。

## 日志与隐私

Trace记录动作元数据、状态和有限证据；敏感值用标记替代。任务内容和普通表单值可能仍含个人信息，应展示存储和传输说明。密钥仅会话内持有；第一版不默认持久化。用户可删除任务历史，历史默认保留7天，最多100个任务，超限删除最早终态任务；非终态任务不得静默删除。

## 验证策略

契约、状态机、策略、预算和恢复使用确定性测试；真实Chrome对本地fixture验证DOM与CDP行为。端到端使用脚本模型覆盖故障，再用一个实际模型端点运行规定任务。人工核查侧边栏确认、接管和敏感信息显示。所有通过结论须绑定代码版本、环境和证据。

## 实施顺序调整（2026-10-18）

T-001浏览器进程仍被环境阻塞，npm注册表访问也返回EACCES，所需工具缓存不可用。允许T-002a（不依赖浏览器的workspace、原生MV3工程骨架与静态检查）和T-003a（动作协议的纯函数校验与Node内置测试）先行；T-002b（TypeScript/WXT/React工具链及正式构建）、浏览器适配器和运行时集成仍保留原依赖门槛。

临时基线使用npm workspaces、ESM和公开.d.ts声明，构建仅复制原生MV3源文件，使用Node内置测试。此安排不等于完成TypeScript编译验证，也不替代最终WXT/React基线；不引入无法安装的依赖或虚构锁文件。恢复依赖下载后迁移至原计划工具链，功能需求和验收门槛不变。

## T-002b正式工具链迁移（2026-10-18）

保留npm workspace，接入WXT 0.21.4、React 18.3.1和TypeScript 5.9.3；扩展按WXT标准entrypoints组织，由wxt.config.ts生成manifest，删除临时复制构建入口。protocol以index.mts为唯一实现和类型来源，tsc生成JS及声明；Node22.18+可原生擦除类型执行协议测试，但该测试不代替TypeScript编译。源码内包使用workspace版本依赖，WXT提供显式源码alias用于前端编译。

T-002b完成门槛：依赖安装并生成真实lockfile、协议与扩展类型检查通过、WXT正式生产构建通过、生成MV3 manifest入口及资源完整。未达到全部条件不得勾选完成；构建成功也不代表浏览器侧功能验收通过。迁移期间所需依赖若受环境限制，保留明确失败证据，不以Node类型擦除或静态检查冒充正式编译成功。

上述实施顺序调整是当时记录。随后T-001浏览器阻塞未复现，npm经可达镜像恢复；T-001与T-002b均已完成，上述门槛全部满足，见[t001-report.md](t001-report.md)与[t002b-report.md](t002b-report.md)。

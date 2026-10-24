# T-007 授权、动作分类与一次性确认

日期：2026-10-18。状态：已完成；实现与工程检查通过，真实Chrome观察/控制/策略三轮验收均已复验通过（补测时发现并修复一处异步桥接缺陷）。

## 前置复核

T-006补测的14项观察回归、20项Chrome控制检查及工程检查均成功；三份证据的源码SHA-256与本任务开始时文件一致。确认T-006已完成，再先编写[策略规格](policy-v01.md)并实现本任务。

## 交付

新增[@wisp/policy](../../packages/policy/README.md)，提供纯分类器和独占tab适配器的执行网关。明确origin授权/撤销、保守站点规则、未知动作确认、敏感操作接管、严格UI消息与原生sender元数据校验；模型和页面没有直接执行入口。

批准有效30秒，绑定run、tab、action、授权版本、文档、目标指纹、页面字段摘要及完整请求参数。批准后重读页面并重新分类，实际派发前再次检查有效期和授权版本。一次性消费后即使失败也不恢复，重复请求不重放。

保留最初任务的取消信号；即使submit已经返回待确认，之后取消任务也阻止后来的UI批准。拒绝、过期、时钟回退/非法时钟、改字段、导航、撤销、换参数、错误run和重复批准均不得派发。

Chrome适配器新增readPolicyContext，使用同一isolated world及原节点注册表。普通字段值只在页面内生成SHA-256状态摘要；敏感值排除，不返回原始表单值。检查form.action、formaction覆盖、Enter潜在提交目的origin及新窗口。扫描、属性和字段字符串有预算，不完整目标上下文转交用户。

工程新增policy workspace、正式tsc构建、测试发现与policy:smoke命令，没有增加第三方运行依赖；package-lock.json通过本地离线workspace安装更新。

## 实际验证

[工程报告](evidence/t007-checks.json)：static、tests、typecheck、build全部通过，共113项测试，新增24项策略测试与5项页面上下文测试。

覆盖UI sender伪造、严格消息schema、批准/拒绝/重放、跨run和参数绑定、改字段与目标、过期与异步复验窗口、撤销、取消、并发、容量、规则优先级、敏感接管、越权目的地、完整8000字符fill展示，以及表单目的覆盖、敏感值不参与摘要、扫描截断。

[观察回归](evidence/t007-observer-browser.json)、[控制回归](evidence/t007-control-browser.json)、[策略Chrome证据](evidence/t007-browser.json)：Chrome156下分别14项、20项、17项检查全部通过，status=passed，源码哈希与当前一致。综合报告[t007-checks.json](evidence/t007-checks.json)为status=passed且三轮sourceHashesMatch=true。早前一轮Chrome启动时GPU进程崩溃被标为environment-blocked，复跑未复现。

## 浏览器复验与修复

首次复验时策略Chrome套件在首个断言`authorization.noImplicitGrant`失败：`gateway.observe()`返回`MODEL_INVALID_OUTPUT`（`policyContext.origin`缺失）。根因在浏览器桥`packages/browser-chrome/src/chrome.mts`的页面求值包装：`control.context()`是异步函数，而包装用同步IIFE返回`{ok,value:Promise}`；CDP的`awaitPromise`只等待顶层结果，内层Promise被按值序列化为`{}`，策略上下文因此缺字段。观察/检查/准备等同步路径不受影响，故T-005/T-006未暴露该缺陷。

修复：改为异步IIFE并`await`内层表达式，使`awaitPromise`可解析异步页面调用。修复后策略套件17项全部通过，并回归重跑T-005/T-006浏览器证据以绑定当前源码。

~~~powershell
npm run policy:smoke
node scripts/validate-toolchain.mjs t007
~~~

命令先编译protocol/browser/policy，再运行14项观察回归、20项控制回归、17项策略Chrome检查。策略检查覆盖未授权不暴露观察、普通fill允许、提交前确认、页面sender伪造拒绝、拒绝/重放/改字段/过期/撤销/导航不提交、formaction与Enter覆盖目的origin拒绝、敏感表单接管且上下文不含字段值、跨域链接与显式越权导航拒绝；最终独立oracle只看到一次有效批准的提交，过期使用可控宿主时钟而未等待真实30秒。

三份浏览器证据status=passed、检查项完整且源码哈希一致；t007-checks.json为status=passed、三轮sourceHashesMatch=true、lockfilePresent=true，满足勾选条件，可进入T-008。失败时应保留证据并修复，不手工修改状态为成功。

## 边界

当前没有扩展runtime消息监听和确认UI，sender测试验证宿主传入元数据的拒绝规则；真实Chrome策略测试也通过宿主harness提供sender，而不是已部署侧边栏。原生sender必须由未来T-012的Chrome回调提供，不能信任消息中自报身份。

宿主可独立使用原始控制库，但接模型/页面时必须只暴露网关。启发式分类不能证明任意网站没有自动保存或脚本导航等副作用；可信规则可以收紧默认fill。检查后竞态与已发输入不能撤回仍存在。批准和去重目前仅在进程内，Worker恢复与持久化由T-008实现，重启不复活旧批准。

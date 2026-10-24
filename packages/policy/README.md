# @wisp/policy

T-007的origin授权、保守动作分类与一次性确认网关。只面向受信任宿主，尚未接扩展UI或模型消息入口。

~~~ts
import {createPolicyGateway} from '@wisp/policy';
// browser是宿主持有的ChromeControlledAdapter，勿向模型/页面暴露原始execute。
const gateway=createPolicyGateway({browser,readContext:(request,signal)=>browser.readPolicyContext(request,signal),extensionId,uiUrl:'chrome-extension://'+extensionId+'/sidepanel.html',tabId});
// uiSender必须取自Chrome runtime.onMessage的原生sender参数。
gateway.grantOrigin('https://example.test',uiSender);
const observation=await gateway.observe();
const decision=await gateway.submit(runId,request,runSignal);
// 返回confirm时由宿主展示decision.confirmation；合法UI只回传ID与批准/拒绝。
const result=await gateway.confirm(message,uiSender,runSignal);
await gateway.dispose();
~~~

sender要求相同extensionId、精确sidepanel URL、无tab；消息体自报source或sender不构成身份。当前模块不注册runtime监听，也不认证任意JS调用方；后续T-012必须正确传入可信元数据。grant/revoke不由页面触发，批准不自动授权origin。

默认普通非敏感文本fill、scroll与授权origin内显式navigate允许；未知click/pressKey确认，敏感字段/含敏感字段的表单及支付/认证语义转交用户；越权目的origin、新窗口、失效或禁用目标拒绝。不完整目标上下文不能批准。可信站点规则按精确origin/path/kind/role/name匹配，多条取最保守结果，不能覆盖硬拒绝和敏感接管。启发式分类不能证明任意网站没有自动保存等副作用，宿主可用规则要求fill也确认。

批准30秒有效，绑定run/tab/action、授权版本、原文档、目标指纹、字段状态和完整请求摘要。批准后重读页面再验证；改字段、导航、撤销、拒绝、过期、取消使本次批准失效。保留最初submit的任务取消信号，等待UI期间取消也会阻止后来批准。批准消费后即使执行失败也不能重放。

同actionId/run/payload返回已有决定或结果，不同内容拒绝；256个动作ID、128个待确认、256份已发确认的容量满后拒绝新请求，不驱逐去重记录。授权和待确认只在内存，重启后重新授权/确认；跨Worker去重属T-008。取消不能撤回已发输入；页面脚本和检查后竞态仍有边界。

Chrome上下文读取在同一isolated world中把普通字段值/URL变为SHA-256摘要，敏感字段值排除，不返回原始表单值。明确检查链接、form.action、formaction覆盖和Enter潜在提交按钮目的origin。策略确认仅展示本次动作参数，不展示其他表单内容。

~~~powershell
npm run build:policy
npm test
npm run policy:smoke
node scripts/validate-toolchain.mjs t007
~~~

policy:smoke先编译，再运行观察回归、控制回归和策略Chrome验收，生成t007-observer-browser.json、t007-control-browser.json、t007-browser.json，不覆盖历史验收。WISP_CHROME可指定Chrome路径。

详见[策略规格](../../specs/001-browser-agent/policy-v01.md)与[T-007报告](../../specs/001-browser-agent/t007-report.md)。

T-008新增validateConfirmation(message,sender)只读鉴权，不消费批准，用于运行时在记录派发前拒绝伪造消息；真正confirm仍重新鉴权并一次性消费。

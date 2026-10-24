# @wisp/browser-chrome

T-005只读观察、T-006控制及T-012侧边栏宿主已接入；各阶段工程检查与真实浏览器验收分别记录。

T-014实测修复增加普通字段value/valueTruncated、原生select的有界options及选中状态；敏感字段仍不返回值。新增`{kind:'selectOption',target,value}`按精确option.value选择原生单选框，并验证结果；拒绝禁用/重复/缺失选项与旧引用。input/change为程序事件，isTrusted=false，不支持自定义或多选控件，策略默认仍确认。见[修复规格](../../specs/001-browser-agent/reliability-v02.md)，新能力待真实Chrome复验。

受信任宿主提供绑定目标tab的CDP transport，显式传入allowedOrigins：

~~~ts
import {createChromeAdapter} from '@wisp/browser-chrome';
const browser=createChromeAdapter(transport,{allowedOrigins:['https://example.test']});
const observation=await browser.observe();
const element=observation.elements.find(el=>el.role==='textbox'&&!el.sensitive);
if(element){
 const target={documentId:observation.documentId,frameId:observation.frameId,observationId:observation.observationId,ref:element.ref};
 const result=await browser.execute({actionId:crypto.randomUUID(),action:{kind:'fill',target,value:'Wisp'},expected:[{kind:'value',target,equals:'Wisp'}],timeoutMs:3000});
 console.log(result.dispatched,result.verified);
}
await browser.dispose();
~~~

transport.send(method,params,signal?)返回CDP结果体，宿主负责连接、tab绑定和断开。不接受任意脚本或选择器。仅供受信任宿主调用，接模型或扩展消息前必须完成T-007策略。保留createChromeObserver只读入口。

支持主文档和open Shadow DOM，最多保留8个观察作用域；移除/重插、替换和导航拒绝旧引用。观察受字符、字节、元素、扫描预算约束，识别敏感字段并清洗回显，未完整扫描时抑制文本。

动作前检查身份、禁用、可见、中心点遮挡和两次几何稳定性；不自动滚动目标。fill仅支持非敏感文本input/textarea，经可信CDP输入替换与清空；pressKey精确聚焦原节点后派发白名单按键，不额外点击。敏感字段拒绝，留给后续接管。scroll使用wheel；navigate限制origin。不能消除用户干预或页面脚本导航的所有竞态，不支持iframe/closed Shadow DOM、文件上传和contenteditable填充。

execute/observe/verify在同一实例串行。expected按AND有界等待，无expected时verified=not_checked、responded=unknown。裁剪不能证明absent；重名语义条件拒绝。超时与取消不撤回已发输入；未确认输入保留unknown，实例拒绝后续动作，需宿主核对结果后重建。dispose尝试释放鼠标/按键，关闭实例；不关闭宿主连接。

同actionId同payload复用结果，不同payload拒绝，最多缓存256条，达到容量拒绝新动作；这是进程内去重，跨Worker恢复属于T-008。

~~~powershell
npm run build:browser
npm test
npm run control:smoke
node scripts/validate-toolchain.mjs t006
~~~

control:smoke先编译，再执行观察回归（t006-observer-browser.json）和控制演示（t006-browser.json），不覆盖T-005历史证据。可用WISP_CHROME指定Chrome路径。

详情：[观察规格](../../specs/001-browser-agent/observer-v01.md)、[控制规格](../../specs/001-browser-agent/control-v01.md)、[T-006报告](../../specs/001-browser-agent/t006-report.md)。

T-007新增readPolicyContext(request,signal)，仅供受信任策略网关读取原节点、目的origin及字段状态摘要；不返回原始字段值。接模型/页面前使用@wisp/policy网关独占此adapter，不暴露原始execute。详见[策略规格](../../specs/001-browser-agent/policy-v01.md)。

T-008恢复：同tab的isolated world仅保留当前观察器所有者，新所有者接管时释放旧注册表和监听；旧实例的迟到dispose不会删除新所有者。该控制库按单tab单受信任执行宿主使用。

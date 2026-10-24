# T-005 页面观察与引用生命周期

日期：2026-10-18。状态：已完成；实现与工程检查通过，真实Chrome观察器验收已复验通过。

## 前置复核

用户补充的T-004真实Chrome页面smoke有14项成功检查，浏览器与工程报告的SHA-256均与开始T-005时的文件一致，因此进入T-005。T-004站点通过不替代本任务的观察器验收。

## 本次交付

先编写[观察规格](observer-v01.md)，再实现[只读观察库](../../packages/browser-chrome/README.md)：

- 主文档与open Shadow DOM语义观察、label/aria名称、视口正文、禁用及敏感标志。
- 私有节点引用及8个观察作用域；移除/重插、替换、过期和导航拒绝旧目标，不按名称重新绑定。
- 扫描、元素、文本、序列化字符和UTF-8字节预算，明确裁剪原因；扫描不完整时抑制可泄露文本。
- 已识别密码、OTP、token等字段回显与URL清洗，表单value不进入观察；脱敏先于名称空白归一化。
- 受信任tab绑定CDP transport、显式origin允许列表、isolated world安装、串行观察、上下文失效及取消处理。释放已移除ShadowRoot监听。

尚未接入扩展UI或完整BrowserAdapter；输入动作和actionability检查属于T-006。

## 实际验证

[工程证据](evidence/t005-checks.json)：static、tests、typecheck、build全部通过。共65项测试，其中新增13项覆盖引用保留/失效/容量、敏感清洗、origin拒绝、并发初始化、导航、更换文档、取消及错误清洗。类型检查由正式tsc执行，生产扩展由WXT构建。

[浏览器证据](evidence/t005-browser.json)：Chrome156下14项观察器断言全部通过，status=passed；机器信息、性能采样与源码SHA-256已记录。综合报告[t005-checks.json](evidence/t005-checks.json)为status=passed且sourceHashesMatch=true。早前一轮Chrome启动后GPU进程退出被标为environment-blocked，复跑未复现，按宿主机瞬态问题记录。

## 浏览器复验结果

~~~powershell
npm run observer:smoke
node scripts/validate-toolchain.mjs t005
~~~

observer:smoke先编译当前库，启动隔离fixture和Chrome，验证语义控件、禁用标志、Shadow DOM、敏感值回显、未完整扫描抑制、裁剪、无关重渲染、替换、同对象重插、作用域过期、导航、iframe边界与origin拒绝；并对200候选按钮页面采样30次。

本轮Chrome156结果：14项断言全部通过。性能采样sampleCount=30、p50≈17.6ms、p95≈19.2ms、max≈27.3ms，满足p95<500ms门槛；因24,000字符总预算，返回115个元素（候选200），报告分别记录候选数与返回数，符合规格。综合报告t005-checks.json为status=passed、sourceHashesMatch=true、lockfilePresent=true，满足勾选条件，可进入T-006。

默认Chrome路径为C:/Program Files/Google/Chrome/Application/chrome.exe，可用WISP_CHROME覆盖。失败时应保留证据并修复，不手工修改状态为成功。

## 范围限制

不进入iframe或closed Shadow DOM，不提供完整无障碍树，不承诺任意页面的未知自由文本秘密识别。引用有效不表示当前可点击；遮挡、动画与输入行为由T-006验证。本次浏览器验收仅覆盖本地fixture，不代表对任意网站可靠。

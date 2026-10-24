# T-006 输入动作与条件等待

日期：2026-10-18。状态：已完成；实现与工程检查通过，真实Chrome观察回归与控制验收均已复验通过。

## 前置复核

用户补测的T-005浏览器报告14项检查全部通过，200候选页面30次采样p95=19.17ms；T-005浏览器与工程证据中的源码SHA-256均与本任务开始时文件一致。确认T-005完成后，先编写[控制规格](control-v01.md)，再编码T-006。

## 交付

[BrowserAdapter实现](../../packages/browser-chrome/src/adapter.mts)提供capabilities、observe、execute、verify、dispose，可由受信任宿主独立导入，不依赖模型或侧边栏。

[DOM控制检查](../../packages/browser-chrome/src/control-document.mts)复用原节点引用，检查可见、disabled/aria-disabled/inert、视口中心点遮挡、open Shadow DOM命中、两次间隔50ms的几何稳定性及输入前焦点。拒绝敏感字段及不支持的填充控件。

fill经CDP点击、全选、Backspace和insertText实现替换与空串清空；pressKey通过固定DOM focus精确聚焦后发送白名单按键，避免额外点击。scroll使用wheel，显式navigate检查允许origin。派发期间重新检查取消、文档和目标。

execute区分dispatched、responded、verified，无expected不宣称页面响应或业务成功。有expected时只等待对应条件，匹配通过才记录成功；未完整观察不能证明不存在，重名语义条件拒绝。条件快照不发布新作用域，长等待不会挤掉原Target。

有界超时、取消、断连和部分派发保留不确定性。未确认或未完整执行的输入会阻止实例继续派发；不自动重试。dispose尝试释放鼠标/按键并中止待处理工作。同ID同payload在实例内复用结果，异payload拒绝；缓存256条后拒绝新ID，跨Worker去重留给T-008。

## 验证结果

[工程报告](evidence/t006-checks.json)：static、tests、typecheck、build全部通过，共84项测试，新增19项控制层测试。覆盖可信输入序列、空串、键盘不额外点击、禁用/遮挡/敏感/陈旧拒绝、移动与焦点丢失、期望条件失败、未知派发、取消、释放、同ID去重及缓存容量。

[观察回归证据](evidence/t006-observer-browser.json)和[控制演示证据](evidence/t006-browser.json)：Chrome156下分别14项观察回归与20项控制检查全部通过，status=passed，源码哈希与当前一致。综合工程报告[t006-checks.json](evidence/t006-checks.json)为status=passed且两份sourceHashesMatch=true；早前一轮Chrome启动后GPU进程崩溃被标为environment-blocked，复跑未复现，按宿主机瞬态问题记录。

## 浏览器复验结果

~~~powershell
npm run control:smoke
node scripts/validate-toolchain.mjs t006
~~~

control:smoke先编译当前库，再执行14项观察回归和20项控制检查，单独生成T-006证据，不覆盖已验收的T-005历史报告。默认Chrome路径可由WISP_CHROME覆盖。

本轮Chrome156结果：观察回归14项、控制演示20项全部通过；观察回归含30次性能采样，p95≈23.2ms，仍远低于500ms门槛。控制演示验证输入替换/清空、重复请求一次点击、键盘无额外点击、禁用/遮挡无副作用、Shadow按钮、滚动、导航、Enter搜索、旧引用拒绝、延迟保存加载/成功/失败、长等待保留值条件引用、敏感字段拒绝、越权导航拒绝、React18.3.1受控输入及重名条件拒绝；按钮与保存副作用由独立fixture oracle核对，不仅依赖观察输出。

两份浏览器证据status=passed、检查数完整、源码哈希一致；t006-checks.json为status=passed、observerRegression与browserControl均sourceHashesMatch=true、lockfilePresent=true，满足勾选条件，可进入T-007。失败时应保留实际证据并修复，不手工修改状态为成功。

## 限制

T-007策略确认尚未接入，当前控制API只面向受信任宿主，不向模型或页面消息开放。显式navigate的origin检查不证明能拦截任意页面脚本或重定向。无跨frame、closed Shadow DOM、文件上传或contenteditable填充；两次几何采样不能消除所有页面和用户干预竞态。取消无法撤回已发输入；进程内去重不是业务exactly-once。完整Agent、持久化恢复和UI仍由后续任务实现。

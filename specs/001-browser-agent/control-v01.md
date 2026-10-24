# T-006 页面控制规格

先决条件：T-005补测14项成功，30次采样p95=19.17ms；浏览器与工程报告源码哈希一致，验收通过。

## API与边界

createChromeAdapter(transport,{allowedOrigins})提供既有BrowserAdapter契约：capabilities、observe、execute、verify、dispose。transport由受信任宿主绑定tab，连接与页面授权UI由后续任务实现。沿用固定预置isolated world脚本，禁止任意脚本和选择器输入。该API仅供受信任宿主独立控制，T-007策略完成前不接模型或扩展页面消息。

## 动作前检查

目标必须是仍有效的原节点。重新检查origin、frame/loader、目标连接性、可见视口、disabled/aria-disabled/inert，命中测试递归进入open ShadowRoot，命中目标本身或其后代才允许。两次相隔至少50ms的检查要求几何位置和尺寸稳定（容差1px）；派发前再次检查。禁止自动替换目标或滚动后再点击未知节点。

fill仅支持普通文本类input及textarea，不支持密码/OTP/敏感字段、contenteditable、文件、日期、非文本控件；敏感目标click/pressKey也拒绝，交后续策略接管。通过CDP鼠标聚焦、全选、Backspace和insertText替换，避免直接赋值和合成DOM事件；空串必须真正清空。pressKey仅允许协议白名单；键盘通过固定DOM focus精确聚焦原节点，不通过点击聚焦，避免额外触发按钮业务动作；派发前确认焦点。scroll使用CDP wheel，navigate仅允许明确允许的HTTP(S)origin。动作派发各阶段重新检查取消、文档及目标，焦点不匹配拒绝后续键入。

## 结果与等待

execute在同一adapter串行；timeout覆盖动作和有界条件等待，排队时间不消耗执行时限。超时与取消传播到CDP，已发送请求仍可能产生效果，不假设取消可撤回。输入发送前标记不确定；确认CDP返回后记录派发成功。任何输入发送后断连/取消/超时不自动重试，保留unknown。已知至少一个输入确认但动作未完整结束时dispatched=yes，verified=unknown。清理鼠标与按键释放允许在取消后发送，不能继续新业务输入。

无expected时verified=not_checked，responded=unknown，不把CDP确认视为网页响应。expected逐条AND：URL精确、可见元素role/name精确、可见正文包含、原目标字段值精确。元素重名返回AMBIGUOUS_TARGET；裁剪/不支持导致不能证明时unknown，尤其不能把未扫描到当作absent。条件验证使用不发布作用域的只读快照，等待不挤掉既有Target。敏感字段值条件拒绝；证据只记录匹配/不匹配等标记，不返回原字段值或期望秘密。

有期望条件时只对这些条件轮询（50ms），不以任意DOM变化或network-idle确认。全部通过才verified=passed和responded=yes；超时保留failed或unknown，error=TIMEOUT。独立verify只取一次快照，不等待。

本进程同actionId同payload返回已有Promise/结果，不同payload拒绝，最多缓存256条，满后拒绝新动作而不遗忘旧ID；持久化去重和Worker恢复仍属T-008。传入请求严格校验并复制，执行中外部修改原对象无效。

## 验收

单元测试覆盖非法/敏感/陈旧目标、遮挡/移动拒绝、focus失配、输入顺序、origin拒绝、条件失败/歧义/unknown、取消/超时/断连、部分派发状态及同ID去重。真实Chrome对fixture验证输入替换和清空、键盘、禁用/遮挡无副作用、Shadow按钮、旧引用、滚动/导航、延迟保存成功与失败；oracle独立核对业务效果。包括React受控输入回归。浏览器测试未通过时T-006不勾选完成。

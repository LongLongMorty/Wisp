# T-001 Chrome能力探针

这是独立的MV3探针，不是正式SDK，也不代表AC-01/04/08完整验收已通过。扩展与执行器无运行时依赖；fixture为验证受控输入，随探针内置固定版本的React 18.3.1 UMD（vendor/，仅测试用，不属于workspace依赖）。

## 运行

需要Node22+、支持Extensions.loadUnpacked的近期Chrome。默认WindowsChrome路径可通过WISP_CHROME环境变量覆盖。

```powershell
node probes/t001/run.mjs
```

执行器在127.0.0.1随机端口启动fixture，通过remote-debugging-pipe加载扩展，在独立profile中运行。默认headless、禁用GPU，不接入用户日常会话。启动参数仅用于测试，不代表生产扩展运行要求；支持Chrome125的正式能力仍需最低版本回归。

结果输出到artifacts/latest.json。profile和原始日志不进入版本控制。失败记录应另存，不覆盖后声称通过。扩展代码不需要打包，浏览器直接加载；WXT构建验证属于后续工作。

## 检查内容

- chrome.debugger附着与释放。
- isolated world内节点引用：无关DOM更新保持身份，替换节点后旧引用失效。
- CDP输入触发原生input监听、contenteditable输入、open Shadow DOM点击。
- React 18.3.1受控输入经CDP可信输入触发onChange；并验证受控语义（主世界脚本赋值被value tracker抑制，绕过tracker才触发）。
- 导航使旧执行上下文失效。
- storage.local检查点跨Worker终止保留，bootId变化证明实际重启。

## 未覆盖

正式引用协议、IndexedDB事务恢复、任务租约、UI策略确认、正式构建和最低Chrome版本回归。仅固定React 18.3.1，其他框架版本未覆盖；Worker持久化只验证存储原语，不证明未知动作恢复机制已经实现。

仅用于本地fixture。不要给该探针添加第三方站点权限或当成通用执行器。

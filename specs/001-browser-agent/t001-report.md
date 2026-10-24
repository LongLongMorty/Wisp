# T-001 技术验证报告

- 日期：2026-10-18
- 状态：已完成；审查后的导航断言已复验通过，12项检查全部通过，边界见下文。
- 执行环境：Windows，Node v22.20.0，Chrome 156.0.8078.35，CDP 1.3。
- 代码：[探针说明](../../probes/t001/README.md)
- 结构化结果：[t001-attempts.json](evidence/t001-attempts.json)
- 工作区版本：本机非Git仓库，未获取提交标识；以探针源文件SHA-256与报告时间关联，`evidence/t001-attempts.json`顶层files对应当前源码，各次attempt中的files对应当次源码。

## 结论

早前阻止本任务的是本机浏览器子进程环境问题（GPU子进程异常退出，Target crashed）。在补充React用例后，以相同浏览器启动参数复跑，该故障未复现，`node probes/t001/run.mjs`全部12项检查通过。故障根因未能确证，按宿主机瞬态环境问题记录，不作为CDP方案的反证。

## 已验证（本轮通过）

- 扩展：MV3探针在独立profile中加载，manifest声明`minimum_chrome_version=125`，`Extensions.loadUnpacked`返回扩展ID。
- 调试连接：`chrome.debugger.attach(target,'1.3')`附着，结束后detach。
- DOM身份引用：无关DOM变更后同一节点引用仍有效；节点被替换后旧引用`isConnected`为false且不再等同新节点。
- CDP输入：原生`input`监听、`contenteditable=true`、open Shadow DOM内按钮点击均由CDP输入触发。
- React受控输入：React 18.3.1受控`<input>`经CDP `Input.insertText`输入后，`onChange`触发、受控状态与回显同步更新。
- 受控语义：主世界直接`el.value=`配合合成`input`事件被value tracker抑制（不回显）；用原型setter绕过tracker后`onChange`触发。本用例同时证明原型setter配合合成事件可以更新状态，因此不能推导CDP是唯一可行路径。
- 导航：`Page.navigate`后旧isolated world执行上下文失效，拒绝继续求值。
- Worker终止：`ServiceWorker.stopAllWorkers`后bootId变化，证明Service Worker实际重启；`storage.local`检查点在重启后保留。

## 边界与未验证

- **最低版本回归未做**：本机仅有Chrome 156，无法对125/126/127做二进制回归。`minimum_chrome_version=125`继续作为暂定基线，待更旧版本可用时确认。
- **加载方式**：`Extensions.loadUnpacked`仅用于测试执行器；生产扩展通过常规安装加载，其最低版本要求与此命令无关。
- **持久化原语**：检查点仅用`chrome.storage.local`；正式IndexedDB事务恢复、租约和未知动作恢复机制不在本探针范围。
- **框架覆盖**：仅固定React 18.3.1 UMD；其他框架/版本未覆盖。原生`input`监听不能替代框架受控组件验证，已由React用例补齐。
- **用户干预检测**：程序输入与用户输入的区分（Q-005）未在本探针闭合，留待T-008。
- **模型**：未接入任何实际模型端点。
- 本结论仅覆盖本地fixture上的控制层原语，不代表AC-01/04/08整体验收通过。

## 设计影响

- 本版选择CDP输入作为统一执行路径；普通脚本`el.value=`赋值不能保证正确触发受控状态更新。测试也证明原型setter加合成事件可更新本用例，不能据此声称必须使用CDP。不同执行世界中value tracker的可见性未直接验证，保留为待研究问题。
- 旧引用拒绝与无关变更保持身份的设计得到证据支持（D-005）。
- Service Worker非常驻、检查点跨重启保留的设计得到证据支持（D-008）。

## 后续执行

1. T-001完成，回写Q-001/002/003/005并更新任务状态。
2. 进入T-002b：迁移TypeScript/WXT/React正式工具链与编译构建；随后推进浏览器适配器与运行时。
3. 有更旧Chrome构建时补做125最低版本回归，并把结论固化进plan基线。

参考：[Chrome debugger API](https://developer.chrome.com/docs/extensions/reference/api/debugger)、[Service Worker生命周期](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)。官方文档说明不替代实际运行证据。

## 审查修正与本轮复验（2026-10-18）

- 修正检查数量为12，并收紧React结论；CDP是本版工程选择，测试不证明它是唯一可行输入方式。
- 导航断言改为先确认主frame到达目标URL，再只接受指定上下文不存在/销毁错误；连接断开等其他错误会导致探针失败。
- React vendor的版本与SHA-256分开记录。旧成功记录见[t001-user-success.json](evidence/t001-user-success.json)，原background源码见[t001-background-before-review.js](evidence/t001-background-before-review.js)。
- 新断言版本已于2026-10-18T02:50:23Z复验通过：先确认主frame到达目标URL，旧isolated world求值返回`Cannot find context with specified id`，12项检查全部通过。旧版通过记录与本轮通过记录分别保存在[evidence/t001-attempts.json](evidence/t001-attempts.json)，未覆盖历史记录。

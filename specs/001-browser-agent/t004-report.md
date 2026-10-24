# T-004 本地验收站点交付报告

日期：2026-10-18。状态：已完成；站点与独立HTTP验收环境已交付，真实Chrome页面smoke已复验通过。本任务不代表Agent的AC场景已通过。

## 交付

- fixture-0.1固定工单数据，包含同名但状态不同的记录，及五条待处理高优先级记录。
- 搜索/详情、筛选表格、提交表单、label输入/禁用/遮挡/open Shadow DOM/滚动、重渲染、延迟成功/失败、敏感与注入页面、200按钮页面。
- 应用、跨origin frame和私有控制服务采用三个不同的127.0.0.1端口。
- 控制服务支持隔离session创建、配置、重置、销毁和读取独立业务事实；随机Bearer token不注入页面，不开放CORS。
- 业务提交、保存和点击按实际次数计数，故意不按请求自动去重；oracle可揭示重复提交与错误重试。
- 重置更新generation并清空状态；重置前的异步保存返回409，不污染新状态。页面需刷新或重新导航。

入口：[fixtures/web/README.md](../../fixtures/web/README.md)。设计范围见[fixtures-v01.md](fixtures-v01.md)。

## 已通过

- 16项真实本地HTTP集成测试：权限/隔离、路由与资源、搜索/详情/筛选、真实副作用、失败保存、重置与销毁竞态、资源路径与请求大小边界。
- Chrome156真实页面smoke 14项全部通过：搜索详情、表格筛选、控件输入/禁用/遮挡/open Shadow DOM、无关重渲染保持引用与替换失效、表单副作用、延迟保存的加载态/成功/失败、跨origin边界与伪造批准无业务副作用、200按钮可见性。
- 全部36项协议测试保持通过，总计52项测试通过。
- 静态语法与JSON检查、协议及扩展类型检查、WXT生产构建和产物入口资源检查均通过。
- 本阶段未新增第三方依赖。

复验命令：

~~~powershell
node fixtures/web/test/browser-smoke.mjs
node scripts/validate-toolchain.mjs t004
~~~

必需检查与源文件SHA-256保存在[t004-checks.json](evidence/t004-checks.json)：status=passed，browserSmoke.status=passed，timestamp指向本轮成功记录。该status涵盖站点/HTTP/工程交付检查以及浏览器页面smoke；不代表T-005起的Agent观察/动作/策略/恢复能力或AC场景已经通过。

## 浏览器检查结果

[t004-browser.json](evidence/t004-browser.json)记录Chrome156下的真实页面smoke：14项检查全部通过，status=passed，记录内的fixture源码哈希与本次一致。早前一轮因GPU子进程异常退出（exit_code=-1073741790，页面断言执行数为0）被标为environment-blocked；该故障为宿主机瞬态问题，复跑未复现。未关闭浏览器沙箱，也未用其他profile绕过限制。

smoke覆盖搜索详情、表格筛选、基础控件（输入、禁用、遮挡）、open Shadow DOM、无关重渲染保持引用、节点替换失效、表单副作用计数、延迟保存的加载/成功/失败、跨origin frame边界与伪造批准无业务副作用、200按钮在视口内可见性。可通过WISP_CHROME指定浏览器可执行文件。本结果只证明fixture在真实Chrome中按预期呈现并可被CDP驱动，不需要也不能替代T-005起的观察器与Agent能力验证。

## 后续边界

- T-005及之后使用本fixture验证实际观察器、动作驱动、策略和恢复机制。
- Node HTTP检查只验证HTML存在200个按钮；真实Chrome smoke已确认这200个按钮在默认1280x720视口内全部可见，但尚未测量观察耗时p95（属T-005/T-014）。
- 密码/验证码/令牌是固定测试哨兵；真正观察脱敏与提示注入防护仍待后续Agent模块验证。
- Worker终止、模型畸形输出、费用/步数预算和事件历史清理不属于站点本身，分别由后续模块提供测试注入点。

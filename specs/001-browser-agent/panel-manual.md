# T-012 原生侧边栏人工检查

自动探针使用相同WXT产物的临时副本，仅增加loopback测试所需必选host权限，避免自动接受权限对话框。它不证明实际权限提示或人工可读布局。以下必须使用未改动的生产构建。

1. 执行 `npm run build`，在Chrome扩展管理页开启开发者模式，加载 `apps/extension/.output/chrome-mv3`。点击扩展图标打开真正的侧边栏；不能用普通tab打开sidepanel.html代替。
2. 分别运行 `node fixtures/web/start.mjs` 与 `node apps/extension/test/model-fixture.mjs`。打开站点输出的session.baseUrl加 `/controls`；模型使用第二个终端输出的endpoint、model，密钥可留空或用假值 `PANEL_TEST_KEY`。这些均为本地测试，不需要真实模型密钥或计费。终端保持运行。
3. 逐项检查并记录：

| ID | 必须实际检查的内容 |
| --- | --- |
| permissions | 初始无站点授权。拒绝模型/站点主机权限后不执行；再次点击允许才能保存/授权。主机权限与Wisp精确origin授权分开；撤销后任务暂停。浏览器会显示debugger提示，不能声称静默无权限。 |
| layout | 约320px与480px侧边栏宽度下配置、站点、任务、确认、历史可读且无横向溢出；键盘可聚焦按钮；错误可读。记录自己的Chrome版本与观察。 |
| confirmation | 输入PANEL_CONFIRM，首次普通按钮点击必须挂起；确认卡片显示站点、具体动作/参数、有效期。拒绝无副作用；重新发起批准只执行一次；过期不批准。PANEL_READ应返回URL/文本验证证据。 |
| takeover | PANEL_HANG请求中点停止，本地状态1秒内停止，迟到结果不继续动作；PANEL_WAIT点接管可操作网页，恢复前需核对。关闭/重开侧边栏任务保持暂停，不自动继续。手动页面输入来源Q-005尚不能可靠归因。 |
| privacy | 保存后密码输入清空；清除配置后无会话密钥。DevTools检查密钥仅storage.session，未进入local/sync/任务IndexedDB/事件/目标页。删除终态历史后不显示，unknown不允许直接删除或重发。 |

五项完成且无缺陷后，由实际检查者记录（仅记录已亲自完成的检查）：

```powershell
node scripts/record-panel-manual.mjs --passed=permissions,layout,confirmation,takeover,privacy --reviewer=local-user
node scripts/validate-toolchain.mjs t012
```

如尚未检查，直接运行 `node scripts/record-panel-manual.mjs` 只生成not-run，不会标为通过。人工记录绑定当前源码和产物；源码/构建变化后需要重新核对。若发现缺陷，保留失败说明，修复并重新执行相关自动/人工检查，不编辑证据伪造成功。

自动探针若报告NATIVE_PANEL_AUTOMATION_UNAVAILABLE，可在支持原生侧边栏的Chrome下用 `WISP_CHROME` 指定路径；设置 `WISP_CHROME_HEADED=1` 明确选择可见临时测试窗口。探针仍需实际SIDE_PANEL上下文，不会回退到普通扩展页冒充。

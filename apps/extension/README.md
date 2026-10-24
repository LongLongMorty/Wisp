# Wisp 原生侧边栏（T-012）

```powershell
npm run build
```

在Chrome扩展管理页以开发者模式加载 `.output/chrome-mv3`，点击扩展图标打开侧边栏。必须使用真正的侧边栏，普通tab/iframe打开sidepanel.html不会获得任务命令权限。

1. 填完整Chat Completions兼容API地址、模型名和可选密钥，点击保存，并自行选择是否授予模型主机权限。服务会收到过滤后的页面信息，费用未知；浏览器内推理不属于本版。
2. 选择普通HTTP(S)标签页，明确授权其origin。Chrome主机权限与Wisp精确origin授权独立；Chrome匹配主机的权限可能覆盖其他端口，Wisp只执行已授权的精确origin。
3. 填写目标，可选schema/步骤上限并开始任务。确认卡片显示具体站点、动作、参数和有效期；仅批准本次操作，没有自动批准。
4. 暂停、恢复、停止或手动接管；手动页面操作前先接管，Q-005仍不能可靠区分物理用户与CDP输入。Debugger断开、tab关闭或侧边栏关闭会暂停。重新打开/Worker重启后不自动运行，旧租约到期最多约5秒后恢复为暂停。
5. 删除终态历史。unknown动作先人工核对，显式解除屏障也不重发旧动作；无法核对时保持暂停，不用删除历史绕过屏障。恢复提取任务时需填回原schema，原预算保留。

模型配置与密钥只在Chrome受信任 `storage.session` 中，浏览器重启/扩展重载后清除；不是local/sync/任务IndexedDB配置。保存后密码输入清空，读取配置只返回hasKey。清除配置会先收紧模型访问并暂停任务。历史含用户目标和最终结果，按既有保留规则保存；日志只含有界脱敏元数据。

侧边栏RPC只接受原生SIDE_PANEL上下文；确认sender从原生消息读取。操作请求在浏览器会话内去重，中断请求返回OUTCOME_UNKNOWN。256条去重上限不会阻止停止/接管/撤销/清除配置。侧边栏轮询不会自动重复变更命令。

```powershell
npm run panel:smoke
node scripts/validate-toolchain.mjs t012
```

自动探针使用生产WXT代码与原生ServiceWorker/SIDE_PANEL，独立保存T-012七组证据。为自动化本地fixture，其临时manifest仅增加loopback必选权限；实际权限提示、布局与人工接管需按[人工检查](../../specs/001-browser-agent/panel-manual.md)使用未改动产物复核。没有人工通过记录不会验收。无需真实模型密钥。

规格见[panel-v01.md](../../specs/001-browser-agent/panel-v01.md)。实际模型15次任务与性能验收仍属T-014。

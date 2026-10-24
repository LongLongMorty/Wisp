# 安装与首次运行

Wisp目前以源码工作区和未打包Chrome扩展交付，尚未发布到npm或Chrome商店。请在仓库根目录运行命令。

## 环境与构建

- Node.js 22.18+、npm；已实测Node 22.20.0、Windows x64、Chrome 156.0.8078.35。
- manifest声明Chrome 125+，旧版125并未做兼容性实测。其他系统/浏览器见[支持范围](support.md)。

```powershell
npm ci --cache .cache/npm
npm run check
npm test
npm run build
```

使用随仓库的package-lock.json安装；prepare会生成WXT类型。首次安装需要可用网络，完整缓存已有时才可加 `--offline`。本次文档验收复用已安装依赖，不把它记为一次全新联网安装验证。构建输出是 `apps/extension/.output/chrome-mv3`；历史 `dist/extension` 不是当前产物。

## 加载和配置

1. 打开 `chrome://extensions`，开启开发者模式，选择“加载已解压的扩展程序”，选择上述chrome-mv3目录。
2. 点击Wisp扩展图标打开原生侧边栏。直接用标签页打开sidepanel.html不具备任务权限。
3. 在模型服务填写完整Chat Completions兼容URL（包含路径）、模型名及可选API密钥，保存时确认模型主机权限。HTTPS可用；HTTP仅限localhost/回环服务。密钥输入会清空，配置保留在本次浏览器会话。不要把密钥写入目标或示例文件。
4. 选择一个普通HTTP(S)网页并明确授权origin。模型主机权限、Chrome站点权限和Wisp精确origin授权分别生效，详见[权限与数据流](security.md)。
5. 输入目标并开始。未知/写入动作会等待一次性确认；先检查站点、目标、参数和有效期。支付、密码、验证码等交给人工。
6. 手动操作目标页前先点击接管。停止不撤销已经发出的请求；关闭面板或Worker中断后任务暂停，重新打开不会自动续跑。

更新构建后在扩展管理页重新加载；浏览器重启、扩展重载/更新/停用后会话配置可能被清除，重新配置并核对授权。任务历史与密钥的存储周期不同。

## 本地试用

```powershell
npm run fixtures:start
```

保持终端运行，打开输出的session.baseUrl加 `/search`、`/table` 或 `/form`。端口和session路径每次生成，请使用本次输出。可搜索“报表访问异常”、筛选待处理且高优先级工单，或填写表单并停在提交确认。

不想调用真实模型时，可另开终端运行 `node apps/extension/test/model-fixture.mjs`，按输出配置临时本地服务并使用其PANEL_READ/PANEL_CONFIRM/PANEL_WAIT等固定目标。它是测试模型，不代表实际模型能力。使用真实提供方会把过滤后的页面信息发送到所选服务，并可能产生费用。

## 验证与排查

- 无浏览器、无密钥的SDK示例：完成构建后 `node docs/examples/sdk-task.mjs`，见[SDK接入](sdk.md)。
- 文档和示例验收：`node scripts/validate-docs.mjs`。
- 浏览器可靠性：`npm run release:reliability`；完整实测与历史证据见[验证说明](verification.md)。

面板打不开时先核对加载目录、原生侧边栏和Chrome版本。无法访问网页时核对选中tab、浏览器主机权限及精确origin。模型错误时核对完整URL、模型名、权限和JSON模式；不在日志/截图中暴露密钥。unknown结果保持暂停，先核对业务结果，不通过新动作或删除历史重发。Chrome启动/GPU错误是探针环境故障，需要在可运行Chrome的环境复测。

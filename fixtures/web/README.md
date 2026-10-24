# 本地Web验收站点

版本fixture-0.1；只使用Node内置模块，无CDN、外部账户或真实业务数据。应用、跨origin iframe和测试控制服务都只监听127.0.0.1，端口自动分配。

## 启动与重置

~~~powershell
node fixtures/web/start.mjs
~~~

终端输出应用origin、frameOrigin、控制origin、测试控制token及初始session.baseUrl。浏览器打开baseUrl即可。Ctrl+C关闭服务。控制token只供测试进程使用，不会出现在HTML或页面脚本中。

测试代码可调用createFixtureServer()，再用createController(server)创建隔离会话、读取事实和重置：

~~~js
import {createFixtureServer} from './server.mjs';
import {createController,assertSubmissionCount} from './oracle.mjs';
const server=await createFixtureServer();
try {
  const control=createController(server);
  const session=await control.create();
  // 浏览器访问session.baseUrl+'/form'并通过普通页面提交。
  assertSubmissionCount(await control.state(session.sessionId),0);
  await control.reset(session.sessionId);
} finally { await server.close(); }
~~~

重置清空业务副作用与故障配置并更新generation；已有页面需刷新或重新导航。重置前的pending保存返回409，不污染新状态。不同会话的副作用完全隔离。

## 场景

路径统一为/s/<sessionId>/<场景>。首页提供导航。

| 场景 | 作用 |
| --- | --- |
| search、records/W-102 | 同名工单搜索与详情；待处理与已关闭项目并存 |
| table | 状态/优先级过滤，待处理高优先级恰好五条 |
| form | 标题、描述、优先级与真实提交次数 |
| controls | 原生输入、禁用、遮挡、open Shadow DOM与滚动 |
| rerender | 无关更新、同名节点替换与操作计数 |
| delayed-save | 延迟成功/失败，以及与保存无关的DOM心跳 |
| safety | 测试提示注入、敏感字段、页面伪造批准、未授权链接和跨origin iframe |
| performance | 恰好200个普通按钮；1280×720为可见性smoke视口 |

控制API需要Authorization: Bearer <controlToken>，不开放CORS。支持POST /sessions、GET /sessions/:id/state、POST /sessions/:id/reset、POST /sessions/:id/config、DELETE /sessions/:id。创建和重置body为{}；配置可包含saveMode=success/failure及delayMs=0–5000。

应用业务API位于/api/<sessionId>，包括records、record/:id、submit、save和click。副作用不会按请求自动去重，重复提交会真实累计，供后续Agent重试与恢复测试发现错误。

oracle.mjs的断言仅在测试进程使用，直接核对后端业务事实；不接受Agent宣称成功作为证据。不要把控制token或oracle响应放入模型上下文。

## 验证

~~~powershell
node --test fixtures/web/test/server.test.mjs
node fixtures/web/test/browser-smoke.mjs
node scripts/validate-toolchain.mjs t004
~~~

HTTP集成覆盖控制权限、隔离、业务真值、副作用、重置竞态及资源边界。真实Chrome smoke使用独立profile与CDP检查页面交互，通过WISP_CHROME可指定浏览器路径。浏览器结果独立保存在specs/001-browser-agent/evidence/t004-browser.json；若环境阻塞，不得把HTTP通过视为浏览器通过。

场景自身通过也不代表Agent的AC-01–12整体验收通过。模型畸形响应、预算、扩展Worker生命周期及真正的页面观察器由后续模块接入验证。

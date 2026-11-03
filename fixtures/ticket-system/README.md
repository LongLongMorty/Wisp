# Ticket System Fixture

工单系统测试 Fixture，用于验证浏览器 Agent 的表单处理、状态管理和多步骤交互能力。

## 这个系统的作用

它是 Wisp 的本地测试站，补充 `fixtures/web/` 没有覆盖的场景：

- 多字段表单：级联下拉（一级分类变化时二级分类重置）、条件显示（优先级为紧急时才出现日期字段）
- 多步状态流转：待处理 → 处理中 → 已解决 → 已关闭，非处理人看不到后两步的按钮
- 服务端拒绝时的页面反馈：创建或状态变更被拒绝时，页面显示 `role="alert"` 提示，不跳转
- 严格的副作用校验：Oracle 通过控制 API 读取数据库里的工单与审计日志，不依赖页面显示或 Agent 的自述

用法：在浏览器里打开 `start.mjs` 输出的地址，让 Wisp 扩展按目标操作页面，再用 `oracle.mjs` 的断言核对结果。

它不是真实业务系统，也不能替代 T-018 要求的真实 Web 应用试用。当前用户固定为 `user1`，没有登录与多用户切换，所以跨用户的权限场景只能在 repository 层构造。

## 快速开始

```bash
# 启动服务器，终端输出 origin、控制 token 和初始 session.baseUrl，Ctrl+C 关闭
node fixtures/ticket-system/start.mjs

# 单元与 HTTP 测试
node --test fixtures/ticket-system/test/*.test.mjs
# 真实 Chrome 检查（可用 WISP_CHROME 指定浏览器路径）
node fixtures/ticket-system/test/browser-smoke.mjs
node fixtures/ticket-system/test/spec-evidence.mjs
```

`npm test` 的文件列表不包含本目录，需要单独运行上面的命令。

## 架构

- **domain.mjs**: 业务逻辑，SQLite 会话存储，工单 CRUD 和状态变更
- **server.mjs**: HTTP 服务器，业务 API + 控制 API
- **pages.mjs**: HTML 模板渲染，属性值转义防注入
- **public/app.js**: React 18 前端（UMD），CreateTicket/TicketList/TicketDetail 组件
- **oracle.mjs**: 测试断言辅助函数，封装控制 API 调用

## API

### 业务 API（需 `sessionId`）

- `POST /api/:sessionId/tickets` — 创建工单
- `GET /api/:sessionId/tickets?status=all&priority=all` — 查询工单列表
- `GET /api/:sessionId/tickets/:ticketId` — 获取工单详情
- `PATCH /api/:sessionId/tickets/:ticketId/status` — 变更工单状态
- `GET /api/:sessionId/tickets/:ticketId/audit-logs` — 获取审计日志
- `GET /api/:sessionId/categories` — 获取分类树
- `GET /api/:sessionId/users` — 获取用户列表

### 控制 API（需 Bearer token）

- `POST /control/sessions` — 创建隔离会话
- `GET /control/sessions/:sessionId/state` — 获取会话完整状态
- `POST /control/sessions/:sessionId/reset` — 重置会话
- `DELETE /control/sessions/:sessionId` — 销毁会话

## 前端路由

- `/ticket-system/s/:sessionId/home` — 首页导航
- `/ticket-system/s/:sessionId/create` — 创建工单表单
- `/ticket-system/s/:sessionId/list` — 工单列表（筛选）
- `/ticket-system/s/:sessionId/detail/:ticketId` — 工单详情（状态变更）

## 测试场景

1. 空表单提交被浏览器验证拒绝
2. 有效表单提交创建工单并重定向
3. 一级分类变更时二级分类选项级联更新
4. 状态筛选仅显示符合条件的工单
5. 完整状态流转：pending → processing → resolved → closed
6. 非处理人看不到"标记已解决"和"关闭工单"按钮

## 依赖

- Node.js 22.18+，只用内置模块（`node:http`、`node:sqlite`、`node:crypto`），无 npm 依赖
- React 18.3.1 UMD 本地副本，位于 `public/vendor/`，无 CDN
  - react.production.min.js SHA-256 `d949f1c3687aedadcedac85261865f29b17cd273997e7f6b2bfc53b2f9d4c4dd`
  - react-dom.production.min.js SHA-256 `35f4f974f4b2bcd44da73963347f8952e341f83909e4498227d4e26b98f66f0d`
- 浏览器测试需要本机 Chrome

## 权限模型

当前操作人由服务端固定为 `user1`（张三），请求体里带 `operator` 会被拒绝。浏览器测试通过 `domain.mjs` 的 repository 直接以其他用户身份造数据，用来验证"非处理人看不到按钮"，业务 API 本身无法切换用户。

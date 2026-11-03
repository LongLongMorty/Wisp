# Ticket System Fixture — 详细规范

**版本**: ticket-system-0.1  
**状态**: 实现完成，6 个测试场景通过

---

## 1. 概述

本 Fixture 模拟企业内部工单系统，包含创建、查询、状态变更和审计日志功能。设计目标是验证浏览器 Agent 能否处理：

- 多字段表单填写和验证
- 级联下拉选择（一级分类变更触发二级分类选项更新）
- 条件渲染（优先级为"紧急"时显示预计解决时间）
- 列表筛选（状态、优先级）
- 状态流转按钮的权限隐藏（非处理人不可见）
- 审计日志完整性

---

## 2. 数据模型

### 2.1 工单 (Ticket)

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | 是 | T-0001 格式，自增 |
| title | string | 是 | 工单标题 |
| description | string | 是 | 详细描述 |
| category1 | string | 是 | 一级分类 |
| category2 | string | 是 | 二级分类 |
| status | string | 是 | pending/processing/resolved/closed |
| priority | string | 是 | low/medium/high/urgent |
| assignee | string | 否 | 处理人 ID，未分配时为 null |
| due_date | string | 否 | ISO 8601 日期，仅 priority=urgent 时可填 |
| created_at | string | 是 | ISO 8601 时间戳 |
| updated_at | string | 是 | ISO 8601 时间戳 |

### 2.2 审计日志 (AuditLog)

| 字段 | 类型 | 说明 |
|------|------|------|
| id | integer | 自增 |
| ticket_id | string | 关联工单 |
| action | string | created/status_changed/assigned |
| operator | string | 操作人 ID |
| timestamp | string | ISO 8601 时间戳 |
| details | string | JSON 字符串，status_changed 时存 `{"from":"X","to":"Y"}` |

### 2.3 分类树

```json
{
  "技术问题": ["无法登录", "功能报错", "性能问题", "数据丢失"],
  "业务咨询": ["功能咨询", "价格咨询", "流程咨询", "政策咨询"],
  "功能建议": ["新功能", "界面改进", "流程优化", "其他建议"]
}
```

### 2.4 用户列表

```json
[
  {"id": "user1", "name": "张三"},
  {"id": "user2", "name": "李四"},
  {"id": "user3", "name": "王五"}
]
```

当前操作人固定为 `user1`，业务 API 不接受 `operator` 字段（服务端强制覆盖）。

---

## 3. API 规范

### 3.1 业务 API

基础路径：`/api/:sessionId`

#### 3.1.1 创建工单

```http
POST /api/:sessionId/tickets
Content-Type: application/json

{
  "title": "无法登录系统",
  "description": "输入正确账号密码后提示网络错误",
  "category1": "技术问题",
  "category2": "无法登录",
  "priority": "high",
  "assignee": "user2",  // 可选
  "due_date": "2026-11-10"  // 可选，仅 priority=urgent 时有效
}
```

**响应**：
```json
{
  "ticket": {
    "id": "T-0001",
    "title": "无法登录系统",
    "status": "pending",
    "created_at": "2026-11-03T12:34:56.789Z",
    ...
  }
}
```

**验证规则**：
- `title` 和 `description` 去除首尾空白后不能为空，长度上限分别为 200 和 2000 字符
- `category1` 必须在分类树 key 中存在
- `category2` 必须是对应 `category1` 的子分类
- `priority` 必须是 `low/medium/high/urgent` 之一
- `due_date` 仅在 `priority=urgent` 时保存，其他情况服务端忽略并存为 `null`
- `assignee` 必须在用户列表中或为 `null`

校验失败时返回 400，不写入数据库。

#### 3.1.2 查询工单列表

```http
GET /api/:sessionId/tickets?status=pending&priority=high
```

**查询参数**：
- `status`: `all` 或具体状态，默认 `all`
- `priority`: `all` 或具体优先级，默认 `all`

**响应**：
```json
{
  "tickets": [
    {"id": "T-0001", "title": "...", "status": "pending", ...}
  ]
}
```

#### 3.1.3 获取工单详情

```http
GET /api/:sessionId/tickets/T-0001
```

**响应**：
```json
{
  "ticket": {"id": "T-0001", ...}
}
```

#### 3.1.4 变更工单状态

```http
PATCH /api/:sessionId/tickets/T-0001/status
Content-Type: application/json

{
  "status": "processing"
}
```

**状态流转规则**：
- `pending` → `processing`（任何人都可以点"开始处理"，处理人自动设为当前用户）
- `processing` → `resolved`（仅处理人可操作）
- `resolved` → `closed`（仅处理人可操作）

服务端验证 `operator` 是否为处理人，否则返回 403。

**响应**：
```json
{
  "ticket": {"id": "T-0001", "status": "processing", ...}
}
```

#### 3.1.5 获取审计日志

```http
GET /api/:sessionId/tickets/T-0001/audit-logs
```

**响应**：
```json
{
  "logs": [
    {
      "id": 1,
      "ticket_id": "T-0001",
      "action": "created",
      "operator": "user1",
      "timestamp": "2026-11-03T12:34:56.789Z",
      "details": "{}"
    },
    {
      "id": 2,
      "action": "status_changed",
      "operator": "user1",
      "timestamp": "2026-11-03T12:35:10.123Z",
      "details": "{\"from\":\"pending\",\"to\":\"processing\"}"
    }
  ]
}
```

#### 3.1.6 获取分类树

```http
GET /api/:sessionId/categories
```

**响应**：
```json
{
  "categories": {
    "技术问题": ["无法登录", "功能异常", "性能缓慢"],
    ...
  }
}
```

#### 3.1.7 获取用户列表

```http
GET /api/:sessionId/users
```

**响应**：
```json
{
  "users": [
    {"id": "user1", "name": "张三"},
    ...
  ]
}
```

### 3.2 控制 API

基础路径：`/control`，需 `Authorization: Bearer <token>`

#### 3.2.1 创建会话

```http
POST /control/sessions
Content-Type: application/json

{}
```

**响应**：
```json
{
  "sessionId": "uuid",
  "generation": 1
}
```

`generation` 初始值为 1，每次 reset 递增。

#### 3.2.2 获取会话状态

```http
GET /control/sessions/:sessionId/state
```

**响应**：
```json
{
  "generation": 1,
  "tickets": [...],
  "auditLogs": [...]
}
```

初始 `generation` 为 1，每次 reset 递增。

#### 3.2.3 重置会话

```http
POST /control/sessions/:sessionId/reset
```

清空所有工单和日志，`generation` 递增。

#### 3.2.4 销毁会话

```http
DELETE /control/sessions/:sessionId
```

响应 204 No Content。

---

## 4. 前端规范

### 4.1 路由

- `/ticket-system/s/:sessionId/home` — 首页，静态 HTML，链接到 create 和 list
- `/ticket-system/s/:sessionId/create` — 创建工单表单
- `/ticket-system/s/:sessionId/list` — 工单列表
- `/ticket-system/s/:sessionId/detail/:ticketId` — 工单详情

### 4.2 CreateTicket 组件

**功能**：
1. 加载分类树和用户列表（useEffect）
2. 级联下拉：选择 `category1` 时，`category2` 自动重置为新分类的第一个选项
3. 条件渲染：`priority=urgent` 时显示 `due_date` 输入框（type=date），切换到其他优先级时清空 `due_date` 并隐藏
4. 提交成功后跳转到 `/list`

**表单字段**：
- title (input, required)
- description (textarea, required)
- category1 (select, required)
- category2 (select, required)
- priority (select, required, 默认空需用户选择)
- due_date (input type=date, 仅 priority=urgent 时显示)
- assignee (select, 可选，默认"未分配")

### 4.3 TicketList 组件

**功能**：
1. 初次加载显示全部工单（useEffect 一次）
2. 筛选条件：status 和 priority 下拉
3. 点击"筛选"按钮后重新请求，**不**在下拉 onChange 时自动刷新
4. 表格列：ID、标题、状态、优先级、处理人、操作（"查看"链接跳转到 detail）
5. "+ 创建工单"链接回到 create

### 4.4 TicketDetail 组件

**功能**：
1. 加载工单详情和审计日志（useEffect）
2. 显示字段：标题、描述、一级分类、二级分类、状态、优先级、处理人、创建时间、更新时间、预计解决时间（如有）
3. 状态变更按钮：
   - `pending` → "开始处理"（所有人可见）
   - `processing` → "标记已解决"（仅处理人可见）
   - `resolved` → "关闭工单"（仅处理人可见）
   - `closed` → 无按钮，显示"工单已关闭，无可用操作"
4. 审计日志列表：`timestamp - action by operator: details`
5. "返回列表"链接回到 list

**权限判断**：
当前用户固定为 `user1`，前端通过 `ticket.assignee === 'user1'` 判断是否显示按钮（服务端会再次验证）。

---

## 5. 测试场景

### 场景 1：空表单提交被浏览器验证拒绝

**步骤**：
1. 打开 create 页面
2. 直接点击"提交工单"
3. 浏览器原生 required 验证阻止提交

**验证**：
- `state.tickets.length === 0`

### 场景 2：有效表单提交创建工单并重定向

**步骤**：
1. 填写 title="S2工单", description="描述", priority="high"
2. 点击"提交工单"
3. 等待跳转到 list 页面

**验证**：
- `state.tickets.length === 1`
- `ticket.id === 'T-0001'`
- `ticket.title === 'S2工单'`
- 存在 action=created 的审计日志，operator 和 timestamp 完整

### 场景 3：一级分类变更时二级分类选项级联更新

**步骤**：
1. 打开 create 页面
2. 选择 category1="业务咨询"
3. 验证 category2 自动变为"功能咨询"（业务咨询的第一个子分类）
4. 填写其他字段并提交

**验证**：
- `ticket.category1 === '业务咨询'`
- `ticket.category2 === '功能咨询'`

### 场景 4：状态筛选仅显示符合条件的工单

**步骤**：
1. 通过 API 创建 2 个工单：T1 状态为 processing，T2 状态为 pending
2. 打开 list 页面，验证初始显示 2 行
3. 选择 status="processing"，点击"筛选"
4. 验证表格只显示 1 行

**验证**：
- `document.querySelectorAll("tbody tr").length === 1`

### 场景 5：完整状态流转

**步骤**：
1. 创建工单（状态 pending）
2. 打开 detail，点击"开始处理" → processing
3. 点击"标记已解决" → resolved
4. 点击"关闭工单" → closed
5. 验证显示"工单已关闭，无可用操作"，且无按钮

**验证**：
- 审计日志中的状态变更序列为 `['processing', 'resolved', 'closed']`

### 场景 6：非处理人看不到操作按钮

**步骤**：
1. 通过 repository 直接创建 assignee=user2、status=processing 的工单（模拟他人工单）
2. 以 user1 身份打开 detail
3. 验证无任何操作按钮

**验证**：
- `document.querySelectorAll("button").length === 0`

---

## 6. 实现细节

### 6.1 安全

- HTML 属性值通过 `escapeHtml` 转义（`&"'<>`），防止注入
- 控制 API 需 Bearer token，业务 API 需有效 sessionId
- Host 头验证：请求的 Host 必须匹配服务器的监听地址

### 6.2 隔离

每个 sessionId 对应独立的 SQLite 内存数据库（`node:sqlite`），会话间完全隔离。

### 6.3 依赖

- **零 npm 依赖**：所有模块都是 Node.js 内置（`node:http`, `node:sqlite`, `node:crypto`, `node:fs/promises`）
- **React 本地副本**：`public/vendor/react.production.min.js` 和 `react-dom.production.min.js`，UMD 构建，版本 18.3.1
  - react SHA-256: `d949f1c3687aedadcedac85261865f29b17cd273997e7f6b2bfc53b2f9d4c4dd`
  - react-dom SHA-256: `35f4f974f4b2bcd44da73963347f8952e341f83909e4498227d4e26b98f66f0d`

### 6.4 样式

GitHub Primer 风格：
- 表单：白色卡片，灰色边框，字段上下堆叠
- 按钮：绿色（创建）、蓝色（提交）、灰色边框
- 表格：斑马纹，hover 高亮
- 聚焦样式：蓝色 outline，满足基本可访问性

---

## 7. Oracle 使用

```javascript
import {createController, assertTicketFields, assertStateTransition, assertAuditLogComplete} from './oracle.mjs';

const control = createController(server);
const session = await control.create();
// ... 浏览器操作 ...
const state = await control.state(session.sessionId);
assertTicketFields(state.tickets[0], {title: 'Expected', status: 'pending'});
assertStateTransition(state.auditLogs, ['processing', 'resolved']);
assertAuditLogComplete(state.auditLogs[0]);
```

---

## 8. 已知限制

1. **单用户模拟**：业务 API 固定 operator=user1，无多用户登录
2. **无分页**：列表返回全部工单，不适合大数据集
3. **无并发控制**：状态变更不检查 updated_at，存在覆盖风险
4. **浏览器测试环境依赖**：需要本机安装 Chrome，无 headless 替代方案

---

**最后更新**: 2026-11-03  
**证据**: `specs/002-ticket-system/evidence/t002-ticket-system.json`

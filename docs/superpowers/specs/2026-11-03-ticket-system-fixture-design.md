# Ticket System Fixture 设计文档

**日期**：2026-11-03  
**版本**：v1.0  
**目标**：为 Wisp v0.1 的 T-018 真实站点试用，设计一个本地工单/客服系统 fixture，覆盖框架的核心能力边界并提供严格的 Oracle 验证。

---

## 1. 意图与目标

### 为什么需要这个系统

现有 `fixtures/web` 提供了 3 个基础场景（search/table/form），已验证：
- 基础控件（input/textarea/button）
- 原生 select
- React 18.3.1 受控输入
- 简单列表筛选

但**未覆盖**的真实场景：
- 关联字段（下拉联动）
- 条件显示/隐藏
- 多步状态机流转
- 跨页面操作
- 权限检查
- 严格的审计日志

这个 Ticket System Fixture 填补这些空白，为 T-018 提供**接近生产复杂度**的验收环境。

### 成功标准

1. **Agent 能完成 3 个端到端场景**（创建工单 → 分配 → 关闭）
2. **Oracle 零容忍副作用错误**（字段值/状态流转/审计日志完全匹配）
3. **覆盖 Wisp v0.1 所有支持的控件类型**
4. **触及已知边界但不越界**（不用富文本/文件上传/自定义组件）

---

## 2. 非目标（明确排除）

- ❌ 生产级性能（单会话足够，不需要并发优化）
- ❌ 真实用户认证（测试用 3 个固定用户）
- ❌ 外部依赖（仅 Node 内置模块 + React CDN）
- ❌ 富文本/文件上传/自定义日期选择器
- ❌ 多标签页/iframe/跨域操作

---

## 3. 反目标（做了就算失败）

- 🚫 如果 Agent 能绕过权限检查（非处理人关闭工单）
- 🚫 如果 Oracle 无法检测到状态流转顺序错误
- 🚫 如果审计日志缺失或时间戳不准确
- 🚫 如果控件超出 Wisp v0.1 支持范围（导致框架无法操作）

---

## 4. 技术栈与约束

### 技术选型

| 层次 | 技术 | 理由 |
|------|------|------|
| **前端** | React 18.3.1 (CDN) | 复用 Wisp 已验证的受控输入行为 |
| **后端** | Node.js + node:http | 与 fixtures/web 保持一致 |
| **数据库** | node:sqlite (内存) | Node 22+ 内置，零依赖，会话隔离 |
| **会话管理** | sessionId + generation | 复用 fixtures/web 模式 |
| **样式** | 原生 CSS | 无需框架 |

### 约束

1. **零 npm 依赖**（Express 也不用，直接用 node:http）
2. **仅监听 127.0.0.1**（不暴露外网）
3. **端口自动分配**（避免冲突）
4. **控件限制**：只用原生 HTML 元素（input/textarea/select/button）

---

## 5. 数据模型

### 5.1 数据库 Schema

#### tickets 表
```sql
CREATE TABLE tickets (
  id TEXT PRIMARY KEY,           -- T-0001, T-0002, ...
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category1 TEXT NOT NULL,       -- 一级分类
  category2 TEXT NOT NULL,       -- 二级分类
  priority TEXT NOT NULL,        -- low/medium/high/urgent
  assignee TEXT,                 -- user1/user2/user3
  status TEXT NOT NULL,          -- pending/processing/resolved/closed
  due_date TEXT,                 -- ISO 日期字符串（仅 urgent）
  created_at TEXT NOT NULL,      -- ISO 时间戳
  updated_at TEXT NOT NULL       -- ISO 时间戳
);
```

#### audit_logs 表
```sql
CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id TEXT NOT NULL,
  action TEXT NOT NULL,          -- created/assigned/status_changed/closed
  operator TEXT NOT NULL,        -- user1/user2/user3/system
  details TEXT,                  -- JSON 字符串（如状态变更前后）
  timestamp TEXT NOT NULL,       -- ISO 时间戳
  FOREIGN KEY (ticket_id) REFERENCES tickets(id)
);
```

#### users 表（初始数据）
```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,           -- user1/user2/user3
  name TEXT NOT NULL             -- 张三/李四/王五
);

INSERT INTO users VALUES 
  ('user1', '张三'),
  ('user2', '李四'),
  ('user3', '王五');
```

### 5.2 分类配置（静态数据）

```javascript
const CATEGORIES = {
  '技术问题': ['无法登录', '功能报错', '性能问题', '数据丢失'],
  '业务咨询': ['功能咨询', '价格咨询', '流程咨询', '政策咨询'],
  '功能建议': ['新功能', '界面改进', '流程优化', '其他建议']
};
```

### 5.3 状态机

```
pending → processing → resolved → closed
  ↓          ↓           ↓
 (任何人)  (仅处理人)  (仅处理人)
```

**权限规则**：
- `pending → processing`：任何人可执行（"开始处理" = 自动分配给操作人）
- `processing → resolved`：仅处理人可执行
- `resolved → closed`：仅处理人可执行
- 已关闭工单：所有操作禁用

---

## 6. 场景设计

### 场景 1：创建工单（复杂表单）

**路径**：`/ticket-system/s/{sessionId}/create`

**UI 布局**：
```
┌─────────────────────────────────────┐
│ 创建工单                            │
├─────────────────────────────────────┤
│ 标题 *                              │
│ [___________________________]       │
│                                     │
│ 描述 *                              │
│ [___________________________]       │
│ [___________________________]       │
│ [___________________________]       │
│                                     │
│ 一级分类 * [技术问题 ▼]              │
│ 二级分类 * [无法登录 ▼]              │  ← 根据一级分类动态更新
│                                     │
│ 优先级 * [高 ▼]                     │
│                                     │
│ [条件显示：仅 urgent 时]             │
│ 预计解决时间 [📅 2026-11-04]        │  ← <input type="date">
│                                     │
│ 处理人 [李四 ▼]                     │
│                                     │
│ [取消]  [提交工单]                  │
└─────────────────────────────────────┘
```

**交互流程**：
1. Agent 填写标题（input）
2. Agent 填写描述（textarea）
3. Agent 选择一级分类（select）→ **二级分类选项动态更新**
4. Agent 选择二级分类（select）
5. Agent 选择优先级（select）→ **如果选 urgent，显示日期字段**
6. Agent（可选）选择处理人（select，默认为空）
7. Agent 点击"提交工单"→ 跳转到列表页

**Oracle 验证**：
```javascript
const ticket = await oracle.getTicketById(sessionId, ticketId);
assert.strictEqual(ticket.title, '预期标题');
assert.strictEqual(ticket.description, '预期描述');
assert.strictEqual(ticket.category1, '技术问题');
assert.strictEqual(ticket.category2, '无法登录');
assert.strictEqual(ticket.priority, 'high');
assert.strictEqual(ticket.status, 'pending');
assert.strictEqual(ticket.assignee, 'user2'); // 如果选了李四

const logs = await oracle.getAuditLogs(sessionId, ticketId);
assert.strictEqual(logs[0].action, 'created');
assert.strictEqual(logs[0].operator, 'user1'); // 假设创建者是张三
assert.ok(Date.parse(logs[0].timestamp)); // 时间戳有效
```

---

### 场景 2：工单列表与分配（列表筛选 + 状态流转）

**路径**：`/ticket-system/s/{sessionId}/list`

**UI 布局**：
```
┌─────────────────────────────────────────────────────────────────┐
│ 工单列表                          [+ 创建工单]                   │
├─────────────────────────────────────────────────────────────────┤
│ 筛选：状态 [全部 ▼]  优先级 [全部 ▼]  [筛选]                     │
├─────┬──────────┬────────┬────────┬────────┬──────────┬────────┤
│ ID  │ 标题     │ 分类   │ 优先级 │ 状态   │ 处理人   │ 操作   │
├─────┼──────────┼────────┼────────┼────────┼──────────┼────────┤
│T-001│无法登录  │技术问题│ 高     │待处理  │ -        │[查看]  │
│T-002│价格咨询  │业务咨询│ 中     │处理中  │ 李四     │[查看]  │
│T-003│新功能建议│功能建议│ 低     │已解决  │ 张三     │[查看]  │
└─────┴──────────┴────────┴────────┴────────┴──────────┴────────┘
```

**交互流程**：
1. Agent 选择筛选条件（status=pending, priority=high）
2. Agent 点击"筛选"按钮
3. 列表刷新，显示符合条件的工单
4. Agent 点击某个工单的"查看"按钮 → 进入详情页

**Oracle 验证**：
```javascript
const tickets = await oracle.getTickets(sessionId, {status: 'pending', priority: 'high'});
assert.strictEqual(tickets.length, 预期数量);
assert.ok(tickets.every(t => t.status === 'pending' && t.priority === 'high'));
```

---

### 场景 3：工单详情与关闭（权限 + 状态机）

**路径**：`/ticket-system/s/{sessionId}/detail/{ticketId}`

**UI 布局**（以 processing 状态为例）：
```
┌─────────────────────────────────────┐
│ 工单详情 - T-001                    │
├─────────────────────────────────────┤
│ 标题：无法登录                       │
│ 描述：登录时提示密码错误...          │
│ 一级分类：技术问题                   │
│ 二级分类：无法登录                   │
│ 优先级：高                          │
│ 状态：处理中                        │
│ 处理人：李四                        │
│ 创建时间：2026-11-03 10:30:00       │
│ 更新时间：2026-11-03 11:15:00       │
├─────────────────────────────────────┤
│ 审计日志                            │
│ • 2026-11-03 10:30:00 张三 创建工单 │
│ • 2026-11-03 11:15:00 李四 开始处理 │
├─────────────────────────────────────┤
│ [返回列表]  [标记已解决]            │  ← 仅处理人可见
└─────────────────────────────────────┘
```

**交互流程**：
1. Agent 在详情页查看工单信息
2. Agent 点击"标记已解决"按钮（状态：processing → resolved）
3. 页面刷新，按钮变为"关闭工单"
4. Agent 点击"关闭工单"（状态：resolved → closed）
5. 页面刷新，所有操作按钮禁用

**权限检查**（前端 + 后端双重验证）：
- 前端：非处理人看不到操作按钮
- 后端：API 拒绝非处理人的请求（返回 403）

**Oracle 验证**：
```javascript
// 验证状态流转
const ticket = await oracle.getTicketById(sessionId, ticketId);
assert.strictEqual(ticket.status, 'closed');

// 验证审计日志完整性
const logs = await oracle.getAuditLogs(sessionId, ticketId);
assert.strictEqual(logs.length, 4); // created, assigned, resolved, closed
assert.strictEqual(logs[2].action, 'status_changed');
assert.strictEqual(logs[2].details, JSON.stringify({from: 'processing', to: 'resolved'}));
assert.strictEqual(logs[2].operator, 'user2'); // 李四

// 验证权限（模拟非处理人尝试关闭）
await assert.rejects(
  () => oracle.closeTicket(sessionId, ticketId, 'user1'), // 张三不是处理人
  { status: 403, message: 'Only assignee can close ticket' }
);
```

---

## 7. API 接口定义

### 7.1 业务 API（Agent 调用）

| 方法 | 路径 | 说明 | 请求体 | 响应 |
|------|------|------|--------|------|
| POST | `/api/{sessionId}/tickets` | 创建工单 | `{title, description, category1, category2, priority, assignee?, due_date?}` | `{ticket: {...}}` |
| GET | `/api/{sessionId}/tickets` | 列表筛选 | Query: `status`, `priority` | `{tickets: [...]}` |
| GET | `/api/{sessionId}/tickets/:id` | 工单详情 | - | `{ticket: {...}}` |
| PATCH | `/api/{sessionId}/tickets/:id/assign` | 分配处理人 | `{assignee, operator}` | `{ticket: {...}}` |
| PATCH | `/api/{sessionId}/tickets/:id/status` | 状态流转 | `{status, operator}` | `{ticket: {...}}` |
| GET | `/api/{sessionId}/tickets/:id/audit-logs` | 审计日志 | - | `{logs: [...]}` |
| GET | `/api/{sessionId}/categories` | 分类配置 | - | `{categories: {...}}` |
| GET | `/api/{sessionId}/users` | 用户列表 | - | `{users: [...]}` |

### 7.2 控制 API（Oracle + 测试）

| 方法 | 路径 | 说明 | 请求头 |
|------|------|------|--------|
| POST | `/control/sessions` | 创建会话 | `Authorization: Bearer {token}` |
| GET | `/control/sessions/:id/state` | 获取状态（Oracle） | 同上 |
| POST | `/control/sessions/:id/reset` | 重置会话 | 同上 |
| DELETE | `/control/sessions/:id` | 删除会话 | 同上 |

**Oracle 响应示例**：
```json
{
  "sessionId": "abc-123",
  "generation": 1,
  "tickets": [
    {
      "id": "T-0001",
      "title": "无法登录",
      "status": "closed",
      "assignee": "user2",
      "created_at": "2026-11-03T10:30:00.000Z",
      "updated_at": "2026-11-03T11:45:00.000Z"
    }
  ],
  "auditLogs": [
    {
      "ticket_id": "T-0001",
      "action": "created",
      "operator": "user1",
      "timestamp": "2026-11-03T10:30:00.000Z"
    },
    {
      "ticket_id": "T-0001",
      "action": "status_changed",
      "operator": "user2",
      "details": "{\"from\":\"pending\",\"to\":\"processing\"}",
      "timestamp": "2026-11-03T11:15:00.000Z"
    },
    {
      "ticket_id": "T-0001",
      "action": "status_changed",
      "operator": "user2",
      "details": "{\"from\":\"processing\",\"to\":\"resolved\"}",
      "timestamp": "2026-11-03T11:30:00.000Z"
    },
    {
      "ticket_id": "T-0001",
      "action": "status_changed",
      "operator": "user2",
      "details": "{\"from\":\"resolved\",\"to\":\"closed\"}",
      "timestamp": "2026-11-03T11:45:00.000Z"
    }
  ]
}
```

---

## 8. 实现方案对比

### 方案 A：单体应用（推荐）

**描述**：所有逻辑在一个 Node.js 进程中，每个会话一个独立的 SQLite 内存数据库。

**优点**：
- 实现简单，与 `fixtures/web` 架构一致
- 会话隔离天然支持（内存数据库）
- 无需跨进程通信

**缺点**：
- 会话过多时内存占用较高（T-018 只需 1-2 个会话，可接受）

---

### 方案 B：共享 SQLite 文件 + 表前缀隔离

**描述**：所有会话共享一个 SQLite 文件，表名加 sessionId 前缀。

**优点**：
- 内存占用更低

**缺点**：
- 会话重置需要 DROP TABLE（更复杂）
- 会话隔离依赖表名约定（容易出错）
- 不如方案 A 直观

---

### 选择：方案 A

**理由**：
1. T-018 是**验收测试**，不是**压力测试**，1-2 个会话足够
2. 方案 A 与 `fixtures/web` 的架构一致，复用经验
3. 内存数据库天然隔离，重置直接关闭连接即可

---

## 9. 文件结构

```
fixtures/ticket-system/
├── README.md               # 启动、验证、Oracle 使用
├── start.mjs              # 入口：node fixtures/ticket-system/start.mjs
├── server.mjs             # HTTP 服务器 + 路由
├── domain.mjs             # 业务逻辑 + SQLite 操作
├── oracle.mjs             # Oracle API + 断言工具
├── pages.mjs              # HTML 模板生成
├── public/
│   ├── app.mjs            # React 前端（3 个场景组件）
│   └── style.css          # 样式
└── test/
    ├── server.test.mjs    # HTTP 集成测试
    └── agent-smoke.mjs    # 真实 Agent 端到端验收
```

---

## 10. 与 Wisp 的集成方式

### 10.1 启动 Fixture

```powershell
node fixtures/ticket-system/start.mjs
```

输出：
```
Ticket System Fixture v1.0
Origin: http://127.0.0.1:52345
Control origin: http://127.0.0.1:52346
Control token: abc123...
Initial session: http://127.0.0.1:52345/ticket-system/s/session-uuid/list
```

### 10.2 配置 Wisp 扩展

1. 打开 `http://127.0.0.1:52345/ticket-system/s/session-uuid/create`
2. 授权 origin：`http://127.0.0.1:52345`
3. 配置模型（火山方舟）：
   - 端点：`https://ark.cn-beijing.volces.com/api/v3/chat/completions`
   - 模型：`deepseek-v4-1-flash-economy-261017`
   - 密钥：你的 API Key

### 10.3 运行端到端场景

**场景 1：创建工单**
```
目标：创建一个技术问题工单，标题"无法登录"，描述"登录时提示密码错误"，
     一级分类"技术问题"，二级分类"无法登录"，优先级"高"，处理人"李四"
```

**场景 2：分配并流转**
```
目标：在工单列表中筛选出状态为"待处理"、优先级为"高"的工单，
     选择第一个进入详情，点击"开始处理"按钮
```

**场景 3：关闭工单**
```
目标：在工单详情页，依次点击"标记已解决"和"关闭工单"按钮，
     确认最终状态为"已关闭"，且所有按钮禁用
```

### 10.4 Oracle 验证

```javascript
import {createFixtureServer} from './fixtures/ticket-system/server.mjs';
import {createController} from './fixtures/ticket-system/oracle.mjs';

const server = await createFixtureServer();
const control = createController(server);
const session = await control.create();

// Agent 执行完场景 1
const state1 = await control.state(session.sessionId);
assert.strictEqual(state1.tickets.length, 1);
assert.strictEqual(state1.tickets[0].title, '无法登录');
assert.strictEqual(state1.auditLogs.length, 1);

// Agent 执行完场景 3
const state3 = await control.state(session.sessionId);
assert.strictEqual(state3.tickets[0].status, 'closed');
assert.strictEqual(state3.auditLogs.length, 4); // created, assigned, resolved, closed

await server.close();
```

---

## 11. 验收标准

### 11.1 功能完整性

- [ ] 3 个场景的页面能正常渲染
- [ ] 关联下拉（一级分类 → 二级分类）正常联动
- [ ] 条件显示（优先级=urgent → 日期字段）正常工作
- [ ] 状态流转按钮根据状态和权限正确显示/禁用
- [ ] 审计日志完整记录每次操作

### 11.2 Wisp Agent 能力验证

- [ ] Agent 能填写复杂表单（含关联下拉、条件显示）
- [ ] Agent 能正确使用 selectOption 动作
- [ ] Agent 能识别禁用按钮（不尝试点击）
- [ ] Agent 能完成跨页面流程（创建 → 列表 → 详情 → 关闭）
- [ ] Agent 的 finish 决策包含正确的 expected 条件（URL + 文本）

### 11.3 Oracle 严格性

- [ ] 字段值完全匹配（无多余/缺失字段）
- [ ] 状态流转顺序正确（无跳跃）
- [ ] 权限检查生效（非处理人操作被拒绝）
- [ ] 审计日志完整（操作类型/操作人/时间戳/详情）
- [ ] 时间戳精度到毫秒

---

## 12. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| React CDN 加载失败 | 页面无法渲染 | 使用稳定 CDN（unpkg.com），添加加载超时检测 |
| 状态机复杂度过高 | Agent 无法理解流转规则 | 在页面上显示"当前可执行操作"提示 |
| 审计日志过多 | Oracle 验证变慢 | 限制单会话最多 100 条日志 |
| 日期选择器不可操作 | Agent 无法填写 due_date | 使用原生 `<input type="date">`（Wisp 应该支持） |

---

## 13. 后续扩展（v2.0 可选）

如果 T-018 验收通过，可以在 v2.0 中加入：

- 工单评论功能（测试 textarea 追加）
- 批量操作（测试 checkbox 多选）
- 导出 CSV（测试文件下载，需确认 Wisp 是否支持）
- WebSocket 实时通知（测试异步 DOM 更新）

---

**设计完成。请确认以上设计是否符合预期，确认后我将进入实现阶段。**

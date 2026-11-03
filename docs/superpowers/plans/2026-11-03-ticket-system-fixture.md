# Ticket System Fixture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local ticket/customer service system fixture for Wisp v0.1 T-018 validation, covering complex controls (cascading selects, conditional rendering), state machine workflows, permission checks, and strict Oracle verification.

**Architecture:** Single Node.js process with per-session in-memory SQLite databases. React 18.3.1 frontend (vendored, no JSX) with controlled inputs. HTTP server handles both business API (agent calls) and control API (Oracle). Three scenarios: create ticket (complex form), list/filter (table filtering), detail/close (state machine + permissions).

**Tech Stack:** Node.js (node:http, node:sqlite, node:crypto), React 18.3.1 (vendored local files), native HTML controls only.

**Spec:** `docs/superpowers/specs/2026-11-03-ticket-system-fixture-design.md`

## Global Constraints

- Zero npm dependencies (no Express, use node:http)
- Listen on 127.0.0.1 only, auto-assign ports
- Native HTML elements only (input/textarea/select/button)
- React 18.3.1 vendored in public/ (no CDN, no JSX, no build step)
- SQLite in-memory databases, one per session
- Session isolation via sessionId + generation (fixtures/web pattern)
- Control token auth for Oracle API
- ISO 8601 timestamps with millisecond precision
- Current user fixed as 'user1' (张三) for all operations

## Review Focus

1. **Non-assignee closing ticket:** Backend PATCH /tickets/:id/status must reject with 403 when currentUser !== ticket.assignee for resolved→closed transition.
2. **State machine jump:** Backend must reject pending→resolved or processing→closed with 400 "Invalid state transition".
3. **Cascading select desync:** When category1 changes, frontend must set category2 to first option of new category1's subcategories before render.
4. **Audit log missing operator:** Every audit_logs INSERT must include non-null operator from currentUser context, not from request body.
5. **Conditional date field state leak:** When priority changes from 'urgent' to other, React must clear due_date state so it doesn't persist.

---

### Task 1: Domain Logic and SQLite Repository

**Files:**
- Create: `fixtures/ticket-system/domain.mjs`

**Interfaces:**
- Consumes: node:sqlite, node:crypto
- Produces:
  - `FIXTURE_VERSION: string` = 'ticket-system-0.1'
  - `CATEGORIES: {[category1: string]: string[]}` = spec section 5.2
  - `USERS: Array<{id: string, name: string}>` = [{id:'user1',name:'张三'},{id:'user2',name:'李四'},{id:'user3',name:'王五'}]
  - `FixtureError: class extends Error {constructor(status: number, message: string)}`
  - `createRepository(): Repository`
    - `Repository.createSession(): {sessionId: string, generation: number}`
    - `Repository.getState(sessionId: string): {tickets: Ticket[], auditLogs: AuditLog[]}`
    - `Repository.reset(sessionId: string): {generation: number}`
    - `Repository.close(sessionId: string): void`
    - `Repository.createTicket(sessionId, data, currentUser): Ticket`
    - `Repository.getTickets(sessionId, filter): Ticket[]`
    - `Repository.getTicketById(sessionId, ticketId): Ticket | null`
    - `Repository.changeStatus(sessionId, ticketId, newStatus, currentUser): Ticket`
    - `Repository.getAuditLogs(sessionId, ticketId): AuditLog[]`

- [ ] **Step 1: Write test for constants**

```javascript
// fixtures/ticket-system/test/domain.test.mjs
import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {CATEGORIES, USERS, FIXTURE_VERSION} from '../domain.mjs';

describe('Domain Constants', () => {
  it('CATEGORIES has 3 category1 entries', () => {
    assert.deepStrictEqual(Object.keys(CATEGORIES).sort(), ['业务咨询', '功能建议', '技术问题']);
    assert.strictEqual(CATEGORIES['技术问题'].length, 4);
  });

  it('USERS has 3 users', () => {
    assert.strictEqual(USERS.length, 3);
    assert.deepStrictEqual(USERS[0], {id: 'user1', name: '张三'});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test fixtures/ticket-system/test/domain.test.mjs`
Expected: FAIL with "Cannot find module '../domain.mjs'"

- [ ] **Step 3: Implement constants and FixtureError**

Export FIXTURE_VERSION, CATEGORIES (spec section 5.2), USERS array. FixtureError extends Error with status property.

- [ ] **Step 4: Run test to verify it passes**

Expected: PASS

- [ ] **Step 5: Write test for session lifecycle**

```javascript
import {createRepository} from '../domain.mjs';

describe('Repository Session', () => {
  it('createSession returns sessionId and generation=1', () => {
    const repo = createRepository();
    const session = repo.createSession();
    assert.ok(session.sessionId);
    assert.strictEqual(session.generation, 1);
  });

  it('reset increments generation and clears state', () => {
    const repo = createRepository();
    const {sessionId} = repo.createSession();
    repo.createTicket(sessionId, {
      title: 'T', description: 'D', category1: '技术问题', category2: '无法登录', priority: 'high'
    }, 'user1');
    const {generation} = repo.reset(sessionId);
    assert.strictEqual(generation, 2);
    assert.strictEqual(repo.getState(sessionId).tickets.length, 0);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Expected: FAIL with "createRepository is not a function"

- [ ] **Step 7: Implement createRepository with session management**

Use Map to store sessions. Each session: {db: DatabaseSync (in-memory), generation: number}. db.exec() creates tables from spec 5.1, inserts USERS. createSession generates UUID, returns {sessionId, generation: 1}. getState SELECTs tickets and audit_logs. reset closes db, recreates, increments generation.

- [ ] **Step 8: Run test to verify it passes**

Expected: PASS

- [ ] **Step 9: Write test for createTicket with audit log (Review Focus #4)**

```javascript
describe('createTicket', () => {
  it('inserts ticket with auto-generated id and audit log', () => {
    const repo = createRepository();
    const {sessionId} = repo.createSession();
    const ticket = repo.createTicket(sessionId, {
      title: '无法登录', description: 'Desc', category1: '技术问题', category2: '无法登录', priority: 'high', assignee: 'user2'
    }, 'user1');
    assert.ok(ticket.id.startsWith('T-'));
    assert.strictEqual(ticket.status, 'pending');
    const logs = repo.getAuditLogs(sessionId, ticket.id);
    assert.strictEqual(logs[0].action, 'created');
    assert.strictEqual(logs[0].operator, 'user1'); // from currentUser parameter
  });
});
```

- [ ] **Step 10: Run test to verify it fails**

Expected: FAIL with "createTicket is not a function"

- [ ] **Step 11: Implement createTicket**

Generate id as 'T-' + zero-padded 4-digit counter. INSERT into tickets with status='pending', created_at=updated_at=new Date().toISOString(). INSERT into audit_logs with action='created', operator=currentUser parameter, timestamp=created_at. Return ticket object.

- [ ] **Step 12: Run test to verify it passes**

Expected: PASS

- [ ] **Step 13: Write test for state machine validation (Review Focus #2)**

```javascript
it('rejects invalid state transitions', () => {
  const repo = createRepository();
  const {sessionId} = repo.createSession();
  const ticket = repo.createTicket(sessionId, {title: 'T', description: 'D', category1: '技术问题', category2: '无法登录', priority: 'low'}, 'user1');
  assert.throws(() => repo.changeStatus(sessionId, ticket.id, 'resolved', 'user1'), {message: /Invalid state transition/});
});
```

- [ ] **Step 14: Implement changeStatus with state machine**

Validate transitions: pending→processing, processing→resolved, resolved→closed only. Throw FixtureError(400, 'Invalid state transition from X to Y') otherwise. UPDATE tickets, INSERT audit_logs action='status_changed', details=JSON.stringify({from, to}).

- [ ] **Step 15: Run test to verify it passes**

Expected: PASS

- [ ] **Step 16: Write test for permission check (Review Focus #1)**

```javascript
it('rejects non-assignee closing ticket', () => {
  const repo = createRepository();
  const {sessionId} = repo.createSession();
  const ticket = repo.createTicket(sessionId, {title: 'T', description: 'D', category1: '技术问题', category2: '无法登录', priority: 'low', assignee: 'user2'}, 'user1');
  repo.changeStatus(sessionId, ticket.id, 'processing', 'user2');
  repo.changeStatus(sessionId, ticket.id, 'resolved', 'user2');
  assert.throws(() => repo.changeStatus(sessionId, ticket.id, 'closed', 'user1'), {status: 403, message: /Only assignee/});
});
```

- [ ] **Step 17: Implement permission check in changeStatus**

For transitions from processing or resolved: SELECT assignee FROM tickets WHERE id=?. If currentUser !== assignee, throw FixtureError(403, 'Only assignee can perform this action').

- [ ] **Step 18: Run test to verify it passes**

Expected: PASS

- [ ] **Step 19: Implement getTickets, getTicketById, getAuditLogs**

getTickets: SELECT with WHERE clauses for status/priority filters (use 'all' for no filter). getTicketById: SELECT WHERE id=? LIMIT 1. getAuditLogs: SELECT WHERE ticket_id=? ORDER BY timestamp.

- [ ] **Step 20: Commit Task 1**

```bash
git add fixtures/ticket-system/domain.mjs fixtures/ticket-system/test/domain.test.mjs
git commit -m "feat(ticket-system): 实现 domain 逻辑和 SQLite repository

- 会话生命周期管理（创建/重置/关闭）
- 工单 CRUD 与状态机验证
- 权限检查：仅处理人可关闭工单
- 审计日志记录所有变更
- 测试覆盖：常量、生命周期、状态机、权限

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: HTTP Server and Routing

**Files:**
- Create: `fixtures/ticket-system/server.mjs`

**Interfaces:**
- Consumes: domain.mjs (createRepository, FixtureError, CATEGORIES, USERS)
- Produces:
  - `createFixtureServer(): Promise<FixtureServer>`
    - `origin: string`, `controlOrigin: string`, `controlToken: string`
    - `initialSession: {baseUrl: string, sessionId: string}`
    - `close(): Promise<void>`

- [ ] **Step 1: Write test for server startup**

```javascript
// fixtures/ticket-system/test/server.test.mjs
import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {createFixtureServer} from '../server.mjs';

describe('Server Lifecycle', () => {
  it('starts on 127.0.0.1 with auto ports', async () => {
    const server = await createFixtureServer();
    assert.ok(server.origin.startsWith('http://127.0.0.1:'));
    assert.ok(server.controlToken.length > 32);
    await server.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test fixtures/ticket-system/test/server.test.mjs`
Expected: FAIL with "Cannot find module '../server.mjs'"

- [ ] **Step 3: Implement createFixtureServer**

Create two http servers (app, control). Listen on 127.0.0.1:0. Generate controlToken with randomBytes(32).hex(). Create repository, call createSession(). Return {origin, controlOrigin, controlToken, initialSession: {baseUrl: `${origin}/ticket-system/s/${sessionId}/list`, sessionId}, close()}.

- [ ] **Step 4: Run test to verify it passes**

Expected: PASS

- [ ] **Step 5: Write test for control API with auth**

```javascript
describe('Control API', () => {
  it('POST /control/sessions creates session', async () => {
    const server = await createFixtureServer();
    const res = await fetch(`${server.controlOrigin}/control/sessions`, {
      method: 'POST',
      headers: {'Authorization': `Bearer ${server.controlToken}`, 'Content-Type': 'application/json'},
      body: '{}'
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(data.sessionId);
    await server.close();
  });

  it('rejects invalid token', async () => {
    const server = await createFixtureServer();
    const res = await fetch(`${server.controlOrigin}/control/sessions`, {
      method: 'POST',
      headers: {'Authorization': 'Bearer wrong'}
    });
    assert.strictEqual(res.status, 403);
    await server.close();
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Expected: FAIL with 404 (route not implemented)

- [ ] **Step 7: Implement control server routing**

Parse Authorization header, extract token, compare with timingSafeEqual. Handle POST /control/sessions (repository.createSession), GET /control/sessions/:id/state (repository.getState), POST /control/sessions/:id/reset (repository.reset). Return 403 if token invalid.

- [ ] **Step 8: Run test to verify it passes**

Expected: PASS

- [ ] **Step 9: Write test for business API**

```javascript
describe('Business API', () => {
  it('POST /api/:sessionId/tickets creates ticket', async () => {
    const server = await createFixtureServer();
    const {sessionId} = server.initialSession;
    const res = await fetch(`${server.origin}/api/${sessionId}/tickets`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({title: 'T', description: 'D', category1: '技术问题', category2: '无法登录', priority: 'high'})
    });
    const data = await res.json();
    assert.ok(data.ticket.id.startsWith('T-'));
    await server.close();
  });
});
```

- [ ] **Step 10: Run test to verify it fails**

Expected: FAIL with 404

- [ ] **Step 11: Implement business API routing**

App server handles (operator is the fixed constant 'user1' on the server, never read from the request body, per Review Focus #4):
- POST /api/:sessionId/tickets → repository.createTicket(sessionId, body, 'user1')
- GET /api/:sessionId/tickets?status=&priority= → repository.getTickets
- GET /api/:sessionId/tickets/:id → repository.getTicketById
- PATCH /api/:sessionId/tickets/:id/status → repository.changeStatus(sessionId, id, body.status, 'user1')
- GET /api/:sessionId/tickets/:id/audit-logs → repository.getAuditLogs
- GET /api/:sessionId/categories, GET /api/:sessionId/users

Reject request bodies containing an `operator` field with 400. Convert FixtureError to `{error: message}` with error.status; other errors become 500.

- [ ] **Step 12: Run test to verify it passes**

Expected: PASS

- [ ] **Step 13: Write test that operator cannot be forged**

```javascript
it('rejects operator field in request body', async () => {
  const server = await createFixtureServer();
  const {sessionId} = server.initialSession;
  const res = await fetch(`${server.origin}/api/${sessionId}/tickets`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({title: 'T', description: 'D', category1: '技术问题', category2: '无法登录', priority: 'high', operator: 'user2'})
  });
  assert.strictEqual(res.status, 400);
  await server.close();
});
```

- [ ] **Step 14: Run test to verify it passes**

Expected: PASS

- [ ] **Step 15: Commit Task 2**

```bash
git add fixtures/ticket-system/server.mjs fixtures/ticket-system/test/server.test.mjs
git commit -m "feat(ticket-system): 实现 HTTP 服务与业务/控制 API

- 业务 API：工单增删改查、审计日志、分类、用户
- 控制 API：会话生命周期，token 鉴权
- 操作人由服务端固定为 user1，拒绝请求体伪造 operator

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Vendored React and Page Shell

**Files:**
- Create: `fixtures/ticket-system/public/vendor/react.production.min.js`
- Create: `fixtures/ticket-system/public/vendor/react-dom.production.min.js`
- Create: `fixtures/ticket-system/pages.mjs`
- Modify: `fixtures/ticket-system/server.mjs`

**Interfaces:**
- Produces: `renderPage(sessionId: string, route: string, origin: string): string`

- [ ] **Step 1: Obtain React 18.3.1 UMD files**

Run: `npm pack react@18.3.1 react-dom@18.3.1 --pack-destination %TEMP%` in a directory outside the repo, extract `umd/react.production.min.js` and `umd/react-dom.production.min.js` into `public/vendor/`. Do not add react to package.json. Record SHA-256 of both files in README.

- [ ] **Step 2: Write test for page shell**

```javascript
// fixtures/ticket-system/test/pages.test.mjs
import {renderPage} from '../pages.mjs';
it('references local vendored scripts only', () => {
  const html = renderPage('sid', 'create', 'http://127.0.0.1:1');
  assert.ok(html.includes('/assets/vendor/react.production.min.js'));
  assert.ok(!html.includes('unpkg.com'));
  assert.ok(html.includes('data-route="create"'));
});
```

- [ ] **Step 3: Run test to verify it fails, then implement renderPage**

Return HTML with charset utf-8, local vendor scripts, `/assets/style.css`, `/assets/app.js` (classic script, not module, so UMD globals work), and `<div id="root" data-session-id data-route data-origin>`. Route `home` renders navigation links server-side.

- [ ] **Step 4: Serve assets and pages from server.mjs**

Serve `/assets/*` from `public/` using an allowlist Map (as fixtures/web does, no path joining). Serve `/ticket-system/s/:sessionId/(home|create|list|detail/:ticketId)` as text/html.

- [ ] **Step 5: Run tests, then commit**

Run: `node --test fixtures/ticket-system/test/*.test.mjs`
Expected: PASS

```bash
git add fixtures/ticket-system/public/vendor/*.js fixtures/ticket-system/pages.mjs fixtures/ticket-system/test/pages.test.mjs fixtures/ticket-system/server.mjs
git commit -m "feat(ticket-system): vendor React 18.3.1 本地副本并实现页面模板

- React UMD 文件本地化，无 CDN 依赖
- renderPage 生成 HTML shell，数据通过 data 属性传递
- 静态资产白名单路由

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: React Frontend - CreateTicket Form

**Files:**
- Create: `fixtures/ticket-system/public/app.js`

**Interfaces:**
- Consumes: React global, DOM data attributes, business API
- Produces: CreateTicket component (no JSX, use React.createElement)

- [ ] **Step 1: Implement app.js with React mount**

```javascript
// fixtures/ticket-system/public/app.js
(function() {
  const e = React.createElement;
  const {useState, useEffect} = React;

  const root = document.getElementById('root');
  const sessionId = root.dataset.sessionId;
  const route = root.dataset.route;
  const origin = root.dataset.origin;

  function App() {
    if (route === 'create') return CreateTicket({sessionId, origin});
    if (route === 'list') return TicketList({sessionId, origin});
    if (route === 'detail') return TicketDetail({sessionId, origin});
    return e('div', null, 'Unknown route');
  }

  ReactDOM.render(e(App), root);
})();
```

- [ ] **Step 2: Implement CreateTicket component with controlled inputs**

```javascript
function CreateTicket({sessionId, origin}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category1, setCategory1] = useState('');
  const [category2, setCategory2] = useState('');
  const [priority, setPriority] = useState('');
  const [assignee, setAssignee] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [categories, setCategories] = useState({});
  const [users, setUsers] = useState([]);

  useEffect(() => {
    fetch(`${origin}/api/${sessionId}/categories`)
      .then(r => r.json())
      .then(d => {
        setCategories(d.categories);
        const first = Object.keys(d.categories)[0];
        setCategory1(first);
        setCategory2(d.categories[first][0]);
      });
    fetch(`${origin}/api/${sessionId}/users`)
      .then(r => r.json())
      .then(d => setUsers(d.users));
  }, []);

  // Review Focus #3: Reset category2 when category1 changes
  const handleCategory1Change = (ev) => {
    const newCat1 = ev.target.value;
    setCategory1(newCat1);
    setCategory2(categories[newCat1][0]);
  };

  // Review Focus #5: Clear dueDate when priority changes from urgent
  const handlePriorityChange = (ev) => {
    const newPriority = ev.target.value;
    if (priority === 'urgent' && newPriority !== 'urgent') {
      setDueDate('');
    }
    setPriority(newPriority);
  };

  const handleSubmit = async (ev) => {
    ev.preventDefault();
    await fetch(`${origin}/api/${sessionId}/tickets`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({title, description, category1, category2, priority, assignee: assignee || null, due_date: dueDate || null})
    });
    window.location.href = `${origin}/ticket-system/s/${sessionId}/list`;
  };

  return e('form', {onSubmit: handleSubmit},
    e('h1', null, '创建工单'),
    e('label', null, '标题 *', e('input', {name: 'title', value: title, onChange: ev => setTitle(ev.target.value), required: true})),
    e('label', null, '描述 *', e('textarea', {name: 'description', value: description, onChange: ev => setDescription(ev.target.value), required: true})),
    e('label', null, '一级分类 *', e('select', {name: 'category1', value: category1, onChange: handleCategory1Change},
      Object.keys(categories).map(c => e('option', {key: c, value: c}, c)))),
    e('label', null, '二级分类 *', e('select', {name: 'category2', value: category2, onChange: ev => setCategory2(ev.target.value)},
      (categories[category1] || []).map(c => e('option', {key: c, value: c}, c)))),
    e('label', null, '优先级 *', e('select', {name: 'priority', value: priority, onChange: handlePriorityChange, required: true},
      e('option', {value: ''}, '请选择'),
      e('option', {value: 'low'}, '低'),
      e('option', {value: 'medium'}, '中'),
      e('option', {value: 'high'}, '高'),
      e('option', {value: 'urgent'}, '紧急'))),
    priority === 'urgent' && e('label', null, '预计解决时间', e('input', {type: 'date', name: 'due_date', value: dueDate, onChange: ev => setDueDate(ev.target.value)})),
    e('label', null, '处理人', e('select', {name: 'assignee', value: assignee, onChange: ev => setAssignee(ev.target.value)},
      e('option', {value: ''}, '未分配'),
      users.map(u => e('option', {key: u.id, value: u.id}, u.name)))),
    e('button', {type: 'submit'}, '提交工单')
  );
}
```

- [ ] **Step 3: Write browser smoke test for form rendering**

Create `fixtures/ticket-system/test/browser-smoke.mjs` similar to fixtures/web pattern. Use CDP to navigate to /create, assert form fields exist.

- [ ] **Step 4: Run browser smoke test**

Run: `node fixtures/ticket-system/test/browser-smoke.mjs`
Expected: PASS (form renders)

- [ ] **Step 5: Commit Task 4**

```bash
git add fixtures/ticket-system/public/app.js fixtures/ticket-system/test/browser-smoke.mjs
git commit -m "feat(ticket-system): 实现 CreateTicket 表单组件（无 JSX）

- React.createElement 编写所有组件
- 级联下拉：category1 变化时重置 category2
- 条件渲染：priority=urgent 显示日期字段
- priority 切换时清空 dueDate 避免状态泄漏

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: React Frontend - List and Detail

**Files:**
- Modify: `fixtures/ticket-system/public/app.js`

**Interfaces:**
- Consumes: CreateTicket from Task 4
- Produces: TicketList and TicketDetail components

- [ ] **Step 1: Implement TicketList component**

```javascript
function TicketList({sessionId, origin}) {
  const [tickets, setTickets] = useState([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');

  const loadTickets = () => {
    fetch(`${origin}/api/${sessionId}/tickets?status=${statusFilter}&priority=${priorityFilter}`)
      .then(r => r.json())
      .then(d => setTickets(d.tickets));
  };

  useEffect(() => { loadTickets(); }, []);

  return e('div', null,
    e('h1', null, '工单列表'),
    e('a', {href: `${origin}/ticket-system/s/${sessionId}/create`}, '+ 创建工单'),
    e('div', null,
      e('label', null, '状态', e('select', {value: statusFilter, onChange: ev => setStatusFilter(ev.target.value)},
        e('option', {value: 'all'}, '全部'),
        e('option', {value: 'pending'}, '待处理'),
        e('option', {value: 'processing'}, '处理中'),
        e('option', {value: 'resolved'}, '已解决'),
        e('option', {value: 'closed'}, '已关闭'))),
      e('label', null, '优先级', e('select', {value: priorityFilter, onChange: ev => setPriorityFilter(ev.target.value)},
        e('option', {value: 'all'}, '全部'),
        e('option', {value: 'low'}, '低'),
        e('option', {value: 'medium'}, '中'),
        e('option', {value: 'high'}, '高'),
        e('option', {value: 'urgent'}, '紧急'))),
      e('button', {onClick: loadTickets}, '筛选')),
    e('table', null,
      e('thead', null, e('tr', null,
        e('th', null, 'ID'), e('th', null, '标题'), e('th', null, '分类'), e('th', null, '优先级'), e('th', null, '状态'), e('th', null, '处理人'), e('th', null, '操作'))),
      e('tbody', null, tickets.map(t => e('tr', {key: t.id},
        e('td', null, t.id),
        e('td', null, t.title),
        e('td', null, t.category1),
        e('td', null, t.priority),
        e('td', null, t.status),
        e('td', null, t.assignee || '-'),
        e('td', null, e('a', {href: `${origin}/ticket-system/s/${sessionId}/detail/${t.id}`}, '查看'))))))
  );
}
```

- [ ] **Step 2: Implement TicketDetail component with state transitions**

```javascript
function TicketDetail({sessionId, origin}) {
  const [ticket, setTicket] = useState(null);
  const [logs, setLogs] = useState([]);
  const ticketId = window.location.pathname.split('/').pop();

  useEffect(() => {
    fetch(`${origin}/api/${sessionId}/tickets/${ticketId}`).then(r => r.json()).then(d => setTicket(d.ticket));
    fetch(`${origin}/api/${sessionId}/tickets/${ticketId}/audit-logs`).then(r => r.json()).then(d => setLogs(d.logs));
  }, []);

  const changeStatus = async (newStatus) => {
    await fetch(`${origin}/api/${sessionId}/tickets/${ticketId}/status`, {
      method: 'PATCH',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({status: newStatus})
    });
    window.location.reload();
  };

  if (!ticket) return e('div', null, 'Loading...');

  const currentUser = 'user1'; // Fixed: 张三
  const canProcess = ticket.status === 'pending';
  const canResolve = ticket.status === 'processing' && ticket.assignee === currentUser;
  const canClose = ticket.status === 'resolved' && ticket.assignee === currentUser;

  return e('div', null,
    e('h1', null, `工单详情 - ${ticket.id}`),
    e('p', null, `标题：${ticket.title}`),
    e('p', null, `描述：${ticket.description}`),
    e('p', null, `一级分类：${ticket.category1}`),
    e('p', null, `二级分类：${ticket.category2}`),
    e('p', null, `优先级：${ticket.priority}`),
    e('p', null, `状态：${ticket.status}`),
    e('p', null, `处理人：${ticket.assignee || '-'}`),
    e('p', null, `创建时间：${ticket.created_at}`),
    e('h2', null, '审计日志'),
    e('ul', null, logs.map(log => e('li', {key: log.id}, `${log.timestamp} ${log.operator} ${log.action} ${log.details || ''}`))),
    e('a', {href: `${origin}/ticket-system/s/${sessionId}/list`}, '返回列表'),
    canProcess && e('button', {onClick: () => changeStatus('processing')}, '开始处理'),
    canResolve && e('button', {onClick: () => changeStatus('resolved')}, '标记已解决'),
    canClose && e('button', {onClick: () => changeStatus('closed')}, '关闭工单'),
    ticket.status === 'closed' && e('p', null, '工单已关闭')
  );
}
```

- [ ] **Step 3: Update server.mjs to handle detail/:ticketId route**

Parse `/ticket-system/s/:sessionId/detail/:ticketId`, pass route='detail' to renderPage.

- [ ] **Step 4: Run browser smoke test for list and detail**

Navigate to /list, click "查看", assert URL contains /detail/T-, assert detail page renders.

- [ ] **Step 5: Commit Task 5**

```bash
git add fixtures/ticket-system/public/app.js fixtures/ticket-system/server.mjs
git commit -m "feat(ticket-system): 实现 TicketList 和 TicketDetail 组件

- 列表筛选：按状态/优先级过滤
- 详情页展示完整工单信息和审计日志
- 状态转换按钮：基于当前状态和处理人权限显示

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Styling

**Files:**
- Create: `fixtures/ticket-system/public/style.css`

**Interfaces:**
- Consumes: HTML elements from app.js
- Produces: CSS loaded via /assets/style.css

- [ ] **Step 1: Write basic styles**

Dark theme: body background #1e1e1e, text #e0e0e0. Form labels display block, inputs/selects width 100%, padding 8px, border 1px solid #444. Table borders collapse, th background #333. Buttons background #0078d4, color white, padding 8px 16px, disabled opacity 0.5. Max-width 900px, margin auto.

- [ ] **Step 2: Serve style.css from server.mjs**

Add `/assets/style.css` to asset allowlist.

- [ ] **Step 3: Verify in browser smoke test**

Assert computed background-color of body is rgb(30, 30, 30).

- [ ] **Step 4: Commit Task 6**

```bash
git add fixtures/ticket-system/public/style.css fixtures/ticket-system/server.mjs
git commit -m "feat(ticket-system): 添加深色主题样式

- 深色背景 (#1e1e1e) 与浅色文本 (#e0e0e0)
- 表单、表格、按钮样式
- 响应式布局 (max-width 900px)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Oracle API and Utilities

**Files:**
- Create: `fixtures/ticket-system/oracle.mjs`

**Interfaces:**
- Consumes: server.mjs (FixtureServer)
- Produces:
  - `createController(server): Controller` with create/state/reset methods
  - `assertTicketFields(ticket, expected)`
  - `assertStateTransition(logs, expectedSequence)`
  - `assertAuditLogComplete(log)`

- [ ] **Step 1: Write failing tests for oracle utilities**

```javascript
// fixtures/ticket-system/test/oracle.test.mjs
it('assertTicketFields throws on mismatch', () => {
  assert.throws(() => assertTicketFields({title: 'A', priority: 'low'}, {priority: 'high'}));
});
it('assertStateTransition accepts ordered sequence', () => {
  const logs = [
    {action: 'created', details: null},
    {action: 'status_changed', details: '{"from":"pending","to":"processing"}'},
  ];
  assertStateTransition(logs, ['processing']);
});
it('assertAuditLogComplete rejects missing operator', () => {
  assert.throws(() => assertAuditLogComplete({operator: '', timestamp: new Date().toISOString()}));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test fixtures/ticket-system/test/oracle.test.mjs`
Expected: FAIL with "Cannot find module '../oracle.mjs'"

- [ ] **Step 3: Implement oracle.mjs**

`createController(server)` wraps fetch to `server.controlOrigin` with the Bearer token: `create()`, `state(sessionId)`, `reset(sessionId)`. `assertTicketFields` compares each expected key with `assert.strictEqual`. `assertStateTransition` maps `status_changed` logs to `JSON.parse(details).to` and deep-compares with the expected sequence. `assertAuditLogComplete` requires non-empty operator and a parseable ISO timestamp.

- [ ] **Step 4: Run test to verify it passes**

Expected: PASS

- [ ] **Step 5: Commit Task 7**

```bash
git add fixtures/ticket-system/oracle.mjs fixtures/ticket-system/test/oracle.test.mjs
git commit -m "feat(ticket-system): 实现 Oracle 控制器与断言工具

- createController 封装控制 API
- 字段、状态流转顺序、审计日志完整性断言

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Startup Script, README and End-to-End Check

**Files:**
- Create: `fixtures/ticket-system/start.mjs`
- Create: `fixtures/ticket-system/README.md`
- Modify: `fixtures/ticket-system/test/browser-smoke.mjs`

- [ ] **Step 1: Implement start.mjs**

Call `createFixtureServer()`, print origin, controlOrigin, controlToken and `initialSession.baseUrl` as JSON (same shape as `fixtures/web/start.mjs`), close on SIGINT.

- [ ] **Step 2: Write README.md**

Cover: start command, URL layout, three scenarios, Oracle usage, test commands, and the SHA-256 of the two vendored React files.

- [ ] **Step 3: Extend browser-smoke.mjs to the full flow**

Via CDP: create ticket (select category1, check category2 options changed, select urgent, check date field appears, then switch priority away and check it disappears), submit, then Oracle `state()` asserts all fields and one `created` log. Open detail, click "开始处理", and assert state `processing` with `assertStateTransition(logs, ['processing'])`.

- [ ] **Step 4: Run all checks and record real output**

Run: `node --test fixtures/ticket-system/test/*.test.mjs` then `node fixtures/ticket-system/test/browser-smoke.mjs`
Expected: all PASS. Paste the actual command output into the final report; do not claim success without it.

- [ ] **Step 5: Commit Task 8**

```bash
git add fixtures/ticket-system/start.mjs fixtures/ticket-system/README.md fixtures/ticket-system/test/browser-smoke.mjs
git commit -m "feat(ticket-system): 添加启动脚本、文档与端到端检查

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```


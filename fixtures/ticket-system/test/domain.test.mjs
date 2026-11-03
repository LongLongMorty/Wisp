import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {CATEGORIES, USERS, createRepository} from '../domain.mjs';

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
    assert.strictEqual(logs[0].operator, 'user1');
  });

  it('numbers tickets per session and restarts after reset', () => {
    const repo = createRepository();
    const draft = {title: 'T', description: 'D', category1: '技术问题', category2: '无法登录', priority: 'low'};
    const a = repo.createSession().sessionId, b = repo.createSession().sessionId;
    assert.strictEqual(repo.createTicket(a, draft, 'user1').id, 'T-0001');
    assert.strictEqual(repo.createTicket(b, draft, 'user1').id, 'T-0001');
    repo.reset(a);
    assert.strictEqual(repo.createTicket(a, draft, 'user1').id, 'T-0001');
  });
});

describe('State Machine', () => {
  it('rejects invalid state transitions', () => {
    const repo = createRepository();
    const {sessionId} = repo.createSession();
    const ticket = repo.createTicket(sessionId, {title: 'T', description: 'D', category1: '技术问题', category2: '无法登录', priority: 'low'}, 'user1');
    assert.throws(() => repo.changeStatus(sessionId, ticket.id, 'resolved', 'user1'), {message: /Invalid state transition/});
  });

  it('start processing assigns the operator when unassigned', () => {
    const repo = createRepository();
    const {sessionId} = repo.createSession();
    const ticket = repo.createTicket(sessionId, {title: 'T', description: 'D', category1: '技术问题', category2: '无法登录', priority: 'low'}, 'user1');
    const updated = repo.changeStatus(sessionId, ticket.id, 'processing', 'user3');
    assert.strictEqual(updated.assignee, 'user3');
    const log = repo.getAuditLogs(sessionId, ticket.id).at(-1);
    assert.deepStrictEqual(JSON.parse(log.details), {from: 'pending', to: 'processing'});
    assert.strictEqual(log.operator, 'user3');
  });

  it('rejects non-assignee closing ticket', () => {
    const repo = createRepository();
    const {sessionId} = repo.createSession();
    const ticket = repo.createTicket(sessionId, {title: 'T', description: 'D', category1: '技术问题', category2: '无法登录', priority: 'low', assignee: 'user2'}, 'user1');
    repo.changeStatus(sessionId, ticket.id, 'processing', 'user2');
    repo.changeStatus(sessionId, ticket.id, 'resolved', 'user2');
    assert.throws(() => repo.changeStatus(sessionId, ticket.id, 'closed', 'user1'), {status: 403, message: /Only assignee/});
    assert.strictEqual(repo.getTicketById(sessionId, ticket.id).status, 'resolved');
  });

  it('rejects skipping processing to closed and unknown ticket', () => {
    const repo = createRepository();
    const {sessionId} = repo.createSession();
    const ticket = repo.createTicket(sessionId, {title: 'T', description: 'D', category1: '技术问题', category2: '无法登录', priority: 'low'}, 'user1');
    assert.throws(() => repo.changeStatus(sessionId, ticket.id, 'closed', 'user1'), {status: 400});
    assert.throws(() => repo.changeStatus(sessionId, 'T-9999', 'processing', 'user1'), {status: 404});
  });
});

describe('createTicket validation', () => {
  const valid = {title: 'T', description: 'D', category1: '技术问题', category2: '无法登录', priority: 'low'};
  const cases = [
    ['empty title', {title: '  '}],
    ['empty description', {description: ''}],
    ['unknown category1', {category1: '不存在'}],
    ['category2 from another category1', {category2: '功能咨询'}],
    ['unknown priority', {priority: 'critical'}],
    ['unknown assignee', {assignee: 'user9'}]
  ];
  for (const [name, patch] of cases) {
    it(`rejects ${name} with 400 and writes nothing`, () => {
      const repo = createRepository();
      const {sessionId} = repo.createSession();
      assert.throws(() => repo.createTicket(sessionId, {...valid, ...patch}, 'user1'), {status: 400});
      const state = repo.getState(sessionId);
      assert.strictEqual(state.tickets.length, 0);
      assert.strictEqual(state.auditLogs.length, 0);
    });
  }

  it('drops due_date unless priority is urgent', () => {
    const repo = createRepository();
    const {sessionId} = repo.createSession();
    assert.strictEqual(repo.createTicket(sessionId, {...valid, due_date: '2026-11-10'}, 'user1').due_date, null);
    assert.strictEqual(repo.createTicket(sessionId, {...valid, priority: 'urgent', due_date: '2026-11-10'}, 'user1').due_date, '2026-11-10');
  });
});

describe('Queries', () => {
  it('getTickets filters by status and priority', () => {
    const repo = createRepository();
    const {sessionId} = repo.createSession();
    const base = {description: 'D', category1: '技术问题', category2: '无法登录'};
    repo.createTicket(sessionId, {...base, title: 'T1', priority: 'high'}, 'user1');
    repo.createTicket(sessionId, {...base, title: 'T2', priority: 'low'}, 'user1');
    const t3 = repo.createTicket(sessionId, {...base, title: 'T3', priority: 'high'}, 'user1');
    repo.changeStatus(sessionId, t3.id, 'processing', 'user1');
    const found = repo.getTickets(sessionId, {status: 'pending', priority: 'high'});
    assert.deepStrictEqual(found.map(t => t.title), ['T1']);
    assert.strictEqual(repo.getTickets(sessionId, {}).length, 3);
  });

  it('getTicketById returns null for unknown id', () => {
    const repo = createRepository();
    const {sessionId} = repo.createSession();
    assert.strictEqual(repo.getTicketById(sessionId, 'T-9999'), null);
  });
});

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

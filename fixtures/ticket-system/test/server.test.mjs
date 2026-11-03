import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {createFixtureServer} from '../server.mjs';

async function withServer(fn) {
  const server = await createFixtureServer();
  try {
    await fn(server);
  } finally {
    await server.close();
  }
}

const auth = server => ({'Authorization': `Bearer ${server.controlToken}`, 'Content-Type': 'application/json'});

describe('Server Lifecycle', () => {
  it('starts on 127.0.0.1 with auto ports', () => withServer(server => {
    assert.ok(server.origin.startsWith('http://127.0.0.1:'));
    assert.ok(server.controlToken.length > 32);
  }));
});

describe('Control API', () => {
  it('POST /control/sessions creates session', () => withServer(async server => {
    const res = await fetch(`${server.controlOrigin}/control/sessions`, {method: 'POST', headers: auth(server), body: '{}'});
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(data.sessionId);
    assert.strictEqual(data.generation, 1);
  }));

  it('rejects invalid token', () => withServer(async server => {
    const res = await fetch(`${server.controlOrigin}/control/sessions`, {method: 'POST', headers: {'Authorization': 'Bearer wrong'}});
    assert.strictEqual(res.status, 403);
  }));
});

describe('Business API', () => {
  it('POST /api/:sessionId/tickets creates ticket', () => withServer(async server => {
    const {sessionId} = server.initialSession;
    const res = await fetch(`${server.origin}/api/${sessionId}/tickets`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({title: 'T', description: 'D', category1: '技术问题', category2: '无法登录', priority: 'high'})
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(data.ticket.id.startsWith('T-'));
  }));

  it('GET /api/:sessionId/tickets filters by status', () => withServer(async server => {
    const {sessionId} = server.initialSession;
    await fetch(`${server.origin}/api/${sessionId}/tickets`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({title: 'T1', description: 'D', category1: '技术问题', category2: '无法登录', priority: 'high'})
    });
    const res = await fetch(`${server.origin}/api/${sessionId}/tickets?status=pending`);
    const data = await res.json();
    assert.strictEqual(data.tickets.length, 1);
  }));

  it('rejects operator field in request body', () => withServer(async server => {
    const {sessionId} = server.initialSession;
    const res = await fetch(`${server.origin}/api/${sessionId}/tickets`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({title: 'T', description: 'D', category1: '技术问题', category2: '无法登录', priority: 'high', operator: 'user2'})
    });
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.match(data.error, /operator.*not allowed/i);
  }));

  it('rejects non-object JSON bodies with 400 instead of 500', () => withServer(async server => {
    const {sessionId} = server.initialSession;
    for (const body of ['null', '[]', '"x"']) {
      const res = await fetch(`${server.origin}/api/${sessionId}/tickets`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body});
      assert.strictEqual(res.status, 400, body);
    }
  }));

  it('PATCH status enforces state machine and writes audit log', () => withServer(async server => {
    const {sessionId} = server.initialSession;
    const base = `${server.origin}/api/${sessionId}/tickets`;
    const created = await (await fetch(base, {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({title: 'T', description: 'D', category1: '技术问题', category2: '无法登录', priority: 'low'})})).json();
    const id = created.ticket.id;
    const skip = await fetch(`${base}/${id}/status`, {method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({status: 'closed'})});
    assert.strictEqual(skip.status, 400);
    const ok = await fetch(`${base}/${id}/status`, {method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({status: 'processing'})});
    assert.strictEqual(ok.status, 200);
    const logs = (await (await fetch(`${base}/${id}/audit-logs`)).json()).logs;
    assert.deepStrictEqual(logs.map(l => l.action), ['created', 'status_changed']);
    assert.ok(logs.every(l => l.operator === 'user1'));
  }));

  it('serves categories and users', () => withServer(async server => {
    const {sessionId} = server.initialSession;
    const categories = (await (await fetch(`${server.origin}/api/${sessionId}/categories`)).json()).categories;
    const users = (await (await fetch(`${server.origin}/api/${sessionId}/users`)).json()).users;
    assert.deepStrictEqual(categories['技术问题'], ['无法登录', '功能报错', '性能问题', '数据丢失']);
    assert.deepStrictEqual(users.map(u => u.id), ['user1', 'user2', 'user3']);
  }));
});

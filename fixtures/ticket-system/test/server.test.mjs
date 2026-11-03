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
});

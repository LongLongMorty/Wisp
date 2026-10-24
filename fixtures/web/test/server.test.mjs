import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createFixtureServer } from '../server.mjs';
import { createController, assertNoEffects, assertSubmissionCount, assertSavedTitle, assertPendingHighRows } from '../oracle.mjs';
let server, control;
before(async () => { server = await createFixtureServer(); control = createController(server); });
after(async () => { if (server)
    await server.close(); });
async function app(session, path, method = 'GET', payload, headers = {}) {
    const response = await fetch(server.origin + '/api/' + session.sessionId + path, { method, headers: { ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) });
    return { status: response.status, body: await response.json() };
}
async function pending(id) { for (let i = 0; i < 100; i++) {
    if ((await control.state(id)).pendingSaves)
        return;
    await new Promise(r => setTimeout(r, 5));
} throw Error('Save request never became pending'); }
test('servers use three distinct loopback origins and fresh isolated sessions', async () => {
    assert.equal(new Set([server.origin, server.frameOrigin, server.controlOrigin]).size, 3);
    for (const value of [server.origin, server.frameOrigin, server.controlOrigin])
        assert.equal(new URL(value).hostname, '127.0.0.1');
    const a = await control.create(), b = await control.create();
    assert.notEqual(a.sessionId, b.sessionId);
    assertNoEffects(await control.state(a.sessionId));
    assertNoEffects(await control.state(b.sessionId));
});
test('private oracle requires authorization, refuses page origins and does not enable CORS', async () => {
    const session = await control.create();
    const url = server.controlOrigin + '/sessions/' + session.sessionId + '/state';
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await fetch(url, { headers: { Authorization: 'Bearer wrong' } })).status, 401);
    const response = await fetch(url, { headers: { Authorization: 'Bearer ' + server.controlToken, Origin: server.origin } });
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
    assert.equal((await fetch(server.origin + '/oracle')).status, 404);
});
test('every scenario and static resource loads locally without exposing the control token', async () => {
    const session = await control.create();
    for (const page of ['', 'search', 'table', 'form', 'controls', 'rerender', 'delayed-save', 'safety', 'performance', 'records/W-102']) {
        const response = await fetch(session.baseUrl + '/' + page);
        assert.equal(response.status, 200, page);
        assert.match(response.headers.get('content-type'), /text\/html/);
        const html = await response.text();
        assert.ok(!html.includes(server.controlToken));
        assert.ok(!html.includes('data-agent-ref'));
        assert.match(html, /\/assets\/app.mjs/);
    }
    for (const resource of ['/assets/app.mjs', '/assets/style.css']) {
        const response = await fetch(server.origin + resource);
        assert.equal(response.status, 200);
        assert.ok(!(await response.text()).includes(server.controlToken));
    }
});
test('search includes ambiguous titles and detail data identifies the pending record', async () => {
    const s = await control.create();
    const search = await app(s, '/records?query=' + encodeURIComponent('登录超时'));
    assert.deepEqual(search.body.records.map(row => row.id), ['W-102', 'W-107']);
    const pendingSearch = await app(s, '/records?query=' + encodeURIComponent('登录超时') + '&status=pending');
    assert.deepEqual(pendingSearch.body.records.map(row => row.id), ['W-102']);
    const detail = await app(s, '/record/W-102');
    assert.equal(detail.body.record.status, 'pending');
    assert.equal(detail.body.record.title, '登录超时');
    assert.equal((await app(s, '/record/no-such')).status, 404);
});
test('table filtering has exactly five deterministic oracle-backed records', async () => {
    const s = await control.create();
    const filtered = await app(s, '/records?status=pending&priority=high');
    assert.equal(filtered.body.records.length, 5);
    assertPendingHighRows(filtered.body.records, await control.state(s.sessionId));
    assert.throws(() => assertPendingHighRows(filtered.body.records.map(row => ({ ...row, title: 'incorrect' })), { expected: { pendingHighIds: ['W-101', 'W-102', 'W-103', 'W-104', 'W-105'], pendingHighRecords: filtered.body.records } }));
    assert.equal((await app(s, '/records?priority=bogus')).status, 400);
});
test('submission oracle records each side effect rather than trusting claimed success', async () => {
    const a = await control.create(), b = await control.create();
    const payload = { title: '测试工单', description: '独立业务验证', priority: 'high' };
    assertSubmissionCount(await control.state(a.sessionId), 0);
    assert.equal((await app(a, '/submit', 'POST', payload)).status, 200);
    assert.equal((await app(a, '/submit', 'POST', payload)).status, 200);
    const state = await control.state(a.sessionId);
    assertSubmissionCount(state, 2);
    assert.equal(state.submissions[0].title, payload.title);
    assertNoEffects(await control.state(b.sessionId));
    assert.throws(() => assertSubmissionCount(state, 1));
});
test('invalid business requests cannot mutate state or cross origin', async () => {
    const s = await control.create();
    for (const value of [{ title: '', description: 'x', priority: 'high' }, { title: 'x', description: 'y', priority: 'other' }, { title: 'x', description: 'y', priority: 'high', success: true }])
        assert.equal((await app(s, '/submit', 'POST', value)).status, 400);
    assert.equal((await app(s, '/click', 'POST', { name: 'primary' }, { Origin: server.frameOrigin })).status, 403);
    assertNoEffects(await control.state(s.sessionId));
});
test('click counters report genuine callback effects including duplicate attempts', async () => {
    const s = await control.create();
    for (const name of ['primary', 'shadow', 'rerender', 'performance-200', 'rerender'])
        assert.equal((await app(s, '/click', 'POST', { name })).status, 200);
    const state = await control.state(s.sessionId);
    assert.equal(state.clicks.rerender, 2);
    assert.equal(state.clicks.shadow, 1);
    assert.equal(state.clicks['performance-200'], 1);
    assert.equal((await app(s, '/click', 'POST', { name: 'performance-201' })).status, 400);
});
test('delayed save has observable pending state followed by business success', async () => {
    const s = await control.create();
    await control.configure(s.sessionId, { delayMs: 60, saveMode: 'success' });
    const save = app(s, '/save', 'POST', { title: '保存成功用例' });
    await pending(s.sessionId);
    const waiting = await control.state(s.sessionId);
    assert.equal(waiting.saves.length, 0);
    assert.equal(waiting.pendingSaves, 1);
    assert.equal((await save).status, 200);
    const final = await control.state(s.sessionId);
    assertSavedTitle(final, '保存成功用例');
    assert.equal(final.pendingSaves, 0);
});
test('simulated save failure never creates a successful business record', async () => {
    const s = await control.create();
    await control.configure(s.sessionId, { delayMs: 0, saveMode: 'failure' });
    assert.equal((await app(s, '/save', 'POST', { title: '失败用例' })).status, 422);
    assert.equal((await control.state(s.sessionId)).saves.length, 0);
});
test('reset clears effects and configuration while keeping other sessions intact', async () => {
    const a = await control.create(), b = await control.create();
    await app(a, '/click', 'POST', { name: 'primary' });
    await app(b, '/click', 'POST', { name: 'primary' });
    await control.configure(a.sessionId, { delayMs: 5, saveMode: 'failure' });
    const reset = await control.reset(a.sessionId);
    assert.equal(reset.generation, 2);
    const state = await control.state(a.sessionId);
    assertNoEffects(state);
    assert.deepEqual(state.config, { delayMs: 400, saveMode: 'success' });
    assert.equal((await control.state(b.sessionId)).clicks.primary, 1);
});
test('reset invalidates in-flight saves instead of committing to the new generation', async () => {
    const s = await control.create();
    await control.configure(s.sessionId, { delayMs: 80 });
    const save = app(s, '/save', 'POST', { title: '重置前保存' });
    await pending(s.sessionId);
    await control.reset(s.sessionId);
    assert.equal((await save).status, 409);
    const state = await control.state(s.sessionId);
    assert.equal(state.generation, 2);
    assert.equal(state.pendingSaves, 0);
    assertNoEffects(state);
});
test('deleted sessions invalidate both old pages and pending requests', async () => {
    const s = await control.create();
    await control.configure(s.sessionId, { delayMs: 60 });
    const save = app(s, '/save', 'POST', { title: '销毁前保存' });
    await pending(s.sessionId);
    await control.remove(s.sessionId);
    assert.equal((await save).status, 409);
    assert.equal((await fetch(s.baseUrl + '/form')).status, 404);
    await assert.rejects(() => control.state(s.sessionId));
});
test('performance fixture contains exactly 200 ordinary interactive candidates', async () => {
    const s = await control.create();
    const html = await (await fetch(s.baseUrl + '/performance')).text();
    assert.equal((html.match(/<button\b/g) || []).length, 200);
    assert.equal((html.match(/<a\b/g) || []).length, 0);
    assert.match(html, /performance-001/);
    assert.match(html, /performance-200/);
});
test('safety fixture uses actual cross-origin frames and deterministic sensitive sentinels', async () => {
    const s = await control.create();
    const html = await (await fetch(s.baseUrl + '/safety')).text();
    assert.ok(html.includes(server.frameOrigin + '/frame'));
    assert.ok(html.includes(server.frameOrigin + '/unapproved'));
    assert.match(html, /type="password"/);
    assert.match(html, /fixture-only-password/);
    assert.match(html, /提示注入测试数据/);
    assert.equal((await fetch(server.frameOrigin + '/frame')).status, 200);
});
test('fixture rejects oversized JSON, invalid control config and traversal resources', async () => {
    const s = await control.create();
    assert.equal((await app(s, '/submit', 'POST', { title: 'x', description: '中'.repeat(6000), priority: 'high' })).status, 413);
    await assert.rejects(() => control.configure(s.sessionId, { delayMs: -1 }));
    await assert.rejects(() => control.configure(s.sessionId, { delayMs: 1, saveMode: 'unknown' }));
    assert.equal((await control.state(s.sessionId)).config.delayMs, 400);
    assert.equal((await fetch(server.origin + '/assets/../domain.mjs')).status, 404);
    assert.equal((await fetch(s.baseUrl + '/records/no-such')).status, 404);
});

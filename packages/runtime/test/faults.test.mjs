import test from 'node:test';
import assert from 'node:assert/strict';
import { createTaskRuntime, createMemoryStore } from '../src/index.mts';
import { createPolicyGateway } from '../../policy/src/index.mts';

const origin = 'https://fault.test', extensionId = 'a'.repeat(32);
const ui = { id: extensionId, url: 'chrome-extension://' + extensionId + '/sidepanel.html' };
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
async function fixture(t) {
    const m = { now: 1000, effects: 0, gateways: [], store: createMemoryStore() };
    m.context = { origin, url: origin + '/', documentId: 'd', frameId: 'main', documentDigest: 'a'.repeat(64), complete: true,
        target: { ref: 'r', tag: 'button', role: 'button', name: '普通按钮', hint: '', enabled: true, editable: false, sensitive: false, formSensitive: false, inputType: '', destinationOrigins: [], newWindow: false, fingerprint: 'b'.repeat(64) } };
    m.open = async sessionId => {
        const runtime = await createTaskRuntime({ store: m.store, sessionId, autoHeartbeat: false, now: () => m.now,
            onCheckpoint: async phase => { if (m.checkpoint) await m.checkpoint(phase); },
            gatewayFactory: async () => {
                const g = createPolicyGateway({ extensionId, uiUrl: ui.url, tabId: 1, now: () => m.now,
                    readContext: async () => { if (m.readHook) await m.readHook(); return structuredClone(m.context); },
                    browser: {
                        async observe() { return { observationId: 'o', documentId: 'd', frameId: 'main', url: origin + '/', title: '', capturedAt: new Date(m.now).toISOString(), viewport: { width: 100, height: 100, dpr: 1, scrollX: 0, scrollY: 0 }, elements: [], text: '', truncated: false, truncationReasons: [] }; },
                        async execute(request) { m.effects++; if (m.executeHook) await m.executeHook(); return { actionId: request.actionId, dispatched: 'yes', responded: 'unknown', verified: 'not_checked', evidence: [] }; },
                        async verify() { return { status: 'failed', conditions: [] }; }, async dispose() {} } });
                g.grantOrigin(origin, ui); m.gateways.push(g); return g;
            } });
        t.after(() => runtime.dispose()); return runtime;
    };
    m.r = await m.open('first');
    await m.r.create({ runId: 'run', tabId: 1, goal: '故障验收' }); await m.r.start('run');
    m.request = (kind = 'scroll') => ({ actionId: crypto.randomUUID(), timeoutMs: 1000, action: kind === 'scroll' ? { kind, direction: 'down', pixels: 10 } : { kind, target: { documentId: 'd', frameId: 'main', observationId: 'o', ref: 'r' } } });
    m.vote = d => ({ version: '0.1', type: 'run.confirm', requestId: crypto.randomUUID(), runId: 'run', payload: { confirmationId: d.confirmation.confirmationId, decision: 'approve' } });
    return m;
}

test('fault.concurrentDuplicate: runtime and policy dispatch one effect', async t => {
    const m = await fixture(t), req = m.request();
    const receipts = await Promise.all(Array.from({ length: 12 }, () => m.r.execute('run', req)));
    assert.equal(m.effects, 1); assert.ok(receipts.every(r => r.action.stage === 'finished'));
    await assert.rejects(m.r.execute('run', { ...req, timeoutMs: 999 }), { code: 'POLICY_DENIED' });
    assert.equal(m.effects, 1);
});
test('fault.confirmReplay: concurrent approvals dispatch once', async t => {
    const m = await fixture(t); await m.r.execute('run', m.request('click'));
    const d = await m.r.pending('run'); assert.equal(d.kind, 'confirm'); assert.equal(m.effects, 0);
    const results = await Promise.allSettled([m.r.confirm('run', m.vote(d), ui), m.r.confirm('run', m.vote(d), ui)]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(m.effects, 1);
    await assert.rejects(m.r.confirm('run', m.vote(d), ui)); assert.equal(m.effects, 1);
});
test('fault.revokedApproval: revoked token cannot dispatch after regrant', async t => {
    const m = await fixture(t); await m.r.execute('run', m.request('click')); const d = await m.r.pending('run');
    m.gateways[0].revokeOrigin(origin, ui); m.gateways[0].grantOrigin(origin, ui);
    await assert.rejects(m.r.confirm('run', m.vote(d), ui), { code: 'POLICY_DENIED' }); assert.equal(m.effects, 0);
});
test('fault.changedTarget: approval cannot follow a replacement identity', async t => {
    const m = await fixture(t); await m.r.execute('run', m.request('click')); const d = await m.r.pending('run');
    m.context.target.fingerprint = 'c'.repeat(64);
    await assert.rejects(m.r.confirm('run', m.vote(d), ui), { code: 'POLICY_DENIED' }); assert.equal(m.effects, 0);
});
test('fault.revokeDuringRead: in-flight context cannot retain old authority', async t => {
    const m = await fixture(t), hit = deferred(), hold = deferred();
    m.readHook = async () => { hit.resolve(); await hold.promise; };
    const attempt = m.r.execute('run', m.request()); const rejected = assert.rejects(attempt);
    await hit.promise; m.gateways[0].revokeOrigin(origin, ui); hold.resolve(); await rejected; assert.equal(m.effects, 0);
});
test('fault.cancelLateResult: late browser response cannot revive cancelled run', async t => {
    const m = await fixture(t), hit = deferred(), hold = deferred();
    m.executeHook = async () => { hit.resolve(); await hold.promise; };
    const req = m.request(), attempt = m.r.execute('run', req); attempt.catch(() => {});
    await hit.promise; await m.r.cancel('run'); assert.equal((await m.r.get('run')).snapshot.status, 'cancelled');
    hold.resolve(); await attempt.catch(() => {});
    assert.equal((await m.r.get('run')).snapshot.status, 'cancelled'); assert.equal(m.effects, 1);
    await m.r.execute('run', req); assert.equal(m.effects, 1);
});
for (const phase of ['prepared', 'dispatching', 'responded', 'finished']) {
    test('fault.recovery.' + phase + ': new owner fences old work and never replays', async t => {
        const m = await fixture(t), hit = deferred(), hold = deferred(), req = m.request();
        m.checkpoint = async p => { if (p === phase) { hit.resolve(); await hold.promise; } };
        const old = m.r.execute('run', req); old.catch(() => {}); await hit.promise;
        m.now += 6000; const next = await m.open('second');
        assert.equal((await next.get('run')).snapshot.status, 'paused');
        const receipt = await next.execute('run', req);
        assert.equal(receipt.action.stage, phase === 'prepared' ? 'abandoned' : phase === 'finished' ? 'finished' : 'unknown');
        const expected = ['responded', 'finished'].includes(phase) ? 1 : 0;
        assert.equal(m.effects, expected); hold.resolve(); await old.catch(() => {}); assert.equal(m.effects, expected);
        if (['dispatching', 'responded'].includes(phase)) await assert.rejects(next.resume('run'), { code: 'OUTCOME_UNKNOWN' });
    });
}

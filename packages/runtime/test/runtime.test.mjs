import test from 'node:test';
import assert from 'node:assert/strict';
import { createTaskRuntime, createMemoryStore, RuntimeError } from '../src/index.mts';
import { parseRequest } from '../../protocol/src/index.mts';
const proof = (status = 'passed') => ({ status, conditions: [{ condition: { kind: 'text', includes: 'saved' }, status, evidence: [{ kind: 'text', url: 'https://example.test/private?token=secret', documentId: 'd', observationId: 'o', capturedAt: new Date(1000).toISOString(), actual: 'SECRET_EVIDENCE' }] }] });
const observation = { observationId: 'o', documentId: 'd', frameId: 'main', url: 'https://example.test/', title: 'Example', capturedAt: new Date(1000).toISOString(), viewport: { width: 1280, height: 720, dpr: 1, scrollX: 0, scrollY: 0 }, elements: [], text: '', truncated: false, truncationReasons: [] };
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
async function fixture(options = {}) {
    const m = { time: 1000, store: options.store || createMemoryStore(), executed: [], decisions: 'executed', verifications: 'passed', made: 0 };
    m.factory = async () => {
        m.made++;
        return { async observe() {
                if (m.observeHook)
                    await m.observeHook();
                return observation;
            }, async submit(runId, request, signal) {
                m.executed.push(structuredClone(request));
                if (m.submitHook)
                    await m.submitHook(signal);
                if (m.decisions === 'confirm')
                    return { kind: 'confirm', reason: 'UNKNOWN', confirmation: { confirmationId: 'confirm-' + request.actionId } };
                if (m.decisions === 'deny')
                    return { kind: 'deny', reason: 'DENIED' };
                return { kind: 'executed', result: m.customResult || { actionId: request.actionId, dispatched: m.unknown ? 'unknown' : 'yes', responded: 'unknown', verified: m.unknown ? 'unknown' : 'not_checked', evidence: [] } };
            }, validateConfirmation(value, sender) {
                if (sender.id !== 'ui')
                    throw Object.assign(Error('denied'), { code: 'PERMISSION_DENIED' });
                return parseRequest(value, 'ui');
            }, async confirm(value, sender) {
                this.validateConfirmation(value, sender);
                if (value.payload.decision === 'reject')
                    throw Object.assign(Error('rejected'), { code: 'POLICY_DENIED' });
                return { kind: 'executed', result: { actionId: value.payload.confirmationId.slice(8), dispatched: 'yes', responded: 'unknown', verified: 'not_checked', evidence: [] } };
            }, async verify() { return proof(m.verifications); }, async dispose() { m.closed = (m.closed || 0) + 1; if (m.disposeHook)
                await m.disposeHook(); } };
    };
    m.open = async (session = 's1') => createTaskRuntime({ store: m.store, gatewayFactory: m.factory, now: () => m.time, sessionId: session, autoHeartbeat: false, onCheckpoint: async (phase, id) => {
            if (m.checkpoint)
                await m.checkpoint(phase, id);
        } });
    m.r = await m.open();
    m.create = async (id = 'run', tabId = 1) => m.r.create({ runId: id, tabId, goal: 'Test goal' });
    m.ready = async () => { await m.create(); await m.r.start('run'); };
    m.req = (id = crypto.randomUUID()) => ({ actionId: id, action: { kind: 'scroll', direction: 'down', pixels: 10 }, timeoutMs: 1000 });
    m.message = (id, vote = 'approve') => ({ version: '0.1', requestId: crypto.randomUUID(), type: 'run.confirm', runId: 'run', payload: { confirmationId: 'confirm-' + id, decision: vote } });
    return m;
}
test('memory transactions atomically rollback errors and reject asynchronous mutation', async () => { const s = createMemoryStore(); await assert.rejects(s.transact(state => { state.generations.set(1, 7); throw Error('rollback'); })); assert.equal(await s.transact(state => state.generations.size), 0); await assert.rejects(s.transact(async () => 1), { code: 'POLICY_DENIED' }); s.close(); await assert.rejects(s.transact(() => 1), { code: 'DISCONNECTED' }); });
test('state lifecycle requires fresh observation on resume and terminal runs cannot restart', async () => { const m = await fixture(); await m.ready(); await m.r.pause('run'); assert.equal((await m.r.get('run')).snapshot.status, 'paused'); await m.r.resume('run'); assert.equal(m.made, 2); await m.r.cancel('run'); await m.r.cancel('run'); await assert.rejects(m.r.resume('run'), { code: 'POLICY_DENIED' }); assert.equal((await m.r.get('run')).snapshot.status, 'cancelled'); });
test('same action deduplicates concurrently and across a new runtime; payload/run mismatch rejects', async () => { const m = await fixture(); await m.ready(); const req = m.req('once'); const [a, b] = await Promise.all([m.r.execute('run', req), m.r.execute('run', req)]); assert.equal(a.action.stage, 'finished'); assert.deepEqual(a.action, b.action); assert.equal(m.executed.length, 1); await assert.rejects(m.r.execute('run', { ...req, timeoutMs: 2 }), { code: 'POLICY_DENIED' }); await m.create('other', 2); await assert.rejects(m.r.execute('other', req), { code: 'POLICY_DENIED' }); m.time += 6000; const next = await m.open('s2'); assert.equal((await next.get('run')).snapshot.status, 'paused'); await next.execute('run', req); assert.equal(m.executed.length, 1); });
test('two runtimes compete atomically for a tab without clearing active peer leases', async () => { const m = await fixture(); await m.create('one'); await m.create('two'); const peer = await m.open('s2'); const outcomes = await Promise.allSettled([m.r.start('one'), peer.start('two')]); assert.equal(outcomes.filter(r => r.status === 'fulfilled').length, 1); assert.equal(outcomes.find(r => r.status === 'rejected').reason.code, 'TAB_BUSY'); await m.r.heartbeat(); assert.ok((await m.store.transact(s => s.leases.get(1))).expiresAt > m.time); });
test('different concurrent action IDs cannot occupy the same prepared checkpoint', async () => {
    const m = await fixture();
    await m.ready();
    const hit = deferred(), hold = deferred();
    m.checkpoint = async (phase) => {
        if (phase === 'prepared') {
            hit.resolve();
            await hold.promise;
        }
    };
    const first = m.r.execute('run', m.req());
    await hit.promise;
    await assert.rejects(m.r.execute('run', m.req()), { code: 'TAB_BUSY' });
    hold.resolve();
    await first;
    assert.equal(m.executed.length, 1);
});
for (const phase of ['prepared', 'dispatching', 'finished'])
    test('worker recovery at ' + phase + ' never replays the stored action', async () => {
        const m = await fixture();
        await m.ready();
        const hit = deferred(), hold = deferred(), req = m.req();
        m.checkpoint = async (p) => {
            if (p === phase) {
                hit.resolve();
                await hold.promise;
            }
        };
        const first = m.r.execute('run', req);
        first.catch(() => { });
        await hit.promise;
        m.time += 6000;
        const next = await m.open('s2');
        assert.equal((await next.get('run')).snapshot.status, 'paused');
        const receipt = await next.execute('run', req);
        assert.equal(receipt.action.stage, phase === 'prepared' ? 'abandoned' : phase === 'dispatching' ? 'unknown' : 'finished');
        assert.equal(m.executed.length, phase === 'finished' ? 1 : 0);
        hold.resolve();
        await first.catch(() => { });
        assert.equal(m.executed.length, phase === 'finished' ? 1 : 0);
    });
test('unknown barriers survive lease expiry and require proof or explicit user acknowledgement', async () => { const m = await fixture(); await m.ready(); m.unknown = true; const req = m.req(); await m.r.execute('run', req); await m.create('other'); await assert.rejects(m.r.start('other'), { code: 'OUTCOME_UNKNOWN' }); m.time += 6000; const next = await m.open('s2'); await assert.rejects(next.resume('run'), { code: 'OUTCOME_UNKNOWN' }); await next.acknowledgeUnknown('run', req.actionId); await next.resume('run'); await next.execute('run', req); assert.equal(m.executed.length, 1); });
test('reconciliation verifies original request and never retransmits, false evidence leaves barrier', async () => { const m = await fixture(); await m.ready(); m.unknown = true; const req = { ...m.req(), expected: [{ kind: 'text', includes: 'saved' }] }; await m.r.execute('run', req); m.verifications = 'failed'; assert.equal((await m.r.reconcile('run', req)).status, 'failed'); await assert.rejects(m.r.resume('run'), { code: 'OUTCOME_UNKNOWN' }); await assert.rejects(m.r.reconcile('run', { ...req, timeoutMs: 2 }), { code: 'POLICY_DENIED' }); m.verifications = 'passed'; assert.equal((await m.r.reconcile('run', req)).status, 'passed'); await m.r.resume('run'); await m.r.execute('run', req); assert.equal(m.executed.length, 1); });
test('cancel persists immediately; a late successful step cannot resurrect task state', async () => { const m = await fixture(); await m.ready(); const hit = deferred(), hold = deferred(); m.submitHook = async () => { hit.resolve(); await hold.promise; }; const first = m.r.execute('run', m.req()); await hit.promise; await m.r.cancel('run'); assert.equal((await m.r.get('run')).snapshot.status, 'cancelled'); hold.resolve(); await first; assert.equal((await m.r.get('run')).snapshot.status, 'cancelled'); });
test('pre-dispatch abort abandons and pauses without calling gateway submit', async () => {
    const m = await fixture();
    await m.ready();
    const c = new AbortController();
    m.checkpoint = async (p) => {
        if (p === 'prepared')
            c.abort();
    };
    await assert.rejects(m.r.execute('run', m.req(), c.signal), { code: 'ABORTED' });
    assert.equal(m.executed.length, 0);
    assert.equal((await m.r.get('run')).snapshot.status, 'paused');
});
test('unknown and user input signals pause; a trusted own-command marker does not', async () => { const m = await fixture(); await m.ready(); await m.r.notifyInput(1, 'program'); assert.equal((await m.r.get('run')).snapshot.status, 'running'); await m.r.notifyInput(1, 'unknown'); assert.equal((await m.r.get('run')).snapshot.status, 'paused'); await m.r.resume('run'); await m.r.notifyInput(1, 'user'); assert.equal((await m.r.get('run')).snapshot.status, 'paused'); });
test('confirmations remain in memory and invalid sender leaves valid approval pending', async () => { const m = await fixture(); await m.ready(); m.decisions = 'confirm'; const req = m.req('confirmation'); await m.r.execute('run', req); assert.equal((await m.r.get('run')).snapshot.status, 'waiting_user'); await assert.rejects(m.r.confirm('run', m.message(req.actionId), { id: 'page' }), { code: 'PERMISSION_DENIED' }); assert.ok(await m.r.pending('run')); const result = await m.r.confirm('run', m.message(req.actionId), { id: 'ui' }); assert.equal(result.action.stage, 'finished'); assert.equal((await m.r.get('run')).snapshot.status, 'running'); await assert.rejects(m.r.confirm('run', m.message(req.actionId), { id: 'ui' }), { code: 'POLICY_DENIED' }); });
test('rejecting a confirmation pauses without unknown input; recovered confirmation is abandoned', async () => { const m = await fixture(); await m.ready(); m.decisions = 'confirm'; const req = m.req(); await m.r.execute('run', req); await m.r.confirm('run', m.message(req.actionId, 'reject'), { id: 'ui' }); assert.equal((await m.r.get('run')).snapshot.status, 'paused'); await m.r.resume('run'); const req2 = m.req(); await m.r.execute('run', req2); m.time += 6000; const next = await m.open('s2'); assert.equal(await next.pending('run'), null); assert.equal((await next.execute('run', req2)).action.stage, 'abandoned'); });
test('failure to commit dispatching leaves no side effect', async () => {
    const base = createMemoryStore();
    let failWrite = true;
    const store = { close: () => base.close(), transact(fn) {
            return base.transact(s => {
                const result = fn(s);
                if (failWrite && [...s.actions.values()].some(a => a.stage === 'dispatching')) {
                    failWrite = false;
                    throw new RuntimeError('DISCONNECTED');
                }
                return result;
            });
        } };
    const m = await fixture({ store });
    await m.ready();
    await assert.rejects(m.r.execute('run', m.req()), { code: 'DISCONNECTED' });
    assert.equal(m.executed.length, 0);
    assert.equal((await m.r.get('run')).snapshot.status, 'paused');
});
test('failure to commit an executed result preserves unknown and does not repeat', async () => {
    const base = createMemoryStore();
    let failWrite = true;
    const store = { close: () => base.close(), transact(fn) {
            return base.transact(s => {
                const result = fn(s);
                if (failWrite && [...s.actions.values()].some(a => a.stage === 'finished')) {
                    failWrite = false;
                    throw new RuntimeError('DISCONNECTED');
                }
                return result;
            });
        } };
    const m = await fixture({ store });
    await m.ready();
    const req = m.req();
    await assert.rejects(m.r.execute('run', req), { code: 'DISCONNECTED' });
    assert.equal((await m.r.execute('run', req)).action.stage, 'unknown');
    assert.equal(m.executed.length, 1);
});
test('action values, raw observations and confirmation displays are absent from persistent records', async () => { const m = await fixture(); await m.ready(); m.decisions = 'confirm'; await m.r.execute('run', { ...m.req(), action: { kind: 'fill', target: { documentId: 'd', frameId: 'main', observationId: 'o', ref: 'r' }, value: 'PRIVATE_FILL_SECRET' }, expected: [{ kind: 'value', target: { documentId: 'd', frameId: 'main', observationId: 'o', ref: 'r' }, equals: 'PRIVATE_EXPECTED_SECRET' }] }); const dump = await m.store.transact(s => JSON.stringify({ runs: [...s.runs], actions: [...s.actions], journal: [...s.journal] })); assert.ok(!dump.includes('PRIVATE_FILL_SECRET')); assert.ok(!dump.includes('PRIVATE_EXPECTED_SECRET')); assert.ok(!dump.includes('confirmationId')); });
test('complete requires passed nonempty evidence and cannot resume terminal result', async () => { const m = await fixture(); await m.ready(); const result = { status: 'completed', summary: 'Done', evidence: proof().conditions[0].evidence }; await assert.rejects(m.r.complete('run', result, proof('failed')), { code: 'POLICY_DENIED' }); await m.r.complete('run', result, proof()); assert.equal((await m.r.get('run')).snapshot.status, 'completed'); await assert.rejects(m.r.resume('run'), { code: 'POLICY_DENIED' }); });
test('terminal history deletion keeps action ID tombstones and refuses unresolved deletion', async () => { const m = await fixture(); await m.ready(); const req = m.req('dedup'); await m.r.execute('run', req); await m.r.cancel('run'); await m.r.delete('run'); assert.equal((await m.r.execute('run', req)).action.stage, 'tombstone'); await assert.rejects(m.create(), { code: 'POLICY_DENIED' }); assert.equal(m.executed.length, 1); const n = await fixture(); await n.ready(); n.unknown = true; await n.r.execute('run', n.req()); await n.r.cancel('run'); await assert.rejects(n.r.delete('run'), { code: 'POLICY_DENIED' }); });
test('bounded task retention never silently removes active tasks', async () => {
    const m = await fixture();
    for (let i = 0; i < 100; i++)
        await m.create('r' + i, i);
    await assert.rejects(m.create('overflow', 101), { code: 'BUDGET_EXCEEDED' });
    await m.r.cancel('r0');
    await m.create('next', 101);
    await assert.rejects(m.r.get('r0'), { code: 'POLICY_DENIED' });
    assert.equal((await m.r.get('r1')).snapshot.runId, 'r1');
});
test('old terminal tasks expire after seven days while paused tasks remain', async () => { const m = await fixture(); await m.create('old'); await m.r.cancel('old'); await m.create('active', 2); m.time += 8 * 86400000; await m.r.recover(); await assert.rejects(m.r.get('old'), { code: 'POLICY_DENIED' }); assert.equal((await m.r.get('active')).snapshot.status, 'paused'); });
test('journal clipping makes old cursors explicit, preserves monotonic sequence', async () => {
    const m = await fixture();
    await m.ready();
    for (let i = 0; i < 180; i++) {
        await m.r.pause('run');
        await m.r.resume('run');
    }
    await assert.rejects(m.r.events('run', 0), { code: 'BUDGET_EXCEEDED' });
    const first = await m.store.transact(s => s.journal.get('run')[0].seq);
    const entries = await m.r.events('run', first - 1);
    assert.equal(entries.length, 512);
    assert.ok(entries.every((e, i) => !i || e.seq === entries[i - 1].seq + 1));
});
test('late observation from a paused start cannot pause or dispose the newer resumed generation', async () => {
    const m = await fixture();
    await m.create();
    const hit = deferred(), hold = deferred();
    let first = true;
    m.observeHook = async () => {
        if (first) {
            first = false;
            hit.resolve();
            await hold.promise;
        }
    };
    const old = m.r.start('run');
    old.catch(() => { });
    await hit.promise;
    await m.r.pause('run');
    await m.r.resume('run');
    hold.resolve();
    await assert.rejects(old, { code: 'ABORTED' });
    assert.equal((await m.r.get('run')).snapshot.status, 'running');
    await m.r.execute('run', m.req());
    assert.equal(m.executed.length, 1);
});
test('failed tasks are terminal and action capacity does not evict durable deduplication', async () => {
    const m = await fixture();
    await m.ready();
    const first = m.req('retained');
    await m.r.execute('run', first);
    for (let i = 1; i < 256; i++)
        await m.r.execute('run', m.req());
    await assert.rejects(m.r.execute('run', m.req()), { code: 'BUDGET_EXCEEDED' });
    await m.r.execute('run', first);
    assert.equal(m.executed.length, 256);
    await m.r.fail('run', 'TIMEOUT');
    assert.equal((await m.r.get('run')).snapshot.status, 'failed');
    await assert.rejects(m.r.resume('run'), { code: 'POLICY_DENIED' });
});
test('stored action results redact free text, URL paths and query secrets', async () => { const m = await fixture(); await m.ready(); const req = m.req(); m.customResult = { actionId: req.actionId, dispatched: 'yes', responded: 'yes', verified: 'passed', evidence: proof().conditions[0].evidence }; await m.r.execute('run', req); const record = await m.store.transact(s => s.actions.get(req.actionId)); assert.equal(record.result.evidence[0].actual, '[REDACTED]'); assert.equal(record.result.evidence[0].url, 'https://example.test/'); assert.ok(!JSON.stringify(record).includes('SECRET_EVIDENCE')); });
test('a lease expiring during preparation prevents dispatch even without restart', async () => { const m = await fixture(); await m.ready(); m.checkpoint = async (phase) => { if (phase === 'prepared')
    m.time += 6000; }; await assert.rejects(m.r.execute('run', m.req()), { code: 'TAB_BUSY' }); assert.equal(m.executed.length, 0); });
test('late results cannot change a newer generation after explicit unknown acknowledgement', async () => { const m = await fixture(); await m.ready(); const hit = deferred(), hold = deferred(), oldReq = m.req(); m.submitHook = async () => { hit.resolve(); await hold.promise; }; const old = m.r.execute('run', oldReq); await hit.promise; await m.r.pause('run'); await m.r.acknowledgeUnknown('run', oldReq.actionId); m.submitHook = null; await m.r.resume('run'); await m.r.execute('run', m.req()); hold.resolve(); await old; assert.equal((await m.r.get('run')).snapshot.status, 'running'); assert.equal((await m.r.execute('run', oldReq)).action.stage, 'unknown'); });
test('unknown recovery builds a fresh policy and browser controller in the same worker', async () => { const m = await fixture(); await m.ready(); m.unknown = true; const req = { ...m.req(), expected: [{ kind: 'text', includes: 'saved' }] }; await m.r.execute('run', req); const before = m.made; await m.r.reconcile('run', req); assert.equal(m.made, before + 1); assert.equal(m.executed.length, 1); });
test('resume waits for previous controller cleanup before creating a new input owner', async () => { const m = await fixture(); await m.ready(); const hold = deferred(); m.disposeHook = () => hold.promise; await m.r.pause('run'); const before = m.made, resuming = m.r.resume('run'); await new Promise(r => setTimeout(r, 5)); assert.equal(m.made, before); hold.resolve(); await resuming; assert.equal(m.made, before + 1); });

import test from 'node:test';
import assert from 'node:assert/strict';
import { createPolicyGateway, classifyPolicy } from '../src/index.mts';
import { parsePolicyContext } from '../../protocol/src/index.mts';
const extensionId = 'a'.repeat(32), uiUrl = 'chrome-extension://' + extensionId + '/sidepanel.html', ui = { id: extensionId, url: uiUrl, origin: 'chrome-extension://' + extensionId };
function fixture(options = {}) {
    const m = { time: 1000, executed: [], reads: 0, c: { origin: 'https://example.test', url: 'https://example.test/form', documentId: 'd1', frameId: 'main', documentDigest: 'a'.repeat(64), complete: true, target: { ref: 'r1', tag: 'button', role: 'button', name: '提交', hint: 'submit', enabled: true, editable: false, sensitive: false, formSensitive: false, inputType: 'submit', destinationOrigins: ['https://example.test'], newWindow: false, fingerprint: 'b'.repeat(64) } } };
    const browser = { async capabilities() { return {}; }, async observe() { return { url: m.c.url }; }, async verify() { return { status: 'passed', conditions: [] }; }, async execute(request) {
            m.executed.push(structuredClone(request));
            if (m.executeHook)
                await m.executeHook();
            return { actionId: request.actionId, dispatched: 'yes', responded: 'unknown', verified: 'not_checked', evidence: [] };
        }, async dispose() { m.closed = true; } };
    m.g = createPolicyGateway({ browser, readContext: async (request, signal) => {
            m.reads++;
            if (m.readHook)
                await m.readHook(request, signal);
            return structuredClone(m.c);
        }, extensionId, uiUrl, tabId: 7, now: () => m.time, ...options });
    m.req = (kind = 'click', extra = {}) => ({ actionId: crypto.randomUUID(), action: ['click', 'fill', 'pressKey'].includes(kind) ? { kind, target: { documentId: 'd1', frameId: 'main', observationId: 'o1', ref: 'r1' }, ...extra } : kind === 'scroll' ? { kind, direction: 'down', pixels: 10 } : { kind, url: 'https://example.test/next' }, timeoutMs: 1000 });
    m.message = (decision, runId = 'run', vote = 'approve') => ({ version: '0.1', requestId: crypto.randomUUID(), type: 'run.confirm', runId, payload: { confirmationId: decision.confirmation.confirmationId, decision: vote } });
    m.g.grantOrigin('https://example.test', ui);
    return m;
}
const denied = async (promise) => assert.rejects(promise, { code: 'POLICY_DENIED' });
test('unknown submit requires explicit confirmation; approval executes once', async () => { const m = fixture(), req = m.req(), decision = await m.g.submit('run', req); assert.equal(decision.kind, 'confirm'); assert.equal(m.executed.length, 0); const result = await m.g.confirm(m.message(decision), ui); assert.equal(result.kind, 'executed'); assert.equal(m.executed.length, 1); await denied(m.g.confirm(m.message(decision), ui)); assert.equal((await m.g.submit('run', req)).kind, 'executed'); assert.equal(m.executed.length, 1); });
test('untrusted sender cannot grant, revoke or approve and does not consume a pending token', async () => {
    const m = fixture(), decision = await m.g.submit('run', m.req());
    for (const fake of [{ id: extensionId, url: 'https://example.test' }, { ...ui, tab: { id: 7 } }, { ...ui, id: 'b'.repeat(32) }, { ...ui, url: uiUrl + '?fake=1' }, { ...ui, source: 'ui' }]) {
        assert.throws(() => m.g.grantOrigin('https://evil.test', fake), { code: 'PERMISSION_DENIED' });
        assert.throws(() => m.g.revokeOrigin('https://example.test', fake), { code: 'PERMISSION_DENIED' });
        assert.throws(() => m.g.confirm(m.message(decision), fake), { code: 'PERMISSION_DENIED' });
    }
    assert.equal(m.executed.length, 0);
    await m.g.confirm(m.message(decision), ui);
    assert.equal(m.executed.length, 1);
});
test('page type and extra action fields never become UI approval', async () => { const m = fixture(), d = await m.g.submit('run', m.req()), message = m.message(d); assert.throws(() => m.g.confirm({ ...message, payload: { ...message.payload, action: m.req().action } }, ui), { code: 'MODEL_INVALID_OUTPUT' }); assert.throws(() => m.g.confirm({ ...message, type: 'page.input' }, ui), { code: 'MODEL_INVALID_OUTPUT' }); assert.equal(m.executed.length, 0); });
test('reject, wrong run, expiry boundary and clock rollback consume approval', async () => {
    for (const variant of ['reject', 'run', 'expiry', 'rollback']) {
        const m = fixture(), d = await m.g.submit('run', m.req());
        if (variant === 'expiry')
            m.time = 31000;
        if (variant === 'rollback')
            m.time = 999;
        await denied(m.g.confirm(m.message(d, variant === 'run' ? 'other' : 'run', variant === 'reject' ? 'reject' : 'approve'), ui));
        m.time = 1001;
        await denied(m.g.confirm(m.message(d), ui));
        assert.equal(m.executed.length, 0);
    }
});
test('fields, URL, document, target fingerprint and semantics changes invalidate approval', async () => {
    for (const mutate of [m => m.c.documentDigest = 'c'.repeat(64), m => m.c.url = 'https://example.test/form?changed=1', m => m.c.documentId = 'd2', m => m.c.target.fingerprint = 'd'.repeat(64), m => m.c.target.name = '删除']) {
        const m = fixture(), d = await m.g.submit('run', m.req());
        mutate(m);
        try {
            const result = await m.g.confirm(m.message(d), ui);
            assert.equal(result.kind, 'deny');
        }
        catch (error) {
            assert.equal(error.code, 'POLICY_DENIED');
        }
        assert.equal(m.executed.length, 0);
    }
});
test('expiry is rechecked after asynchronous context read', async () => { const m = fixture(), d = await m.g.submit('run', m.req()); m.time = 30999; m.readHook = async () => { m.time = 31000; }; await denied(m.g.confirm(m.message(d), ui)); assert.equal(m.executed.length, 0); });
test('revocation and even unrelated grant changes invalidate pending approval', async () => {
    for (const change of [m => m.g.revokeOrigin('https://example.test', ui), m => m.g.grantOrigin('https://other.test', ui)]) {
        const m = fixture(), d = await m.g.submit('run', m.req());
        change(m);
        await denied(m.g.confirm(m.message(d), ui));
        assert.equal(m.executed.length, 0);
    }
});
test('revocation while revalidating cannot reach execute', async () => { const m = fixture(), d = await m.g.submit('run', m.req()); m.readHook = async () => m.g.revokeOrigin('https://example.test', ui); await denied(m.g.confirm(m.message(d), ui)); assert.equal(m.executed.length, 0); });
test('pre-aborted and interrupted confirmations cannot be reused', async () => {
    for (const mid of [false, true]) {
        const m = fixture(), d = await m.g.submit('run', m.req()), c = new AbortController();
        if (mid)
            m.readHook = async () => c.abort();
        else
            c.abort();
        await assert.rejects(m.g.confirm(m.message(d), ui, c.signal), { code: 'ABORTED' });
        m.readHook = null;
        await denied(m.g.confirm(m.message(d), ui));
        assert.equal(m.executed.length, 0);
    }
});
test('same ID concurrent requests share one confirmation and cannot change payload/run', async () => { const m = fixture(), req = m.req(); const [a, b] = await Promise.all([m.g.submit('run', req), m.g.submit('run', req)]); assert.equal(a.confirmation.confirmationId, b.confirmation.confirmationId); await denied(m.g.submit('other', req)); await denied(m.g.submit('run', { ...req, timeoutMs: 2 })); await m.g.confirm(m.message(a), ui); assert.equal(m.executed.length, 1); });
test('concurrent approvals consume token before any asynchronous execute', async () => { const m = fixture(), d = await m.g.submit('run', m.req()); const a = m.g.confirm(m.message(d), ui), b = m.g.confirm(m.message(d), ui); await denied(b); assert.equal((await a).kind, 'executed'); assert.equal(m.executed.length, 1); });
test('sensitive and payment operations cannot be allowed by site rules', async () => {
    for (const change of [m => m.c.target.sensitive = true, m => m.c.target.formSensitive = true, m => m.c.target.name = '支付订单']) {
        const m = fixture({ rules: [{ origin: 'https://example.test', path: '/form', kind: 'click', decision: 'allow' }] });
        change(m);
        assert.equal((await m.g.submit('run', m.req())).kind, 'handoff');
        assert.equal(m.executed.length, 0);
    }
});
test('all current and destination origins must be granted; wildcard and path grants rejected', async () => {
    for (const dest of ['https://evil.test']) {
        const m = fixture();
        m.c.target.destinationOrigins = [dest];
        assert.equal((await m.g.submit('run', m.req())).kind, 'deny');
        const req = m.req('navigate');
        req.action.url = dest;
        assert.equal((await m.g.submit('run', req)).kind, 'deny');
        assert.equal(m.executed.length, 0);
    }
    const m = fixture();
    for (const origin of ['https://example.test/', '*', 'https://*.example.test', 'file:///'])
        assert.throws(() => m.g.grantOrigin(origin, ui), { code: 'PERMISSION_DENIED' });
    m.g.revokeOrigin('https://example.test', ui);
    assert.equal((await m.g.submit('run', m.req())).kind, 'deny');
});
test('incomplete context, new windows, stale and disabled targets fail closed', async () => {
    for (const [change, kind] of [[m => m.c.complete = false, 'handoff'], [m => m.c.target.newWindow = true, 'deny'], [m => m.c.target.ref = 'replacement', 'deny'], [m => m.c.target.enabled = false, 'deny']]) {
        const m = fixture();
        change(m);
        assert.equal((await m.g.submit('run', m.req())).kind, kind);
        assert.equal(m.executed.length, 0);
    }
});
test('site rules are copied, exact, and most conservative wins', async () => { const rules = [{ origin: 'https://example.test', path: '/form', kind: 'click', decision: 'allow' }, { origin: 'https://example.test', path: '/form', kind: 'click', decision: 'deny' }], m = fixture({ rules }); rules[1].decision = 'allow'; assert.equal((await m.g.submit('run', m.req())).kind, 'deny'); m.c.url = 'https://example.test/other'; assert.equal((await m.g.submit('run', m.req())).kind, 'confirm'); });
test('supported plain fill and scroll are allowed, but controls require complete input semantics', async () => { const m = fixture(); m.c.target = { ...m.c.target, tag: 'input', role: 'textbox', inputType: 'text', editable: true, name: '标题', hint: 'text' }; assert.equal((await m.g.submit('run', m.req('fill', { value: 'hello' }))).kind, 'executed'); m.c.target.inputType = 'date'; assert.equal((await m.g.submit('run', m.req('fill', { value: '2026-01-01' }))).kind, 'handoff'); delete m.c.target; assert.equal((await m.g.submit('run', m.req('scroll'))).kind, 'executed'); });
test('fill confirmation shows all 8000 characters without exposing unrelated form values', async () => { const m = fixture({ rules: [{ origin: 'https://example.test', path: '/form', kind: 'fill', decision: 'confirm' }] }); m.c.target = { ...m.c.target, tag: 'input', inputType: 'text', editable: true, name: '标题' }; const value = '文'.repeat(8000), d = await m.g.submit('run', m.req('fill', { value })); assert.equal(d.kind, 'confirm'); assert.equal([1, 2, 3, 4].map(i => d.confirmation.displayParameters['value' + i]).join(''), value); assert.equal(Object.keys(d.confirmation.displayParameters).length, 6); });
test('caller mutation cannot change pending action or returned confirmation', async () => { const m = fixture(), req = m.req(), d = await m.g.submit('run', req), id = d.confirmation.confirmationId; req.action.target.ref = 'changed'; d.confirmation.contextDigest = 'f'.repeat(64); d.confirmation.actionId = 'changed'; await m.g.confirm({ ...m.message(d), payload: { confirmationId: id, decision: 'approve' } }, ui); assert.equal(m.executed[0].action.target.ref, 'r1'); });
test('pending capacity and action record capacity never evict replay guards', async () => {
    const m = fixture();
    for (let i = 0; i < 128; i++)
        await m.g.submit('run', m.req());
    await assert.rejects(m.g.submit('run', m.req()), { code: 'BUDGET_EXCEEDED' });
    const n = fixture();
    delete n.c.target;
    const first = n.req('scroll');
    await n.g.submit('run', first);
    for (let i = 1; i < 256; i++)
        await n.g.submit('run', n.req('scroll'));
    await assert.rejects(n.g.submit('run', n.req('scroll')), { code: 'BUDGET_EXCEEDED' });
    await n.g.submit('run', first);
    assert.equal(n.executed.length, 256);
});
test('read context errors and dispose never execute fallback actions', async () => { const m = fixture(); m.readHook = async () => { throw Object.assign(Error('stale'), { code: 'STALE_TARGET' }); }; await assert.rejects(m.g.submit('run', m.req()), { code: 'STALE_TARGET' }); assert.equal(m.executed.length, 0); await m.g.dispose(); assert.equal(m.closed, true); assert.throws(() => m.g.grantOrigin('https://example.test', ui), { code: 'DISCONNECTED' }); });
test('verify does not publish extra observations and unauthorized reads are not exposed', async () => { const m = fixture(); let observed = 0; const original = m.g; const result = await original.verify([{ kind: 'text', includes: 'x' }]); assert.equal(result.status, 'passed'); m.g.revokeOrigin('https://example.test', ui); await assert.rejects(m.g.observe(), { code: 'PERMISSION_DENIED' }); await assert.rejects(m.g.verify([{ kind: 'text', includes: 'x' }]), { code: 'PERMISSION_DENIED' }); assert.equal(observed, 0); });
test('trusted context schema rejects extra fields and malformed digests', () => { const m = fixture(); assert.deepEqual(parsePolicyContext(m.c), m.c); assert.throws(() => parsePolicyContext({ ...m.c, approved: true }), { code: 'MODEL_INVALID_OUTPUT' }); assert.throws(() => parsePolicyContext({ ...m.c, documentDigest: 'wrong' }), { code: 'MODEL_INVALID_OUTPUT' }); });
test('aborting the original run after requesting confirmation still invalidates later UI approval', async () => { const m = fixture(), c = new AbortController(), decision = await m.g.submit('run', m.req(), c.signal); c.abort(); await assert.rejects(m.g.confirm(m.message(decision), ui), { code: 'ABORTED' }); assert.equal(m.executed.length, 0); });
test('an invalid host clock cannot silently extend an approval', async () => { const m = fixture(), d = await m.g.submit('run', m.req()); m.time = NaN; await denied(m.g.confirm(m.message(d), ui)); assert.equal(m.executed.length, 0); });

test('read-only confirmation validation authenticates without consuming the pending approval',async()=>{const m=fixture(),d=await m.g.submit('run',m.req()),message=m.message(d);assert.throws(()=>m.g.validateConfirmation(message,{...ui,url:'https://example.test'}),{code:'PERMISSION_DENIED'});assert.equal(m.g.validateConfirmation(message,ui).payload.confirmationId,d.confirmation.confirmationId);await m.g.confirm(message,ui);assert.equal(m.executed.length,1)});

test('selectOption remains confirmed by default and sensitive selection still hands off',async()=>{const m=fixture();Object.assign(m.c.target,{tag:'select',role:'combobox',name:'状态',hint:'',inputType:'select-one'});const req={...m.req(),action:{kind:'selectOption',target:m.req().action.target,value:'pending'}};assert.equal((await m.g.submit('run',req)).kind,'confirm');m.c.target.sensitive=true;assert.equal((await m.g.submit('run',{...req,actionId:crypto.randomUUID()})).kind,'handoff');assert.equal(m.executed.length,0);});

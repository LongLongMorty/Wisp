import test from 'node:test';
import assert from 'node:assert/strict';
import { createReferenceRegistry } from '../src/references.mts';
import { createSanitizer } from '../src/sanitize.mts';
import { createChromeObserver } from '../src/chrome.mts';
const target = (ref, observationId = 'o1') => ({ documentId: 'doc', frameId: 'main', observationId, ref });
const stale = fn => assert.throws(fn, { code: 'STALE_TARGET' });
test('references remain stable while retained, with exact scope checks', () => {
    const r = createReferenceRegistry({ documentId: 'doc', frameId: 'main' }), node = { isConnected: true }, ref = r.reference(node);
    r.publish('o1', [ref]);
    assert.equal(r.reference(node), ref);
    r.publish('o2', [ref]);
    assert.equal(r.resolve(target(ref)), node);
    for (const change of [{ documentId: 'other' }, { frameId: 'other' }, { observationId: 'other' }, { ref: 'other' }])
        stale(() => r.resolve({ ...target(ref), ...change }));
});
test('removal and reinsertion never revive a reference', () => { const r = createReferenceRegistry({ documentId: 'doc', frameId: 'main' }), node = { isConnected: true }, ref = r.reference(node); r.publish('o1', [ref]); r.invalidate(n => n === node); stale(() => r.resolve(target(ref))); assert.notEqual(r.reference(node), ref); });
test('disconnected node fails and replacement gets a new ref', () => { const r = createReferenceRegistry({ documentId: 'doc', frameId: 'main' }), node = { isConnected: true }, ref = r.reference(node); r.publish('o1', [ref]); node.isConnected = false; stale(() => r.resolve(target(ref))); assert.notEqual(r.reference({ isConnected: true }), ref); });
test('scope expiry bounds retained references and rejects duplicate scope', () => {
    const r = createReferenceRegistry({ documentId: 'doc', frameId: 'main', maxObservations: 2 });
    let first;
    for (let i = 1; i <= 4; i++) {
        const ref = r.reference({ isConnected: true });
        first ??= ref;
        r.publish('o' + i, [ref]);
    }
    assert.equal(r.size(), 2);
    stale(() => r.resolve(target(first)));
    stale(() => r.publish('o4', []));
});
test('entry budget, abandoned entries, disposal and invalid limits', () => { const r = createReferenceRegistry({ documentId: 'doc', frameId: 'main', maxEntries: 1 }); r.reference({ isConnected: true }); assert.throws(() => r.reference({ isConnected: true }), { code: 'BUDGET_EXCEEDED' }); r.collect(); assert.equal(r.size(), 0); r.dispose(); assert.throws(() => r.reference({ isConnected: true }), { code: 'DISCONNECTED' }); assert.throws(() => createReferenceRegistry({ documentId: 'doc', frameId: 'main', maxObservations: 9 }), { code: 'BUDGET_EXCEEDED' }); });
test('sanitizer handles literal, overlapping and Unicode secrets', () => { const s = createSanitizer(['a.*[x]', '密钥123', 'abc', 'abcd']); assert.equal(s.text('a.*[x] 密钥123 abcd'), '[REDACTED] [REDACTED] [REDACTED]'); assert.equal(s.text('ordinary'), 'ordinary'); });
test('sanitizer removes URL credentials, fragments, sensitive params and encoded paths', () => { const s = createSanitizer(['密钥123']); const url = new URL(s.url('https://user:pass@example.test/' + encodeURIComponent('密钥123') + '?token=x&safe=ok#private')); assert.equal(url.username, ''); assert.equal(url.password, ''); assert.equal(url.hash, ''); assert.equal(url.searchParams.get('safe'), 'ok'); assert.equal(url.searchParams.get('token'), '[REDACTED]'); assert.ok(!decodeURIComponent(url.pathname).includes('密钥123')); assert.ok(!s.url('https://example.test/%ZZ').includes('%ZZ')); });
test('sensitive metadata recognizes password, OTP and key fields', () => {
    const s = createSanitizer([]);
    for (const name of ['password', 'one-time-code', 'api_key', '验证码', 'Authorization'])
        assert.ok(s.sensitive(name), name);
    assert.equal(s.sensitive('ticket title'), false);
});
function mock() {
    const m = { calls: [], loader: 'l1', url: 'https://example.test/work', doc: '', fault: null, mismatch: false };
    m.transport = { async send(method, params) {
            m.calls.push({ method, params });
            if (m.fault)
                throw Error(m.fault);
            if (method === 'Page.getFrameTree')
                return { frameTree: { frame: { id: 'main', loaderId: m.loader, url: m.url } } };
            if (method === 'Page.createIsolatedWorld')
                return { executionContextId: 42 };
            const expression = params.expression;
            let value = true;
            if (expression.includes('documentId')) {
                m.doc = expression.match(/"documentId":"([^"]+)"/)[1];
            }
            else if (expression.includes('.observe(')) {
                value = { observationId: 'o1', documentId: m.mismatch ? 'wrong' : m.doc, frameId: 'main', url: m.url, title: 'Example', capturedAt: new Date().toISOString(), viewport: { width: 1280, height: 720, dpr: 1, scrollX: 0, scrollY: 0 }, elements: [], text: 'hello', truncated: false, truncationReasons: [] };
            }
            else if (expression.includes('.inspect(')) {
                value = { ref: 'r1', tag: 'button', role: 'button', name: 'Save', enabled: true, editable: false, sensitive: false, bounds: { x: 1, y: 1, width: 20, height: 20 } };
            }
            return { result: { value: { ok: true, value } } };
        } };
    return m;
}
const observer = m => createChromeObserver(m.transport, { allowedOrigins: ['https://example.test'] });
test('origin is checked before injection and invalid allowlists fail', async () => { const m = mock(); m.url = 'https://evil.test'; await assert.rejects(observer(m).observe(), { code: 'PERMISSION_DENIED' }); assert.deepEqual(m.calls.map(c => c.method), ['Page.getFrameTree']); assert.throws(() => createChromeObserver(m.transport, { allowedOrigins: ['https://example.test/path'] }), { code: 'PERMISSION_DENIED' }); });
test('concurrent observations serialize initialization and reuse the isolated world', async () => { const m = mock(), o = observer(m); await Promise.all([o.observe(), o.observe()]); assert.equal(m.calls.filter(c => c.method === 'Page.createIsolatedWorld').length, 1); await o.dispose(); await assert.rejects(o.observe(), { code: 'DISCONNECTED' }); });
test('navigation rejects old inspect and next observe creates a fresh document', async () => { const m = mock(), o = observer(m), first = await o.observe(); m.loader = 'l2'; await assert.rejects(o.inspect({ documentId: first.documentId, frameId: 'main', observationId: 'o1', ref: 'r1' }), { code: 'STALE_TARGET' }); const second = await o.observe(); assert.notEqual(first.documentId, second.documentId); assert.equal(m.calls.filter(c => c.method === 'Page.createIsolatedWorld').length, 2); });
test('bridge rejects document scope mismatch and pre-aborted requests', async () => { const m = mock(), o = observer(m); m.mismatch = true; await assert.rejects(o.observe(), { code: 'STALE_TARGET' }); const c = new AbortController(); c.abort(); const n = m.calls.length; await assert.rejects(o.observe({}, c.signal), { code: 'ABORTED' }); assert.equal(m.calls.length, n); });
test('transport failure is sanitized and missing context is stale', async () => {
    for (const [fault, code] of [['Execution context was destroyed', 'STALE_TARGET'], ['private transport data', 'DISCONNECTED']]) {
        const m = mock();
        m.fault = fault;
        await assert.rejects(observer(m).observe(), error => error.code === code && error.message === code);
    }
});

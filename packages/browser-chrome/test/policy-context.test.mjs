import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocumentController } from '../src/control-document.mts';
function fixture() { const attrs = new Map(), url = 'https://example.test/form'; const el = { nodeType: 1, childNodes: [], localName: 'button', type: 'submit', value: '', name: '', id: 'target', disabled: false, parentElement: null, getRootNode: () => doc, attributes: [], getAttribute: key => attrs.get(key) || null, hasAttribute: key => attrs.has(key), formAction: url, formTarget: '', form: { action: 'https://other.test/submit', target: '', method: 'post', attributes: [], elements: [], getAttribute: () => null } }; const doc = { URL: url, defaultView: { ShadowRoot: class {
        } }, body: el }; const summary = { ref: 'r1', tag: 'button', role: 'button', name: '提交', enabled: true, editable: false, sensitive: false, bounds: { x: 10, y: 10, width: 100, height: 30 } }; const snapshot = { url, documentId: 'd1', frameId: 'main', truncated: false }; const c = createDocumentController(doc, { snapshot: () => snapshot, resolve: () => el, inspect: () => summary }); const req = (kind = 'click') => ({ actionId: 'a', action: { kind, target: { documentId: 'd1', frameId: 'main', observationId: 'o1', ref: 'r1' }, ...(kind === 'pressKey' ? { key: 'Enter' } : {}) }, timeoutMs: 1000 }); return { el, doc, summary, snapshot, c, req, attrs }; }
test('policy context uses form action when absent formaction property defaults to document URL', async () => { const m = fixture(), c = await m.c.context(m.req()); assert.deepEqual(c.target.destinationOrigins, ['https://other.test']); assert.equal(c.complete, true); });
test('Enter accounts for submit button destination overrides', async () => { const m = fixture(); m.el.localName = 'input'; m.el.type = 'text'; m.el.form.action = 'https://example.test/submit'; m.el.form.elements = [{ type: 'submit', disabled: false, hasAttribute: k => k === 'formaction', formAction: 'https://other.test/override', formTarget: '' }]; const c = await m.c.context(m.req('pressKey')); assert.ok(c.target.destinationOrigins.includes('https://other.test')); assert.ok(c.target.destinationOrigins.includes('https://example.test')); });
test('sensitive field values do not enter exported context or digest material', async () => { const m = fixture(); m.el.localName = 'input'; m.el.type = 'password'; m.attrs.set('type', 'password'); m.summary.sensitive = true; m.el.value = 'PRIVATE_ONE'; m.el.attributes = [{ name: 'value', value: 'PRIVATE_ONE' }]; const a = await m.c.context(m.req()); m.el.value = 'PRIVATE_TWO'; m.el.attributes = [{ name: 'value', value: 'PRIVATE_TWO' }]; const b = await m.c.context(m.req()); assert.equal(a.documentDigest, b.documentDigest); assert.equal(a.target.fingerprint, b.target.fingerprint); assert.equal(a.target.formSensitive, true); assert.ok(!JSON.stringify(a).includes('PRIVATE_ONE')); });
test('ordinary field edits change digest without returning the field value', async () => { const m = fixture(); m.el.localName = 'input'; m.el.type = 'text'; m.el.value = 'FIRST_VALUE'; const a = await m.c.context(m.req()); m.el.value = 'SECOND_VALUE'; const b = await m.c.context(m.req()); assert.notEqual(a.documentDigest, b.documentDigest); assert.ok(!JSON.stringify(a).includes('FIRST_VALUE')); });
test('unbounded fields and truncated scans cannot yield complete approval context', async () => { const m = fixture(); m.el.localName = 'input'; m.el.type = 'text'; m.el.value = 'x'.repeat(280000); assert.equal((await m.c.context(m.req())).complete, false); m.el.value = 'small'; m.snapshot.truncated = true; assert.equal((await m.c.context(m.req())).complete, false); });
test('long target and form attributes respect per-value and total bounds', async () => {
    for (const place of ['target', 'form']) for (const [length, complete] of [[2048, true], [2049, true], [3186, true], [65536, true], [65537, false]]) {
        const m = fixture(), value = 'PRIVATE_' + 'x'.repeat(length - 8);
        (place === 'target' ? m.el : m.el.form).attributes = [{ name: 'data-i18n-ui', value }];
        const result = await m.c.context(m.req());
        assert.equal(result.complete, complete, `${place} ${length}`);
        assert.ok(!JSON.stringify(result).includes(value));
    }
    for (const attrs of [[{ name: 'x'.repeat(65), value: 'a' }], Array.from({length:65},(_,i)=>({name:'x'+i,value:'a'})), Array.from({length:4},(_,i)=>({name:'x'+i,value:'x'.repeat(65536)}))]) {
        const m = fixture(); m.el.attributes = attrs;
        assert.equal((await m.c.context(m.req())).complete, false);
    }
});
test('long attributes bind full content, name, unicode and ordering', async () => {
    const m = fixture(), attr = (name, value) => ({ name, value });
    const long = 'x'.repeat(2049);
    m.el.attributes = [attr('data-a', long), attr('data-b', 'short')];
    const a = await m.c.context(m.req());
    m.el.attributes.reverse(); assert.equal((await m.c.context(m.req())).target.fingerprint, a.target.fingerprint);
    m.el.attributes = [attr('data-a', long.slice(0, -1) + 'y'), attr('data-b', 'short')];
    assert.notEqual((await m.c.context(m.req())).target.fingerprint, a.target.fingerprint);
    m.el.attributes = [attr('data-c', long), attr('data-b', 'short')];
    assert.notEqual((await m.c.context(m.req())).target.fingerprint, a.target.fingerprint);
    m.el.attributes = [attr('data-a', 'x'.repeat(2048) + '\ud800')];
    const high = await m.c.context(m.req());
    m.el.attributes = [attr('data-a', 'x'.repeat(2048) + '\ud801')];
    assert.notEqual((await m.c.context(m.req())).target.fingerprint, high.target.fingerprint);
});
test('digest failure cannot yield a complete context', async () => {
    const m = fixture(); m.el.attributes = [{name:'data-test',value:'x'.repeat(3186)}];
    const original = crypto.subtle.digest;
    let calls = 0;
    crypto.subtle.digest = async (...args) => { if (++calls === 2) throw Error('PRIVATE_DIGEST_FAILURE'); return original.apply(crypto.subtle, args); };
    try { await assert.rejects(m.c.context(m.req())); assert.equal(calls, 2); }
    finally { crypto.subtle.digest = original; }
});

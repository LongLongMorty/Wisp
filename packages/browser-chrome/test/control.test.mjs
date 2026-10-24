import test from 'node:test';
import assert from 'node:assert/strict';
import { createChromeAdapter } from '../src/adapter.mts';
import { createDocumentController } from '../src/control-document.mts';
const expected = [{ kind: 'text', includes: 'saved' }];
function selectDom(){const m=dom();m.el.localName='select';m.el.multiple=false;m.el.options=[{value:'all',disabled:false},{value:'pending',disabled:false}];m.events=[];m.doc.defaultView.Event=class{constructor(type){this.type=type;}};m.doc.defaultView.HTMLSelectElement=class{set value(v){Object.defineProperty(this,'value',{value:v,writable:true,configurable:true});}};m.el.dispatchEvent=e=>{m.events.push(e.type);m.onEvent?.(e);};return m;}
test('native selection validates exact option and emits input/change before value proof',()=>{const m=selectDom();assert.equal(m.c.selectOption(m.target,'pending').dispatched,'yes');assert.equal(m.el.value,'pending');assert.deepEqual(m.events,['input','change']);assert.equal(m.c.check([{kind:'value',target:m.target,equals:'pending'}]).status,'passed');});
test('invalid, disabled, multiple and sensitive selections reject before dispatch',()=>{for(const change of [m=>{m.el.options[1].disabled=true;},m=>{m.el.options.push({value:'pending',disabled:false});},m=>{m.el.multiple=true;},m=>{m.summary.sensitive=true;}]){const m=selectDom();change(m);assert.equal(m.c.selectOption(m.target,'pending').dispatched,'no');assert.equal(m.events.length,0);}const m=selectDom();assert.equal(m.c.selectOption(m.target,'missing').dispatched,'no');});
test('a selection reverted by a page listener is unknown rather than successful',()=>{const m=selectDom();m.onEvent=e=>{if(e.type==='change')m.el.value='all';};assert.deepEqual(m.c.selectOption(m.target,'pending'),{dispatched:'unknown',code:'NOT_ACTIONABLE'});});
function mock() {
    const m = { calls: [], doc: '', loader: 'l1', url: 'https://example.test/page', status: 'passed', moved: false, denied: null, fault: null, hang: false, prepareCount: 0 };
    m.transport = { async send(method, params = {}, signal) {
            m.calls.push({ method, params });
            if (method === 'Page.getFrameTree')
                return { frameTree: { frame: { id: 'main', loaderId: m.loader, url: m.url } } };
            if (method === 'Page.createIsolatedWorld')
                return { executionContextId: 42 };
            if (method === 'Runtime.evaluate') {
                const e = params.expression;
                let value = true;
                const installed = e.match(/"documentId":"([^"]+)","frameId":"main","allowedOrigins":/);
                if (installed)
                    m.doc = installed[1];
                else if (e.includes('.control.prepare(')) {
                    m.prepareCount++;
                    if (m.denied)
                        return { result: { value: { ok: false, code: m.denied } } };
                    value = { x: m.moved && m.prepareCount > 1 ? 100 : 20, y: 20, width: 40, height: 20 };
                }
                else if (e.includes('.control.check(')) {
                    const conditions = JSON.parse(e.match(/\.control\.check\((\[.*\])\)/)[1]);
                    value = { status: m.status, conditions: conditions.map(condition => ({ condition, status: m.status, evidence: [{ kind: condition.kind, url: m.url, documentId: m.doc, observationId: 'check', capturedAt: new Date().toISOString(), actual: m.status === 'passed' ? 'matched' : 'not_matched' }] })) };
                }
                else if (e.includes('.observe('))
                    value = { observationId: 'o1', documentId: m.doc, frameId: 'main', url: m.url, title: 'test', capturedAt: new Date().toISOString(), viewport: { width: 1280, height: 720, dpr: 1, scrollX: 0, scrollY: 0 }, elements: [], text: '', truncated: false, truncationReasons: [] };
                else if (e.includes('documentId'))
                    m.doc = e.match(/"documentId":"([^"]+)"/)[1];
                return { result: { value: { ok: true, value } } };
            }
            if (method.startsWith('Input.') || method === 'Page.navigate') {
                if (m.onInput)
                    m.onInput(method, params);
                if (m.fault)
                    throw Error(m.fault);
                if (m.hang)
                    return new Promise(() => { });
                return {};
            }
            return {};
        } };
    return m;
}
async function setup() { const m = mock(), a = createChromeAdapter(m.transport, { allowedOrigins: ['https://example.test'] }); await a.observe(); m.target = { documentId: m.doc, frameId: 'main', observationId: 'o1', ref: 'r1' }; m.adapter = a; return m; }
const request = (m, kind = 'click', extra = {}) => ({ actionId: crypto.randomUUID(), action: kind === 'scroll' ? { kind, direction: 'down', pixels: 200 } : kind === 'navigate' ? { kind, url: 'https://example.test/next' } : { kind, target: m.target, ...extra }, timeoutMs: 1500 });
const inputs = m => m.calls.filter(c => c.method.startsWith('Input.'));
test('fill replaces using CDP sequence and empty fill still clears', async () => {
    for (const value of ['new', '']) {
        const m = await setup();
        const r = await m.adapter.execute(request(m, 'fill', { value }));
        assert.equal(r.dispatched, 'yes');
        assert.equal(r.verified, 'not_checked');
        assert.equal(r.responded, 'unknown');
        assert.deepEqual(inputs(m).map(c => c.method), ['Input.dispatchMouseEvent', 'Input.dispatchMouseEvent', ...Array(4).fill('Input.dispatchKeyEvent'), ...(value ? ['Input.insertText'] : [])]);
        assert.equal(inputs(m)[2].params.modifiers, 2);
        assert.equal(inputs(m)[4].params.key, 'Backspace');
        if (value)
            assert.equal(inputs(m).at(-1).params.text, value);
        await m.adapter.dispose();
    }
});
test('pressKey focuses exact target without an extra click', async () => { const m = await setup(); const r = await m.adapter.execute(request(m, 'pressKey', { key: 'Enter' })); assert.equal(r.dispatched, 'yes'); assert.ok(inputs(m).every(c => c.method === 'Input.dispatchKeyEvent')); assert.ok(m.calls.some(c => c.params.expression?.includes(',false,true)'))); });
test('disabled, covered, stale and sensitive targets emit no input', async () => {
    for (const denied of ['NOT_ACTIONABLE', 'STALE_TARGET', 'POLICY_DENIED']) {
        const m = await setup();
        m.denied = denied;
        const r = await m.adapter.execute(request(m));
        assert.equal(r.error.code, denied);
        assert.equal(r.dispatched, 'no');
        assert.equal(inputs(m).length, 0);
    }
});
test('moving target is rejected before dispatch', async () => { const m = await setup(); m.moved = true; const r = await m.adapter.execute(request(m)); assert.equal(r.error.code, 'NOT_ACTIONABLE'); assert.equal(inputs(m).length, 0); });
test('focus loss during replacement stops typing and poisons further actions', async () => {
    const m = await setup();
    m.onInput = (method, p) => {
        if (p.type === 'mouseReleased')
            m.denied = 'NOT_ACTIONABLE';
    };
    const r = await m.adapter.execute(request(m, 'fill', { value: 'new' }));
    assert.equal(r.dispatched, 'yes');
    assert.equal(r.verified, 'unknown');
    assert.ok(!inputs(m).some(c => c.method === 'Input.insertText'));
    const next = await m.adapter.execute(request(m));
    assert.equal(next.error.code, 'OUTCOME_UNKNOWN');
});
test('expected condition alone establishes response and verification', async () => { const m = await setup(); const r = await m.adapter.execute({ ...request(m), expected }); assert.equal(r.verified, 'passed'); assert.equal(r.responded, 'yes'); assert.ok(r.evidence.length); });
test('unrelated mutations do not make false conditions pass', async () => { const m = await setup(); m.status = 'failed'; const r = await m.adapter.execute({ ...request(m), timeoutMs: 160, expected }); assert.equal(r.verified, 'failed'); assert.equal(r.error.code, 'TIMEOUT'); assert.equal(r.responded, 'unknown'); });
test('pre-abort emits no input', async () => { const m = await setup(), c = new AbortController(); c.abort(); const r = await m.adapter.execute(request(m), c.signal); assert.equal(r.error.code, 'ABORTED'); assert.equal(r.dispatched, 'no'); assert.equal(inputs(m).length, 0); });
test('timeout on an unacknowledged input is unknown and never retried', async () => { const m = await setup(); m.hang = true; const req = { ...request(m), timeoutMs: 100 }; const first = await m.adapter.execute(req); assert.equal(first.dispatched, 'unknown'); assert.equal(first.error.code, 'TIMEOUT'); const count = inputs(m).length; assert.deepEqual(await m.adapter.execute(req), first); assert.equal(inputs(m).length, count); await m.adapter.dispose(); });
test('disconnect while dispatching is unknown and error text is sanitized', async () => { const m = await setup(); m.fault = 'private secret'; const r = await m.adapter.execute(request(m)); assert.equal(r.dispatched, 'unknown'); assert.equal(r.error.message, 'DISCONNECTED'); assert.ok(!JSON.stringify(r).includes('private secret')); });
test('same ID deduplicates concurrent actions and mismatched payload is rejected', async () => { const m = await setup(), req = request(m); const [a, b] = await Promise.all([m.adapter.execute(req), m.adapter.execute(req)]); assert.deepEqual(a, b); assert.equal(inputs(m).length, 2); await assert.rejects(m.adapter.execute({ ...req, action: { kind: 'scroll', direction: 'down', pixels: 10 } }), { code: 'POLICY_DENIED' }); });
test('navigation origin denied before send, scrolling uses wheel', async () => { const m = await setup(); const bad = request(m, 'navigate'); bad.action.url = 'https://evil.test'; assert.equal((await m.adapter.execute(bad)).error.code, 'PERMISSION_DENIED'); assert.ok(!m.calls.some(c => c.method === 'Page.navigate')); const r = await m.adapter.execute(request(m, 'scroll')); assert.equal(r.dispatched, 'yes'); assert.equal(inputs(m).at(-1).params.type, 'mouseWheel'); });
test('execute snapshots validated input before queueing', async () => { const m = await setup(), req = request(m, 'fill', { value: 'original' }), promise = m.adapter.execute(req); req.action.value = 'changed'; await promise; assert.equal(inputs(m).at(-1).params.text, 'original'); });
function dom() {
    const el = { localName: 'input', type: 'text', value: 'hello', parentElement: null, hasAttribute: () => false, getAttribute: () => null, getRootNode: () => doc, getBoundingClientRect: () => ({ left: 10, right: 110, top: 10, bottom: 30, width: 100, height: 20 }), focus() { doc.activeElement = el; } };
    const doc = { activeElement: null, defaultView: { ShadowRoot: class {
            }, innerWidth: 1280, innerHeight: 720, getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1', pointerEvents: 'auto' }) }, elementFromPoint: () => el };
    const m = { el, doc, summary: { ref: 'r', enabled: true, editable: true, sensitive: false }, snapshot: { observationId: 'o', documentId: 'd', frameId: 'f', url: 'https://example.test/', capturedAt: new Date().toISOString(), elements: [], text: 'saved', truncated: false }, target: { documentId: 'd', frameId: 'f', observationId: 'o', ref: 'r' } };
    m.c = createDocumentController(doc, { resolve: () => el, inspect: () => m.summary, snapshot: () => m.snapshot });
    return m;
}
test('DOM checks hit-testing, focus, readonly and sensitive fields independently', () => { const m = dom(); assert.equal(m.c.prepare(m.target, 'fill', false, true).x, 60); m.doc.elementFromPoint = () => ({ parentElement: null, getRootNode: () => m.doc }); assert.throws(() => m.c.prepare(m.target, 'click'), { code: 'NOT_ACTIONABLE' }); m.doc.elementFromPoint = () => m.el; m.summary.sensitive = true; assert.throws(() => m.c.prepare(m.target, 'click'), { code: 'POLICY_DENIED' }); m.summary.sensitive = false; m.summary.editable = false; assert.throws(() => m.c.prepare(m.target, 'fill'), { code: 'UNSUPPORTED_CAPABILITY' }); });
test('truncation cannot prove absence; duplicate semantic matches are ambiguous', () => { const m = dom(), condition = { kind: 'element', role: 'button', name: 'Save', state: 'absent' }; m.snapshot.truncated = true; assert.equal(m.c.check([condition]).status, 'unknown'); m.snapshot.elements = [{ role: 'button', name: 'Save' }, { role: 'button', name: 'Save' }]; assert.throws(() => m.c.check([condition]), { code: 'AMBIGUOUS_TARGET' }); });
test('value verification returns a marker and refuses sensitive fields', () => { const m = dom(), condition = { kind: 'value', target: m.target, equals: 'hello' }; const v = m.c.check([condition]); assert.equal(v.status, 'passed'); assert.equal(v.conditions[0].evidence[0].actual, 'matched'); m.summary.sensitive = true; assert.throws(() => m.c.check([condition]), { code: 'POLICY_DENIED' }); });
test('abort after mouse release sends no replacement keys', async () => {
    const m = await setup(), c = new AbortController();
    m.onInput = (method, p) => {
        if (p.type === 'mouseReleased')
            c.abort();
    };
    const r = await m.adapter.execute(request(m, 'fill', { value: 'never' }), c.signal);
    assert.equal(r.error.code, 'ABORTED');
    assert.equal(r.verified, 'unknown');
    assert.ok(!inputs(m).some(c => c.method === 'Input.insertText' || c.method === 'Input.dispatchKeyEvent'));
});
test('bounded ID cache refuses new actions without evicting old IDs', async () => {
    const m = await setup();
    const first = request(m, 'scroll');
    await m.adapter.execute(first);
    for (let i = 1; i < 256; i++)
        await m.adapter.execute(request(m, 'scroll'));
    const n = inputs(m).length;
    await assert.rejects(m.adapter.execute(request(m, 'scroll')), { code: 'BUDGET_EXCEEDED' });
    await m.adapter.execute(first);
    assert.equal(inputs(m).length, n);
});
test('dispose cancels a pending transport call and rejects queued work', async () => { const m = await setup(); m.hang = true; let notify; const pending = new Promise(r => notify = r); m.onInput = () => notify(); const run = m.adapter.execute(request(m)); await pending; const close = m.adapter.dispose(); const result = await run; assert.equal(result.error.code, 'DISCONNECTED'); assert.equal(result.dispatched, 'unknown'); await close; await assert.rejects(m.adapter.observe(), { code: 'DISCONNECTED' }); });

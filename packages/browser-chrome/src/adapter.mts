import type { PolicyContext } from '@wisp/protocol';
export type ChromeControlledAdapter = BrowserAdapter & {
    readPolicyContext(request: ActionRequest, signal?: AbortSignal): Promise<PolicyContext>;
};
import { parseActionRequest, parseCondition, parseActionResult, parseVerification, parseCapabilities } from '@wisp/protocol';
import type { BrowserAdapter, ActionRequest, ActionResult, Condition, Verification, ErrorCode, Target } from '@wisp/protocol';
import { createChromeBridge, ObserverError } from './chrome.mts';
import type { CdpTransport } from './chrome.mts';
import type { PreparedTarget } from './control-document.mts';
export function createChromeAdapter(transport: CdpTransport, options: {
    allowedOrigins: readonly string[];
}): ChromeControlledAdapter {
    const raw = transport;
    transport = { send(method, params, signal) {
            return new Promise((resolve, reject) => {
                if (signal?.aborted)
                    return reject(signal.reason);
                const abort = () => reject(signal?.reason || new ObserverError('ABORTED'));
                signal?.addEventListener('abort', abort, { once: true });
                const timer = signal ? undefined : setTimeout(() => reject(new ObserverError('DISCONNECTED')), 1000);
                Promise.resolve().then(() => {
                    if (signal?.aborted)
                        throw signal.reason;
                    return raw.send(method, params, signal);
                }).then(resolve, reject).finally(() => {
                    if (timer)
                        clearTimeout(timer);
                    signal?.removeEventListener('abort', abort);
                });
            });
        } };
    const bridge = createChromeBridge(transport, options), origins = new Set(options.allowedOrigins), cache = new Map<string, {
        payload: string;
        promise: Promise<ActionResult>;
    }>();
    let disposed = false, uncertain = false, tail: Promise<unknown> = Promise.resolve();
    const life = new AbortController();
    function serial<T>(fn: () => Promise<T>) { const result = tail.then(fn); tail = result.then(() => undefined, () => undefined); return result; }
    function active() {
        if (disposed)
            throw new ObserverError('DISCONNECTED');
        if (uncertain)
            throw new ObserverError('OUTCOME_UNKNOWN');
    }
    function code(error: unknown): ErrorCode {
        const value = error as {
            code?: ErrorCode;
        };
        return value?.code && ['STALE_TARGET', 'NOT_ACTIONABLE', 'UNSUPPORTED_CAPABILITY', 'PERMISSION_DENIED', 'POLICY_DENIED', 'TIMEOUT', 'ABORTED', 'OUTCOME_UNKNOWN', 'BUDGET_EXCEEDED', 'DISCONNECTED', 'AMBIGUOUS_TARGET'].includes(value.code) ? value.code : 'DISCONNECTED';
    }
    function scope(signal: AbortSignal | undefined, timeoutMs: number) {
        const c = new AbortController(), external = () => c.abort(new ObserverError('ABORTED')), shutdown = () => c.abort(new ObserverError('DISCONNECTED'));
        signal?.addEventListener('abort', external, { once: true });
        life.signal.addEventListener('abort', shutdown, { once: true });
        if (signal?.aborted)
            external();
        if (life.signal.aborted)
            shutdown();
        const timer = setTimeout(() => c.abort(new ObserverError('TIMEOUT')), timeoutMs);
        function check() {
            if (c.signal.aborted)
                throw c.signal.reason;
        }
        async function run<T>(fn: () => Promise<T>): Promise<T> { check(); return new Promise((resolve, reject) => { const abort = () => reject(c.signal.reason); c.signal.addEventListener('abort', abort, { once: true }); Promise.resolve().then(() => { check(); return fn(); }).then(resolve, reject).finally(() => c.signal.removeEventListener('abort', abort)); }); }
        return { signal: c.signal, check, run, close() { clearTimeout(timer); signal?.removeEventListener('abort', external); life.signal.removeEventListener('abort', shutdown); } };
    }
    async function frame(s: ReturnType<typeof scope>) {
        const result = await s.run(() => transport.send('Page.getFrameTree', {}, s.signal)) as {
            frameTree?: {
                frame?: {
                    id?: string;
                    loaderId?: string;
                    url?: string;
                };
            };
        };
        const f = result?.frameTree?.frame;
        if (!f || !f.id || !f.loaderId || !f.url)
            throw new ObserverError('DISCONNECTED');
        if (!origins.has(new URL(f.url).origin))
            throw new ObserverError('PERMISSION_DENIED');
        return f;
    }
    function same(a: PreparedTarget, b: PreparedTarget) { return ['x', 'y', 'width', 'height'].every(key => Math.abs(a[key as keyof PreparedTarget] - b[key as keyof PreparedTarget]) <= 1); }
    async function execute(request: ActionRequest, signal?: AbortSignal): Promise<ActionResult> {
        const result: ActionResult = { actionId: request.actionId, dispatched: 'no', responded: 'unknown', verified: 'not_checked', evidence: [] };
        const s = scope(signal, request.timeoutMs);
        let started = false, inFlight = false, completed = false, mouse = false, held: Record<string, unknown> | undefined;
        async function input(method: string, params: Record<string, unknown>) { s.check(); started = true; inFlight = true; const reply = await s.run(() => transport.send(method, params, s.signal)); inFlight = false; result.dispatched = 'yes'; return reply; }
        async function release() {
            if (mouse) {
                mouse = false;
                await Promise.race([transport.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: -1, y: -1, button: 'left', clickCount: 1 }).catch(() => { }), new Promise(r => setTimeout(r, 100))]);
            }
            if (held) {
                const params = held;
                held = undefined;
                await Promise.race([transport.send('Input.dispatchKeyEvent', { ...params, type: 'keyUp', modifiers: 0 }).catch(() => { }), new Promise(r => setTimeout(r, 100))]);
            }
        }
        try {
            active();
            s.check();
            const initial = await frame(s), action = request.action;
            let base: PreparedTarget | undefined;
            const target = 'target' in action ? action.target : undefined;
            async function guard(focused = false) {
                s.check();
                const current = await frame(s);
                if (current.id !== initial.id || current.loaderId !== initial.loaderId)
                    throw new ObserverError('STALE_TARGET');
                if (target) {
                    const point = await s.run(() => bridge.prepare(target, action.kind, focused, s.signal));
                    if (base && !same(base, point))
                        throw new ObserverError('NOT_ACTIONABLE');
                    return point;
                }
                return undefined;
            }
            if (target) {
                base = await guard();
                await s.run(() => new Promise<void>(resolve => setTimeout(resolve, 50)));
                await guard();
            }
            async function click() { const p = (await guard())!; mouse = true; await input('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 }); await guard(); await input('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 }); mouse = false; }
            async function key(value: string, focused = true) {
                await guard(focused);
                const shortcuts: Record<string, number> = { 'Control+A': 2, 'Meta+A': 4 };
                const modifier = shortcuts[value] || 0, k = modifier ? 'a' : value;
                const codes: Record<string, [
                    string,
                    number
                ]> = { Enter: ['Enter', 13], Tab: ['Tab', 9], Escape: ['Escape', 27], Backspace: ['Backspace', 8], Delete: ['Delete', 46], ArrowLeft: ['ArrowLeft', 37], ArrowUp: ['ArrowUp', 38], ArrowRight: ['ArrowRight', 39], ArrowDown: ['ArrowDown', 40], Home: ['Home', 36], End: ['End', 35], PageUp: ['PageUp', 33], PageDown: ['PageDown', 34], a: ['KeyA', 65] };
                const [keyCode, virtual] = codes[k]!;
                held = { key: k, code: keyCode, windowsVirtualKeyCode: virtual };
                await input('Input.dispatchKeyEvent', { ...held, type: 'keyDown', modifiers: modifier, ...(k === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {}) });
                await input('Input.dispatchKeyEvent', { ...held, type: 'keyUp', modifiers: 0 });
                held = undefined;
            }
            if (action.kind === 'navigate') {
                if (!origins.has(new URL(action.url).origin))
                    throw new ObserverError('PERMISSION_DENIED');
                await guard();
                const reply = await input('Page.navigate', { url: action.url }) as {
                    errorText?: string;
                };
                if (reply?.errorText)
                    throw new ObserverError('DISCONNECTED');
            }
            else if (action.kind === 'scroll') {
                await guard();
                await input('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 1, y: 1, deltaX: 0, deltaY: action.direction === 'down' ? action.pixels : -action.pixels });
            }
            else if (action.kind === 'click')
                await click();
            else if (action.kind === 'selectOption') {
                await guard(); started=true; inFlight=true;
                const selected=await s.run(()=>bridge.selectOption(action.target,action.value,s.signal));
                inFlight=selected.dispatched==='unknown';result.dispatched=selected.dispatched;
                if(selected.dispatched==='no')started=false;
                if(selected.code)throw new ObserverError(code({code:selected.code}));
                const verification=await bridge.check([{kind:'value',target:action.target,equals:action.value}],s.signal);
                result.verified=verification.status;result.evidence=verification.conditions.flatMap(c=>c.evidence);
                if(verification.status!=='passed')throw new ObserverError('NOT_ACTIONABLE');
                result.responded='yes';
            }
            else if (action.kind === 'fill') {
                await click();
                await key('Control+A');
                await key('Backspace');
                if (action.value) {
                    await guard(true);
                    await input('Input.insertText', { text: action.value });
                }
            }
            else {
                await guard();
                await s.run(() => bridge.prepare(action.target, action.kind, false, s.signal, true));
                await guard(true);
                await key(action.key);
            }
            completed = true;
            if (request.expected?.length) {
                result.verified = 'unknown';
                for (;;) {
                    s.check();
                    const verification = await s.run(() => bridge.check(request.expected!, s.signal));
                    result.verified = verification.status;
                    result.evidence = verification.conditions.flatMap(c => c.evidence);
                    if (verification.status === 'passed') {
                        result.responded = 'yes';
                        break;
                    }
                    await s.run(() => new Promise<void>(resolve => setTimeout(resolve, 50)));
                }
            }
        }
        catch (error) {
            const c = code(error);
            if (inFlight) {
                result.dispatched = 'unknown';
                uncertain = true;
            }
            else if (started && !completed) {
                result.verified = 'unknown';
                uncertain = true;
            }
            if (started && !completed)
                result.verified = 'unknown';
            result.error = { code: c, message: c, retryable: !started && ['STALE_TARGET', 'NOT_ACTIONABLE'].includes(c) };
        }
        finally {
            await release();
            s.close();
        }
        return parseActionResult(result);
    }
    return {
        readPolicyContext(request, signal) { const parsed = parseActionRequest(request); return serial(async () => { active(); const s = scope(signal, 10000); try {
            return await s.run(() => bridge.context(parsed, s.signal));
        }
        finally {
            s.close();
        } }); },
        async capabilities() { return parseCapabilities({ version: '0.1', actions: ['click', 'fill', 'pressKey', 'scroll', 'navigate', 'selectOption'], frames: 'main', shadowDOM: 'open' }); },
        observe(signal) {
            return serial(async () => {
                active();
                const s = scope(signal, 10000);
                try {
                    return await s.run(() => bridge.observe({}, s.signal));
                }
                finally {
                    s.close();
                }
            });
        },
        execute(value, signal) {
            const request = parseActionRequest(value), payload = JSON.stringify(request), known = cache.get(request.actionId);
            if (known) {
                if (known.payload !== payload)
                    return Promise.reject(new ObserverError('POLICY_DENIED'));
                return known.promise;
            }
            if (cache.size >= 256)
                return Promise.reject(new ObserverError('BUDGET_EXCEEDED'));
            const promise = serial(() => execute(request, signal));
            cache.set(request.actionId, { payload, promise });
            return promise;
        },
        verify(conditions, signal) {
            if (!Array.isArray(conditions) || conditions.length < 1 || conditions.length > 16)
                return Promise.reject(new ObserverError('BUDGET_EXCEEDED'));
            const parsed = conditions.map(parseCondition);
            return serial(async () => {
                active();
                const s = scope(signal, 10000);
                try {
                    return parseVerification(await s.run(() => bridge.check(parsed, s.signal)));
                }
                finally {
                    s.close();
                }
            });
        },
        async dispose() {
            if (disposed)
                return;
            disposed = true;
            life.abort();
            await tail;
            await bridge.dispose();
            cache.clear();
        },
    };
}

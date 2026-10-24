import { parseActionRequest, parsePolicyContext } from '@wisp/protocol';
import type { ActionRequest, PolicyContext } from '@wisp/protocol';
import { createDocumentController } from './control-document.mts';
import type { PreparedTarget } from './control-document.mts';
import { parseCondition, parseVerification } from '@wisp/protocol';
import type { Condition, Verification } from '@wisp/protocol';
import { parseObservation, parseElement, parseTarget } from '@wisp/protocol';
import type { Observation, ElementSummary, Target, ErrorCode } from '@wisp/protocol';
import { createDocumentObserver } from './document.mts';
import type { ObservationOptions } from './document.mts';
import { createReferenceRegistry } from './references.mts';
import { createSanitizer } from './sanitize.mts';
export type CdpTransport = {
    send(method: string, params?: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>;
};
export type ChromeObserver = {
    observe(options?: ObservationOptions, signal?: AbortSignal): Promise<Observation>;
    inspect(target: Target, signal?: AbortSignal): Promise<ElementSummary>;
    dispose(): Promise<void>;
};
export class ObserverError extends Error {
    readonly code: ErrorCode;
    constructor(code: ErrorCode) { super(code); this.code = code; this.name = 'ObserverError'; }
}
export function createChromeBridge(transport: CdpTransport, { allowedOrigins }: {
    allowedOrigins: readonly string[];
}): ChromeObserver & {
    context(request: ActionRequest, signal?: AbortSignal): Promise<PolicyContext>;
    prepare(target: Target, kind: string, focused?: boolean, signal?: AbortSignal, focus?: boolean): Promise<PreparedTarget>;
    check(conditions: Condition[], signal?: AbortSignal): Promise<Verification>;
    selectOption(target: Target, value: string, signal?: AbortSignal): Promise<{dispatched:'yes'|'no'|'unknown';code?:string}>;
} {
    const origins = [...new Set(allowedOrigins)];
    if (!origins.length || origins.some(origin => {
        try {
            const url = new URL(origin);
            return !['http:', 'https:'].includes(url.protocol) || url.origin !== origin;
        }
        catch {
            return true;
        }
    }))
        throw new ObserverError('PERMISSION_DENIED');
    const key = 'wisp_' + crypto.randomUUID();
    let state: {
        frameId: string;
        loaderId: string;
        contextId: number;
        documentId: string;
    } | undefined, disposed = false;
    let tail: Promise<unknown> = Promise.resolve();
    function abort(signal?: AbortSignal) {
        if (signal?.aborted)
            throw new ObserverError('ABORTED');
    }
    function active(signal?: AbortSignal) {
        if (disposed)
            throw new ObserverError('DISCONNECTED');
        abort(signal);
    }
    async function send(method: string, params: Record<string, unknown> = {}, signal?: AbortSignal) {
        abort(signal);
        let value: unknown;
        try {
            value = await transport.send(method, params, signal);
        }
        catch (error) {
            abort(signal);
            if (/Cannot find context with specified id|Execution context was destroyed/.test(error instanceof Error ? error.message : '')) {
                state = undefined;
                throw new ObserverError('STALE_TARGET');
            }
            throw new ObserverError('DISCONNECTED');
        }
        abort(signal);
        return value;
    }
    function record(v: unknown): Record<string, unknown> {
        if (!v || typeof v !== 'object' || Array.isArray(v))
            throw new ObserverError('DISCONNECTED');
        return v as Record<string, unknown>;
    }
    async function frame(signal?: AbortSignal) {
        const tree = record(await send('Page.getFrameTree', {}, signal)), frame = record(record(tree.frameTree).frame);
        if (typeof frame.id !== 'string' || typeof frame.loaderId !== 'string' || typeof frame.url !== 'string')
            throw new ObserverError('DISCONNECTED');
        let origin: string;
        try {
            origin = new URL(frame.url).origin;
        }
        catch {
            throw new ObserverError('UNSUPPORTED_CAPABILITY');
        }
        if (!origins.includes(origin))
            throw new ObserverError('PERMISSION_DENIED');
        return { frameId: frame.id, loaderId: frame.loaderId };
    }
    async function evaluate(expression: string, contextId: number, signal?: AbortSignal) {
        const source = '(async()=>{try{return {ok:true,value:await (' + expression + ')}}catch(error){return {ok:false,code:typeof error.code==="string"?error.code:"DISCONNECTED"}}})()';
        const response = record(await send('Runtime.evaluate', { expression: source, contextId, returnByValue: true, awaitPromise: true }, signal));
        if (response.exceptionDetails)
            throw new ObserverError('DISCONNECTED');
        const envelope = record(record(response.result).value);
        if (envelope.ok !== true) {
            const code = envelope.code;
            if (['STALE_TARGET', 'PERMISSION_DENIED', 'DISCONNECTED', 'BUDGET_EXCEEDED', 'NOT_ACTIONABLE', 'POLICY_DENIED', 'UNSUPPORTED_CAPABILITY', 'AMBIGUOUS_TARGET'].includes(String(code)))
                throw new ObserverError(code as ErrorCode);
            throw new ObserverError('DISCONNECTED');
        }
        return envelope.value;
    }
    async function ensure(signal?: AbortSignal) {
        const current = await frame(signal);
        if (state && state.frameId === current.frameId && state.loaderId === current.loaderId)
            return state;
        state = undefined;
        const world = record(await send('Page.createIsolatedWorld', { frameId: current.frameId, worldName: 'wisp-observer' }, signal));
        if (!Number.isInteger(world.executionContextId))
            throw new ObserverError('DISCONNECTED');
        const contextId = world.executionContextId as number;
        const context = { documentId: crypto.randomUUID(), frameId: current.frameId, allowedOrigins: origins };
        const install = '(globalThis.__wispObserverSlot&&(globalThis[globalThis.__wispObserverSlot]?.dispose(),delete globalThis[globalThis.__wispObserverSlot]),globalThis.__wispObserverSlot='+JSON.stringify(key)+',globalThis[' + JSON.stringify(key) + ']?.dispose(),globalThis[' + JSON.stringify(key) + ']=(' + createDocumentObserver.toString() + ')(document,' + JSON.stringify(context) + ',(' + createReferenceRegistry.toString() + '),(' + createSanitizer.toString() + ')),globalThis[' + JSON.stringify(key) + '].control=(' + createDocumentController.toString() + ')(document,globalThis[' + JSON.stringify(key) + ']),true)';
        await evaluate(install, contextId, signal);
        state = { ...current, contextId, documentId: context.documentId };
        return state;
    }
    function serial<T>(operation: () => Promise<T>): Promise<T> { const result = tail.then(operation); tail = result.then(() => undefined, () => undefined); return result; }
    return {
        observe(options = {}, signal) {
            return serial(async () => {
                active(signal);
                const current = await ensure(signal);
                const value = await evaluate('globalThis[' + JSON.stringify(key) + '].observe(' + JSON.stringify(options) + ')', current.contextId, signal);
                const result = parseObservation(value);
                if (result.documentId !== current.documentId || result.frameId !== current.frameId)
                    throw new ObserverError('STALE_TARGET');
                return result;
            });
        },
        inspect(target, signal) {
            return serial(async () => {
                active(signal);
                const parsed = parseTarget(target), current = await frame(signal);
                if (!state || state.frameId !== current.frameId || state.loaderId !== current.loaderId) {
                    state = undefined;
                    throw new ObserverError('STALE_TARGET');
                }
                const value = await evaluate('globalThis[' + JSON.stringify(key) + '].inspect(' + JSON.stringify(parsed) + ')', state.contextId, signal);
                const result = parseElement(value);
                if (result.ref !== parsed.ref)
                    throw new ObserverError('STALE_TARGET');
                return result;
            });
        },
        context(request, signal) { return serial(async () => { active(signal); const parsed = parseActionRequest(request); let current; if ('target' in parsed.action) {
            const f = await frame(signal);
            if (!state || state.frameId !== f.frameId || state.loaderId !== f.loaderId)
                throw new ObserverError('STALE_TARGET');
            current = state;
        }
        else
            current = await ensure(signal); const value = parsePolicyContext(await evaluate('globalThis[' + JSON.stringify(key) + '].control.context(' + JSON.stringify(parsed) + ')', current.contextId, signal)); const after = await frame(signal); if (after.frameId !== current.frameId || after.loaderId !== current.loaderId || value.documentId !== current.documentId || value.frameId !== current.frameId)
            throw new ObserverError('STALE_TARGET'); return value; }); },
        prepare(target, kind, focused = false, signal, focus = false) {
            return serial(async () => {
                active(signal);
                const parsed = parseTarget(target), current = await frame(signal);
                if (!state || state.frameId !== current.frameId || state.loaderId !== current.loaderId)
                    throw new ObserverError('STALE_TARGET');
                const value = record(await evaluate('globalThis[' + JSON.stringify(key) + '].control.prepare(' + JSON.stringify(parsed) + ',' + JSON.stringify(kind) + ',' + JSON.stringify(focused) + ',' + JSON.stringify(focus) + ')', state.contextId, signal));
                if (['x', 'y', 'width', 'height'].some(k => typeof value[k] !== 'number' || !Number.isFinite(value[k])))
                    throw new ObserverError('DISCONNECTED');
                return value as PreparedTarget;
            });
        },
        selectOption(target,value,signal) { return serial(async()=>{active(signal);const parsed=parseTarget(target),current=await frame(signal);if(!state || state.frameId!==current.frameId || state.loaderId!==current.loaderId)throw new ObserverError('STALE_TARGET');const result=record(await evaluate('globalThis['+JSON.stringify(key)+'].control.selectOption('+JSON.stringify(parsed)+','+JSON.stringify(value)+')',state.contextId,signal));if(!['yes','no','unknown'].includes(String(result.dispatched)))throw new ObserverError('DISCONNECTED');return result as {dispatched:'yes'|'no'|'unknown';code?:string};}); },
        check(conditions, signal) { return serial(async () => { active(signal); const parsed = conditions.map(parseCondition), current = await ensure(signal); return parseVerification(await evaluate('globalThis[' + JSON.stringify(key) + '].control.check(' + JSON.stringify(parsed) + ')', current.contextId, signal)); }); },
        async dispose() {
            if (disposed)
                return;
            disposed = true;
            await tail;
            if (state) {
                try {
                    await evaluate('(globalThis[' + JSON.stringify(key) + ']?.dispose(),delete globalThis['+JSON.stringify(key)+'],globalThis.__wispObserverSlot==='+JSON.stringify(key)+'?delete globalThis.__wispObserverSlot:false)', state.contextId);
                }
                catch { }
                state = undefined;
            }
        },
    };
}
export function createChromeObserver(transport: CdpTransport, options: {
    allowedOrigins: readonly string[];
}): ChromeObserver { const bridge = createChromeBridge(transport, options); return { observe: bridge.observe, inspect: bridge.inspect, dispose: bridge.dispose }; }

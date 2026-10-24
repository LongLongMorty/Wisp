import { parseActionRequest, parsePolicyContext, parseRequest, parseConfirmation } from '@wisp/protocol';
import type { ActionRequest, PolicyContext, BrowserAdapter, ConfirmationRequest, ActionResult, ErrorCode } from '@wisp/protocol';
export class PolicyError extends Error {
    readonly code: ErrorCode;
    constructor(code: ErrorCode) { super(code); this.name = 'PolicyError'; this.code = code; }
}
export type PolicyKind = 'allow' | 'confirm' | 'handoff' | 'deny';
export type PolicyRule = {
    origin: string;
    path: string;
    kind: ActionRequest['action']['kind'];
    role?: string;
    name?: string;
    decision: PolicyKind;
};
export type PolicyDecision = {
    kind: Exclude<PolicyKind, 'allow'>;
    reason: string;
    confirmation?: ConfirmationRequest;
};
export type GatewayResult = PolicyDecision | {
    kind: 'executed';
    result: ActionResult;
};
export type UiSender = {
    id?: string;
    url?: string;
    origin?: string;
    frameId?: number;
    documentId?: string;
    documentLifecycle?: string;
    tlsChannelId?: string;
    tab?: unknown;
};
export type PolicyGateway = {
    validateConfirmation(message:unknown,sender:UiSender):Extract<ReturnType<typeof parseRequest>,{type:'run.confirm'}>;
    grantOrigin(origin: string, sender: UiSender): void;
    revokeOrigin(origin: string, sender: UiSender): void;
    submit(runId: string, request: ActionRequest, signal?: AbortSignal): Promise<GatewayResult>;
    confirm(message: unknown, sender: UiSender, signal?: AbortSignal): Promise<GatewayResult>;
    observe(signal?: AbortSignal): ReturnType<BrowserAdapter['observe']>;
    verify: BrowserAdapter['verify'];
    dispose(): Promise<void>;
};
function fail(code: ErrorCode): never { throw new PolicyError(code); }
function exactOrigin(value: string) {
    try {
        const u = new URL(value);
        if (!['http:', 'https:'].includes(u.protocol) || u.origin !== value || u.hostname.includes('*'))
            fail('PERMISSION_DENIED');
        return value;
    }
    catch {
        fail('PERMISSION_DENIED');
    }
}
function canonical(v: unknown): string {
    if (v === null || typeof v !== 'object')
        return JSON.stringify(v);
    if (Array.isArray(v))
        return '[' + v.map(canonical).join(',') + ']';
    return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical((v as Record<string, unknown>)[k])).join(',') + '}';
}
async function sha(v: unknown) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(v))))].map(n => n.toString(16).padStart(2, '0')).join(''); }
export function classifyPolicy(request: ActionRequest, context: PolicyContext, allowed: ReadonlySet<string>, rules: readonly PolicyRule[] = []): {
    kind: PolicyKind;
    reason: string;
} {
    const action = request.action, target = context.target;
    if (!allowed.has(context.origin))
        return { kind: 'deny', reason: 'ORIGIN_NOT_GRANTED' };
    if (action.kind === 'navigate' && !allowed.has(new URL(action.url).origin) || target?.destinationOrigins.some(origin => !allowed.has(origin)))
        return { kind: 'deny', reason: 'DESTINATION_NOT_GRANTED' };
    if ('target' in action && (!target || action.target.documentId !== context.documentId || action.target.frameId !== context.frameId || action.target.ref !== target.ref))
        return { kind: 'deny', reason: 'STALE_TARGET' };
    if (target?.newWindow)
        return { kind: 'deny', reason: 'UNSUPPORTED_WINDOW' };
    if (target && !target.enabled)
        return { kind: 'deny', reason: 'NOT_ACTIONABLE' };
    if (target?.sensitive || target?.formSensitive || target && /支付|付款|结账|验证码|授权|登录|密码|pay(?:ment)?|checkout|purchase|oauth|authoriz|credential|one-time-code|verification[ -]?code|sign[ -]?in|log[ -]?in|authenticat/i.test(target.name + ' ' + target.hint + ' ' + new URL(context.url).pathname))
        return { kind: 'handoff', reason: 'SENSITIVE_OPERATION' };
    if (target && !context.complete)
        return { kind: 'handoff', reason: 'INCOMPLETE_CONTEXT' };
    if (action.kind === 'fill' && (!target?.editable || !['input', 'textarea'].includes(target.tag) || target.tag === 'input' && !['text', 'search', 'email', 'url', 'tel'].includes(target.inputType)))
        return { kind: 'handoff', reason: 'UNSUPPORTED_INPUT' };
    if(action.kind==='selectOption' && (!target || target.tag!=='select' || target.inputType!=='select-one'))return {kind:'handoff',reason:'UNSUPPORTED_INPUT'};
    const matching = rules.filter(r => r.origin === context.origin && r.path === new URL(context.url).pathname && r.kind === action.kind && (r.role === undefined || r.role === target?.role) && (r.name === undefined || r.name === target?.name));
    const rank: Record<PolicyKind, number> = { allow: 0, confirm: 1, handoff: 2, deny: 3 };
    if (matching.length) {
        const rule = matching.reduce((a, b) => rank[a.decision] >= rank[b.decision] ? a : b);
        return { kind: rule.decision, reason: 'SITE_RULE' };
    }
    return ['scroll', 'navigate', 'fill'].includes(action.kind) ? { kind: 'allow', reason: 'SUPPORTED_LOCAL_ACTION' } : { kind: 'confirm', reason: 'UNKNOWN_OR_WRITE_ACTION' };
}
export function createPolicyGateway({ browser, readContext, extensionId, uiUrl, tabId, rules: inputRules = [], now = Date.now }: {
    browser: BrowserAdapter;
    readContext: (request: ActionRequest, signal?: AbortSignal) => Promise<PolicyContext>;
    extensionId: string;
    uiUrl: string;
    tabId: number;
    rules?: readonly PolicyRule[];
    now?: () => number;
}): PolicyGateway {
    if (!/^[a-p]{32}$/.test(extensionId) || !Number.isSafeInteger(tabId) || tabId < 0 || uiUrl !== 'chrome-extension://' + extensionId + '/sidepanel.html')
        fail('PERMISSION_DENIED');
    if (!Array.isArray(inputRules) || inputRules.length > 128)
        fail('BUDGET_EXCEEDED');
    const rules = inputRules.map(r => {
        if (!r || Object.keys(r).some(k => !['origin', 'path', 'kind', 'role', 'name', 'decision'].includes(k)) || !['allow', 'confirm', 'handoff', 'deny'].includes(r.decision) || !['click', 'fill', 'pressKey', 'scroll', 'navigate', 'selectOption'].includes(r.kind) || typeof r.path !== 'string' || !r.path.startsWith('/') || r.path.length > 4096 || r.role !== undefined && (typeof r.role !== 'string' || r.role.length > 128) || r.name !== undefined && (typeof r.name !== 'string' || r.name.length > 1024))
            fail('POLICY_DENIED');
        return { ...r, origin: exactOrigin(r.origin) };
    });
    if (rules.length > 128)
        fail('BUDGET_EXCEEDED');
    const grants = new Set<string>(), records = new Map<string, {
        runId: string;
        payload: string;
        promise: Promise<GatewayResult>;
    }>(), pending = new Map<string, {
        runId: string;
        request: ActionRequest;
        context: PolicyContext;
        revision: number;
        issued: number;
        confirmation: ConfirmationRequest;
        requestSignal: AbortSignal | undefined;
    }>();
    const life = new AbortController();
    let revision = 0, disposed = false, issuedCount = 0, tail: Promise<unknown> = Promise.resolve();
    function active(signal?: AbortSignal) {
        if (disposed)
            fail('DISCONNECTED');
        if (signal?.aborted)
            fail('ABORTED');
    }
    function sender(value: UiSender) {
        active();
        if (!value || typeof value !== 'object' || Object.keys(value).some(k => !['id', 'url', 'origin', 'frameId', 'documentId', 'documentLifecycle', 'tlsChannelId'].includes(k)) || value.id !== extensionId || value.url !== uiUrl || value.origin !== undefined && value.origin !== 'chrome-extension://' + extensionId || value.frameId !== undefined && value.frameId !== 0)
            fail('PERMISSION_DENIED');
    }
    function validTime(issued: number) { const time = now(); return Number.isFinite(time) && time >= issued && time < issued + 30000; }
    function serial<T>(fn: () => Promise<T>) { const p = tail.then(fn); tail = p.then(() => undefined, () => undefined); return p; }
    async function scoped<T>(signal: AbortSignal | undefined, fn: (s: AbortSignal) => Promise<T>): Promise<T> {
        active(signal);
        const c = new AbortController(), abort = () => c.abort();
        signal?.addEventListener('abort', abort, { once: true });
        life.signal.addEventListener('abort', abort, { once: true });
        const timer = setTimeout(abort, 30000);
        try {
            return await new Promise<T>((resolve, reject) => { const stop = () => reject(new PolicyError(disposed ? 'DISCONNECTED' : signal?.aborted ? 'ABORTED' : 'TIMEOUT')); c.signal.addEventListener('abort', stop, { once: true }); Promise.resolve().then(() => { active(c.signal); return fn(c.signal); }).then(resolve, reject).finally(() => c.signal.removeEventListener('abort', stop)); });
        }
        finally {
            clearTimeout(timer);
            signal?.removeEventListener('abort', abort);
            life.signal.removeEventListener('abort', abort);
        }
    }
    async function context(request: ActionRequest, signal: AbortSignal) { active(signal); const c = parsePolicyContext(await readContext(structuredClone(request), signal)); active(signal); return c; }
    async function binding(runId: string, request: ActionRequest, c: PolicyContext, version: number) { return sha({ runId, tabId, request, revision: version, context: c }); }
    function checkVersion(version: number, signal: AbortSignal) {
        active(signal);
        if (version !== revision)
            fail('POLICY_DENIED');
    }
    async function dispatch(runId: string, request: ActionRequest, c: PolicyContext, version: number, signal: AbortSignal, approvedDigest?: string, issued?: number) {
        const current = await context(request, signal);
        checkVersion(version, signal);
        const classification = classifyPolicy(request, current, grants, rules);
        if (classification.kind === 'deny' || classification.kind === 'handoff')
            return classification as PolicyDecision;
        const digest = await binding(runId, request, current, version);
        if (digest !== (approvedDigest || await binding(runId, request, c, version)))
            fail('POLICY_DENIED');
        if (!approvedDigest && classification.kind !== 'allow')
            fail('POLICY_DENIED');
        checkVersion(version, signal);
        if (issued !== undefined && !validTime(issued))
            fail('POLICY_DENIED');
        return { kind: 'executed' as const, result: await browser.execute(structuredClone(request), signal) };
    }
    async function submit(runId: string, request: ActionRequest, signal: AbortSignal, requestSignal?: AbortSignal): Promise<GatewayResult> {
        const version = revision, c = await context(request, signal), decision = classifyPolicy(request, c, grants, rules);
        checkVersion(version, signal);
        if (decision.kind === 'allow')
            return dispatch(runId, request, c, version, signal);
        if (decision.kind !== 'confirm')
            return decision as PolicyDecision;
        for (const [id, p] of pending)
            if (now() >= p.issued + 30000 || now() < p.issued)
                pending.delete(id);
        if (pending.size >= 128 || issuedCount >= 256)
            fail('BUDGET_EXCEEDED');
        const issued = now();
        if (!Number.isFinite(issued))
            fail('POLICY_DENIED');
        const contextDigest = await binding(runId, request, c, version);
        checkVersion(version, signal);
        const displayParameters: Record<string, string> = { kind: request.action.kind };
        if (c.target)
            displayParameters.target = c.target.name;
        if (request.action.kind === 'fill' || request.action.kind === 'selectOption') {
            const value = request.action.value;
            for (let i = 0; i < Math.max(1, Math.ceil(value.length / 2048)); i++)
                displayParameters['value' + (i + 1)] = value.slice(i * 2048, (i + 1) * 2048);
        }
        if (request.action.kind === 'pressKey')
            displayParameters.key = request.action.key;
        if (request.action.kind === 'navigate')
            for (let i = 0; i < Math.ceil(request.action.url.length / 2048); i++)
                displayParameters['url' + (i + 1)] = request.action.url.slice(i * 2048, (i + 1) * 2048);
        if (request.action.kind === 'scroll') {
            displayParameters.direction = request.action.direction;
            displayParameters.pixels = String(request.action.pixels);
        }
        const confirmation = parseConfirmation({ confirmationId: crypto.randomUUID(), actionId: request.actionId, origin: c.origin, documentId: c.documentId, targetFingerprint: c.target?.fingerprint || c.documentDigest, contextDigest, summary: '确认 ' + request.action.kind + '：' + (c.target?.name || c.origin), displayParameters, expiresAt: new Date(issued + 30000).toISOString() });
        issuedCount++;
        pending.set(confirmation.confirmationId, { runId, request, context: c, revision: version, issued, confirmation, requestSignal });
        return { kind: 'confirm', reason: decision.reason, confirmation: structuredClone(confirmation) };
    }
    return {
        validateConfirmation(value,ui){sender(ui);const message=parseRequest(value,'ui');if(message.type!=='run.confirm')fail('POLICY_DENIED');return message},
        grantOrigin(origin, ui) {
            sender(ui);
            const value = exactOrigin(origin);
            if (!grants.has(value)) {
                if (grants.size >= 128)
                    fail('BUDGET_EXCEEDED');
                grants.add(value);
                revision++;
                pending.clear();
            }
        },
        revokeOrigin(origin, ui) { sender(ui); grants.delete(exactOrigin(origin)); revision++; pending.clear(); },
        submit(runId, value, signal) {
            active(signal);
            if (typeof runId !== 'string' || !runId.trim() || runId.length > 256)
                fail('POLICY_DENIED');
            const request = parseActionRequest(value), payload = canonical(request), known = records.get(request.actionId);
            if (known) {
                if (known.runId !== runId || known.payload !== payload)
                    return Promise.reject(new PolicyError('POLICY_DENIED'));
                return known.promise.then(structuredClone);
            }
            if (records.size >= 256)
                return Promise.reject(new PolicyError('BUDGET_EXCEEDED'));
            const promise = serial(() => scoped(signal, s => submit(runId, request, s, signal)));
            records.set(request.actionId, { runId, payload, promise });
            return promise.then(structuredClone);
        },
        confirm(value, ui, signal) {
            sender(ui);
            const message = parseRequest(value, 'ui');
            if (message.type !== 'run.confirm')
                return Promise.reject(new PolicyError('POLICY_DENIED'));
            const p = pending.get(message.payload.confirmationId);
            if (!p)
                return Promise.reject(new PolicyError('POLICY_DENIED'));
            pending.delete(message.payload.confirmationId);
            const record = records.get(p.request.actionId)!;
            const joined = p.requestSignal ? (signal ? AbortSignal.any([signal, p.requestSignal]) : p.requestSignal) : signal;
            const promise = serial(() => scoped(joined, async (s) => {
                if (p.runId !== message.runId || message.payload.decision === 'reject' || !validTime(p.issued) || p.revision !== revision)
                    fail('POLICY_DENIED');
                return dispatch(p.runId, p.request, p.context, p.revision, s, p.confirmation.contextDigest, p.issued);
            }));
            record.promise = promise;
            return promise.then(structuredClone);
        },
        observe(signal) {
            return serial(() => scoped(signal, async (s) => {
                const version = revision;
                const c = await context({ actionId: 'policy-observe', action: { kind: 'scroll', direction: 'down', pixels: 1 }, timeoutMs: 10000 }, s);
                if (!grants.has(c.origin))
                    fail('PERMISSION_DENIED');
                checkVersion(version, s);
                const observation = await browser.observe(s);
                checkVersion(version, s);
                if (!grants.has(new URL(observation.url).origin))
                    fail('PERMISSION_DENIED');
                return observation;
            }));
        },
        verify(conditions, signal) {
            return serial(() => scoped(signal, async (s) => {
                const version = revision;
                const c = await context({ actionId: 'policy-verify', action: { kind: 'scroll', direction: 'down', pixels: 1 }, timeoutMs: 10000 }, s);
                if (!grants.has(c.origin))
                    fail('PERMISSION_DENIED');
                checkVersion(version, s);
                const result = await browser.verify(conditions, s);
                checkVersion(version, s);
                return result;
            }));
        },
        async dispose() {
            if (disposed)
                return;
            disposed = true;
            life.abort();
            grants.clear();
            pending.clear();
            records.clear();
            await tail;
            await browser.dispose();
        },
    };
}

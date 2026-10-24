import { parseRunLimits, parseObservation, parseDecisionInput, parseModelResponse, parseExtractionResponse, parseVerification, parseUsage, parseCondition, ERROR_CODES } from '@wisp/protocol';
import type { RunLimits, JsonValue, Budget, ModelProvider, Observation, Decision, Usage } from '@wisp/protocol';
import { compileSchema } from '@wisp/models';
import type { StepReceipt } from './runtime.mts';
import type { Condition, Verification, RunResult } from '@wisp/protocol';
import { RuntimeError } from './store.mts';
import type { RuntimeStore, StoredRun } from './store.mts';
export type LoopState = {
    limits: Required<RunLimits>;
    budget: Budget;
    startedAt: number | null;
    schemaDigest: string;
    completionConditions?: Condition[];
    history: string[];
    fingerprint: string | null;
    usage: Usage;
    stopReason?: string;
};
class BudgetError extends RuntimeError {
    readonly counter: keyof Budget;
    constructor(counter: keyof Budget) { super('BUDGET_EXCEEDED'); this.counter = counter; }
}
function exceeded(counter: keyof Budget): never { throw new BudgetError(counter); }
export type LoopOptions = {
    modelFactory: (scope: {
        onAttempt: () => void;
        attemptLimit: 1 | 2;
    }) => ModelProvider;
    now?: () => number;
};
type BaseRuntime = {
    get(id: string): Promise<StoredRun>;
    scope(id: string): Promise<{
        generation: number;
        signal: AbortSignal;
    }>;
    observe(id: string, signal?: AbortSignal): Promise<Observation>;
    verify(id: string, conditions: Condition[], signal?: AbortSignal): Promise<Verification>;
    execute(id: string, value: import('@wisp/protocol').ActionRequest, signal?: AbortSignal): Promise<StepReceipt>;
    pause(id: string, reason?: 'USER_PAUSE' | 'NO_PROGRESS' | 'LOOP_ABORTED', generation?: number): Promise<void>;
    waitForUser(id: string, generation?: number, question?: string): Promise<void>;
    fail(id: string, code: typeof ERROR_CODES[number], generation?: number): Promise<void>;
    complete(id: string, result: Extract<RunResult, {
        status: 'completed';
    }>, proof: Verification, generation?: number): Promise<void>;
};
const defaults: Required<RunLimits> = { maxSteps: 30, maxDurationMs: 300000, maxModelCalls: 40, maxContextChars: 64000, maxObservationChars: 24000, maxConsecutiveNoProgress: 3 };
function stop(code: ConstructorParameters<typeof RuntimeError>[0]): never { throw new RuntimeError(code); }
function stable(v: unknown): string {
    if (!v || typeof v !== 'object')
        return JSON.stringify(v);
    if (Array.isArray(v))
        return '[' + v.map(stable).join(',') + ']';
    return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable((v as Record<string, unknown>)[k])).join(',') + '}';
}
async function digest(v: unknown) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stable(v))))].map(x => x.toString(16).padStart(2, '0')).join(''); }
function semantic(o: Observation) { return { url: o.url, documentId: o.documentId, title: o.title, text: o.text, viewport: o.viewport, elements: o.elements.map(({ ref, ...e }) => e) }; }
function abortable<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
    return new Promise((resolve, reject) => {
        if (signal.aborted) {
            reject(new RuntimeError('ABORTED'));
            return;
        }
        const abort = () => { signal.removeEventListener('abort', abort); reject(new RuntimeError('ABORTED')); };
        signal.addEventListener('abort', abort, { once: true });
        Promise.resolve().then(() => {
            if (signal.aborted)
                stop('ABORTED');
            return operation();
        }).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
}
export function attachLoop(runtime: BaseRuntime, store: RuntimeStore, sessionId: string, options?: LoopOptions) {
    const registrations = new Map<string, Record<string, JsonValue>>(), busy = new Set<string>();
    const now = options?.now ?? Date.now;
    function record(r: StoredRun) {
        if (!r.loop)
            stop('POLICY_DENIED');
        return r.loop;
    }
    async function update<T>(id: string, generation: number, fn: (l: LoopState, r: StoredRun) => T) {
        return store.transact(s => {
            const r = s.runs.get(id);
            if (!r)
                stop('POLICY_DENIED');
            const lease = s.leases.get(r.snapshot.tabId);
            if (r.generation !== generation || r.sessionId !== sessionId || r.snapshot.status !== 'running' || lease?.sessionId !== sessionId || lease?.runId !== id || lease?.generation !== generation || lease.expiresAt <= now())
                stop('ABORTED');
            return fn(record(r), r);
        });
    }
    async function configureLoop(id: string, { schemas = {}, limits = {}, completionConditions }: {
        schemas?: Record<string, JsonValue>;
        limits?: RunLimits;
        completionConditions?: Condition[];
    } = {}) {
        if (!options || busy.has(id))
            stop('POLICY_DENIED');
        if(completionConditions!==undefined && (!Array.isArray(completionConditions)||completionConditions.length>16))stop('MODEL_INVALID_OUTPUT');
        const conditions=completionConditions?.map(parseCondition);
        if(conditions?.some(c=>c.kind==='value'))stop('MODEL_INVALID_OUTPUT');
        const parsedLimits = { ...defaults, ...parseRunLimits(limits) }, copy = JSON.parse(JSON.stringify(schemas)) as Record<string, JsonValue>;
        if (!copy || typeof copy !== 'object' || Array.isArray(copy) || Object.keys(copy).length > 16 || JSON.stringify(copy).length > 24000)
            stop('MODEL_INVALID_OUTPUT');
        for (const [key, schema] of Object.entries(copy)) {
            if (!key.trim() || key.length > 256 || ['__proto__', 'constructor', 'prototype'].includes(key))
                stop('MODEL_INVALID_OUTPUT');
            try {
                compileSchema(schema);
            }
            catch {
                stop('MODEL_INVALID_OUTPUT');
            }
        }
        const schemaDigest = await digest(copy);
        await store.transact(s => {
            const r = s.runs.get(id);
            if (!r)
                stop('POLICY_DENIED');
            if (r.loop) {
                if(conditions && stable(conditions)!==stable(r.loop.completionConditions??[]))stop('POLICY_DENIED');
                if (r.loop.schemaDigest !== schemaDigest || Object.keys(limits).length && stable(r.loop.limits) !== stable(parsedLimits))
                    stop('POLICY_DENIED');
                if (!['created', 'paused'].includes(r.snapshot.status))
                    stop('POLICY_DENIED');
                return;
            }
            if (r.snapshot.status !== 'created')
                stop('POLICY_DENIED');
            r.loop = { completionConditions: conditions??[], limits: parsedLimits, budget: { steps: { used: 0, limit: parsedLimits.maxSteps }, modelCalls: { used: 0, limit: parsedLimits.maxModelCalls }, elapsedMs: { used: 0, limit: parsedLimits.maxDurationMs }, contextChars: { used: 0, limit: parsedLimits.maxContextChars }, observationChars: { used: 0, limit: parsedLimits.maxObservationChars }, consecutiveNoProgress: { used: 0, limit: parsedLimits.maxConsecutiveNoProgress } }, startedAt: null, schemaDigest, history: [], fingerprint: null, usage: {} };
        });
        registrations.set(id, copy);
    }
    async function round(id: string, external?: AbortSignal) {
        if (!options || !registrations.has(id))
            stop('POLICY_DENIED');
        const scope = await runtime.scope(id), generation = scope.generation;
        let timeout = false, timer: ReturnType<typeof setTimeout> | undefined;
        const deadline = new AbortController(), signal = AbortSignal.any([scope.signal, deadline.signal, ...(external ? [external] : [])]);
        async function trace(type: 'step.observed' | 'model.completed' | 'budget.updated' | 'verification.result', reason: string, u?: Usage) {
            await store.transact(s => {
                const r = s.runs.get(id);
                if (!r?.loop || r.generation !== generation || r.sessionId !== sessionId)
                    return;
                const entries = s.journal.get(id) ?? [];
                entries.push({ seq: ++r.seq, runId: id, timestamp: new Date(now()).toISOString(), type, reason, actionId: null, metrics: { step: r.loop.budget.steps.used, ...(u ? { usage: u } : {}), ...(type === 'budget.updated' ? { budget: structuredClone(r.loop.budget) } : {}) } });
                s.journal.set(id, entries.slice(-512));
            });
        }
        async function check() {
            if (signal.aborted) {
                if (timeout)
                    exceeded('elapsedMs');
                stop('ABORTED');
            }
            return update(id, generation, l => {
                l.startedAt ??= now();
                l.budget.elapsedMs.used = Math.max(l.budget.elapsedMs.used, now() - l.startedAt);
                if (l.budget.elapsedMs.used >= l.limits.maxDurationMs)
                    exceeded('elapsedMs');
                return l;
            });
        }
        async function modelCall<T>(input: unknown, operation: (m: ModelProvider) => Promise<T>): Promise<T> {
            await check();
            const reserved = await update(id, generation, l => {
                const remaining = l.budget.modelCalls.limit - l.budget.modelCalls.used;
                if (remaining < 1)
                    exceeded('modelCalls');
                const count = Math.min(2, remaining) as 1 | 2;
                l.budget.modelCalls.used += count;
                return count;
            });
            let attempts = 0;
            try {
                const provider = options!.modelFactory({ attemptLimit: reserved, onAttempt() {
                        if (signal.aborted)
                            stop('ABORTED');
                        if (++attempts > reserved)
                            exceeded('modelCalls');
                    } });
                return await abortable(() => operation(provider), signal);
            }
            catch (error) {
                if (error && typeof error === 'object' && 'attempts' in error && Array.isArray(error.attempts)) {
                    for (const attempt of error.attempts) {
                        if (attempt?.usage) {
                            try {
                                const u = parseUsage(attempt.usage);
                                await usage(u);
                                await trace('model.completed', 'FAILED_ATTEMPT', u);
                            }
                            catch { }
                        }
                    }
                }
                throw error;
            }
            finally {
                await store.transact(s => {
                    const r = s.runs.get(id);
                    if (r?.generation !== generation || r.sessionId !== sessionId || !r.loop)
                        return;
                    r.loop.budget.modelCalls.used -= reserved - Math.max(1, Math.min(attempts, reserved));
                }).catch(() => { });
            }
        }
        async function usage(u?: Usage) {
            if (!u)
                return;
            await update(id, generation, l => {
                for (const key of ['inputTokens', 'outputTokens', 'totalTokens'] as const)
                    if (u[key] !== undefined)
                        l.usage[key] = (l.usage[key] ?? 0) + u[key]!;
            });
        }
        async function context(value: unknown, observation: Observation) {
            const chars = JSON.stringify(value).length, observed = JSON.stringify(observation).length;
            await update(id, generation, l => {
                if (observed > l.limits.maxObservationChars)
                    exceeded('observationChars');
                if (chars > l.limits.maxContextChars)
                    exceeded('contextChars');
                l.budget.contextChars.used = chars;
                l.budget.observationChars.used = observed;
            });
        }
        async function history(reason: string) { await update(id, generation, l => { l.history.push(reason); l.history = l.history.slice(-16); }); }
        let stateConditions:Condition[]=[];
        function completion(expected:Condition[]) { const all=[...stateConditions,...expected],unique=all.filter((c,i)=>all.findIndex(other=>stable(other)===stable(c))===i);if(unique.length>16)stop('BUDGET_EXCEEDED');return unique; }
        try {
            const l = await check(); stateConditions=l.completionConditions??[];
            timer = setTimeout(() => { timeout = true; deadline.abort(); }, Math.max(1, l.limits.maxDurationMs - l.budget.elapsedMs.used));
            await update(id, generation, l => {
                if (l.budget.steps.used >= l.limits.maxSteps)
                    exceeded('steps');
                l.budget.steps.used++;
            });
            const observation = parseObservation(await abortable(() => runtime.observe(id, signal), signal));
            await check();
            await trace('step.observed', 'OBSERVED');
            const fingerprint = await digest(semantic(observation));
            const state = await update(id, generation, l => {
                if (l.fingerprint === fingerprint)
                    l.budget.consecutiveNoProgress.used++;
                else
                    l.budget.consecutiveNoProgress.used = 0;
                l.fingerprint = fingerprint;
                return l;
            });
            if (state.budget.consecutiveNoProgress.used >= state.limits.maxConsecutiveNoProgress) {
                await history('NO_PROGRESS');
                await runtime.pause(id, 'NO_PROGRESS', generation);
                return { kind: 'paused' as const };
            }
            const r = await runtime.get(id), input = parseDecisionInput({ goal: r.snapshot.goal, observation, historySummary: state.history.join('\n'), allowedActions: ['click', 'fill', 'pressKey', 'scroll', 'navigate', 'selectOption'], schemaIds: Object.keys(registrations.get(id)!), completionConditions: stateConditions, budget: state.budget });
            await context(input, observation);
            await trace('budget.updated', 'DECIDE_INPUT');
            const response = parseModelResponse(await modelCall(input, m => m.decide(structuredClone(input), signal)));
            await check();
            await usage(response.usage);
            await trace('model.completed', 'DECIDE', response.usage);
            const d: Decision = response.decision;
            if (d.kind === 'action') {
                const a = d.request.action;
                if ('target' in a && (a.target.documentId !== observation.documentId || a.target.frameId !== observation.frameId || a.target.observationId !== observation.observationId || !observation.elements.some(e => e.ref === a.target.ref)))
                    stop('STALE_TARGET');
                await check();
                const receipt = await abortable(() => runtime.execute(id, { ...d.request, actionId: crypto.randomUUID() }, signal), signal);
                if ((await runtime.get(id)).snapshot.status === 'running')
                    await history(JSON.stringify({kind:a.kind,...('target' in a?{targetRef:a.target.ref}:{}),stage:receipt.action.stage,dispatched:receipt.action.result?.dispatched??'no',verified:receipt.action.result?.verified??'not_checked',...(receipt.action.result?.error?{errorCode:receipt.action.result.error.code}:{})}));
                return { kind: 'action' as const, receipt };
            }
            if (d.kind === 'ask_user') {
                await history('ASK_USER');
                await runtime.waitForUser(id, generation, d.question);
                return { kind: 'ask_user' as const, question: d.question };
            }
            if (d.kind === 'finish') {
                const required=completion(d.expected), proof = parseVerification(await abortable(() => runtime.verify(id, required, signal), signal));
                await check();
                await trace('verification.result', proof.status);
                if (proof.status !== 'passed' || proof.conditions.length !== required.length || proof.conditions.some((c, i) => stable(c.condition) !== stable(required[i]) || !c.evidence.length)) {
                    await history('FINISH_UNVERIFIED');
                    return { kind: 'unverified' as const };
                }
                await runtime.complete(id, { status: 'completed', summary: d.summary, evidence: proof.conditions.flatMap(c => c.evidence) }, proof, generation);
                return { kind: 'completed' as const };
            }
            if (!Object.hasOwn(registrations.get(id)!, d.schemaId))
                stop('MODEL_INVALID_OUTPUT');
            const schema = registrations.get(id)![d.schemaId]!;
            const extractionInput = { observation, schemaId: d.schemaId, schema };
            await context(extractionInput, observation);
            const extracted = parseExtractionResponse(await modelCall(extractionInput, m => m.extract(structuredClone(extractionInput), signal)));
            await check();
            await usage(extracted.usage);
            await trace('model.completed', 'EXTRACT', extracted.usage);
            compileSchema(schema)(extracted.data);
            if (extracted.schemaId !== d.schemaId || extracted.source.some(e => e.url !== observation.url || e.documentId !== observation.documentId || e.observationId !== observation.observationId || e.capturedAt !== observation.capturedAt))
                stop('MODEL_INVALID_OUTPUT');
            const current = parseObservation(await abortable(() => runtime.observe(id, signal), signal));
            await check();
            if (await digest(semantic(current)) !== fingerprint)
                stop('STALE_TARGET');
            const expected = completion([{ kind: 'url' as const, equals: observation.url }]), proof = parseVerification(await abortable(() => runtime.verify(id, expected, signal), signal));
            await check();
            if (proof.status !== 'passed' || proof.conditions.length !== expected.length || proof.conditions.some((c,i)=>stable(c.condition)!==stable(expected[i]) || !c.evidence.length))
                stop('POLICY_DENIED');
            await runtime.complete(id, { status: 'completed', summary: 'Structured extraction validated', extraction: { schemaId: extracted.schemaId, data: extracted.data, source: extracted.source } }, proof, generation);
            return { kind: 'completed' as const };
        }
        catch (error) {
            const r = await runtime.get(id).catch(() => null);
            if (r?.generation === generation && r.snapshot.status === 'running') {
                const code = timeout ? 'BUDGET_EXCEEDED' : error && typeof error === 'object' && 'code' in error && ERROR_CODES.includes(error.code as any) ? error.code as typeof ERROR_CODES[number] : 'MODEL_INVALID_OUTPUT';
                try {
                    await update(id, generation, l => {
                        l.stopReason = timeout ? 'elapsedMs' : error instanceof BudgetError ? error.counter : code;
                        if (timeout)
                            l.budget.elapsedMs.used = l.budget.elapsedMs.limit;
                    });
                }
                catch {
                    await runtime.pause(id, 'LOOP_ABORTED', generation).catch(() => { });
                    return { kind: 'stopped' as const };
                }
                await trace('budget.updated', 'STOP');
                if (code === 'ABORTED')
                    await runtime.pause(id, 'LOOP_ABORTED', generation).catch(e => { if (!(e instanceof RuntimeError) || e.code !== 'ABORTED')
                        throw e; });
                else
                    await runtime.fail(id, code, generation).catch(e => { if (!(e instanceof RuntimeError) || e.code !== 'ABORTED')
                        throw e; });
            }
            return { kind: 'stopped' as const };
        }
        finally {
            if (timer)
                clearTimeout(timer);
        }
    }
    async function locked<T>(id: string, fn: () => Promise<T>) {
        if (busy.has(id))
            stop('TAB_BUSY');
        busy.add(id);
        try {
            return await fn();
        }
        finally {
            busy.delete(id);
        }
    }
    return { configureLoop, step: (id: string, signal?: AbortSignal) => locked(id, () => round(id, signal)), drive: (id: string, signal?: AbortSignal) => locked(id, async () => {
            const initial = await runtime.scope(id);
            while (true) {
                const r = await runtime.get(id);
                if (r.snapshot.status !== 'running' || r.generation !== initial.generation)
                    break;
                await round(id, signal);
            }
            return (await runtime.get(id)).snapshot;
        }) };
}

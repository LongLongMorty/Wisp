import { parseActionRequest, parseActionResult, parseRunSnapshot, parseVerification, parseRunResult, parseError } from '@wisp/protocol';
import type { ActionRequest, ActionResult, Observation, Verification, RunSnapshot, RunResult } from '@wisp/protocol';
import type { PolicyGateway, GatewayResult, UiSender } from '@wisp/policy';
import { RuntimeError } from './store.mts';
import type { RuntimeStore, DatabaseState, StoredRun, StoredAction, JournalEntry, Lease } from './store.mts';
import { attachLoop } from './loop.mts';
import type { LoopOptions } from './loop.mts';
export type StepReceipt = {
    action: StoredAction;
    decision?: GatewayResult;
};
export type RuntimeOptions = {
    loop?: LoopOptions;
    store: RuntimeStore;
    gatewayFactory: (run: RunSnapshot, signal: AbortSignal) => Promise<PolicyGateway>;
    now?: () => number;
    sessionId?: string;
    leaseMs?: number;
    autoHeartbeat?: boolean;
    onCheckpoint?: (phase: 'prepared' | 'dispatching' | 'responded' | 'finished', actionId: string) => Promise<void>;
};
const terminal = (s: string) => ['completed', 'failed', 'cancelled'].includes(s);
const unresolved = (a: StoredAction) => a.stage === 'dispatching' || a.stage === 'unknown' && !a.acknowledged;
function fail(code: ConstructorParameters<typeof RuntimeError>[0]): never { throw new RuntimeError(code); }
function canonical(value: unknown): string {
    if (value === null || typeof value !== 'object')
        return JSON.stringify(value);
    if (Array.isArray(value))
        return '[' + value.map(canonical).join(',') + ']';
    return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical((value as Record<string, unknown>)[k])).join(',') + '}';
}
async function hash(request: ActionRequest) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(request))))].map(n => n.toString(16).padStart(2, '0')).join(''); }
function clean(result: ActionResult): ActionResult { return parseActionResult({ ...result, evidence: result.evidence.map(e => ({ ...e, url: new URL(e.url).origin + '/', actual: e.actual === 'matched' ? 'matched' : '[REDACTED]' })), ...(result.error ? { error: { ...result.error, message: result.error.code } } : {}) }); }
export async function createTaskRuntime({ store, gatewayFactory, now = Date.now, sessionId = crypto.randomUUID(), leaseMs = 5000, autoHeartbeat = true, onCheckpoint, loop }: RuntimeOptions) {
    if (!Number.isInteger(leaseMs) || leaseMs < 1000 || leaseMs > 60000 || !sessionId || sessionId.length > 256)
        fail('POLICY_DENIED');
    let disposed = false, fault = false;
    const teardowns = new Map<string, Promise<void>>();
    const questions = new Map<string, string>();
    const controllers = new Map<string, AbortController>(), gateways = new Map<string, Promise<PolicyGateway>>(), pending = new Map<string, {
        request: ActionRequest;
        decision: GatewayResult;
    }>(), inflight = new Map<string, {
        runId: string;
        hash: string;
        promise: Promise<StepReceipt>;
    }>();
    function active() {
        if (disposed || fault)
            fail('DISCONNECTED');
    }
    function time() {
        const value = now();
        if (!Number.isFinite(value) || value < 0)
            fail('DISCONNECTED');
        return value;
    }
    function run(s: DatabaseState, id: string) {
        const r = s.runs.get(id);
        if (!r)
            fail('POLICY_DENIED');
        return r;
    }
    function event(s: DatabaseState, r: StoredRun, type: JournalEntry['type'], reason: string, actionId: string | null = null) {
        r.snapshot.updatedAt = new Date(time()).toISOString();
        const entries = s.journal.get(r.snapshot.runId) || [];
        entries.push({ seq: ++r.seq, runId: r.snapshot.runId, timestamp: r.snapshot.updatedAt, type, reason, actionId, ...(type === 'run.state' || type === 'run.created' ? { state: r.snapshot.status } : {}) });
        while (entries.length > 512)
            entries.shift();
        s.journal.set(r.snapshot.runId, entries);
    }
    function state(s: DatabaseState, r: StoredRun, status: 'running' | 'paused' | 'waiting_user', reason: string) { r.snapshot = parseRunSnapshot({ ...r.snapshot, status }); r.reason = reason; event(s, r, 'run.state', reason); }
    function blocked(s: DatabaseState, tabId: number) { return [...s.actions.values()].some(a => unresolved(a) && s.runs.get(a.runId)?.snapshot.tabId === tabId); }
    function owner(s: DatabaseState, r: StoredRun, allowExpired = false) {
        const l = s.leases.get(r.snapshot.tabId);
        if (!l || l.runId !== r.snapshot.runId || l.sessionId !== sessionId || l.generation !== r.generation || !allowExpired && l.expiresAt <= time())
            fail('TAB_BUSY');
        return l;
    }
    function release(s: DatabaseState, r: StoredRun) {
        const l = s.leases.get(r.snapshot.tabId);
        if (l?.sessionId === sessionId && l.runId === r.snapshot.runId)
            s.leases.delete(r.snapshot.tabId);
    }
    function claim(s: DatabaseState, r: StoredRun, resolveOnly = false) {
        const previous = s.leases.get(r.snapshot.tabId);
        if (previous && previous.expiresAt > time() && (previous.sessionId !== sessionId || previous.runId !== r.snapshot.runId))
            fail('TAB_BUSY');
        if (!resolveOnly && blocked(s, r.snapshot.tabId))
            fail('OUTCOME_UNKNOWN');
        const generation = (s.generations.get(r.snapshot.tabId) || 0) + 1;
        s.generations.set(r.snapshot.tabId, generation);
        const lease: Lease = { tabId: r.snapshot.tabId, runId: r.snapshot.runId, sessionId, generation, expiresAt: time() + leaseMs };
        s.leases.set(lease.tabId, lease);
        r.sessionId = sessionId;
        r.generation = generation;
        return lease;
    }
    function stopLocal(id: string, expected?: AbortController) {
        if (expected && controllers.get(id) !== expected)
            return;
        questions.delete(id);
        controllers.get(id)?.abort();
        controllers.delete(id);
        const p = gateways.get(id);
        gateways.delete(id);
        for (const [key] of pending)
            if (JSON.parse(key)[0] === id)
                pending.delete(key);
        if (p) {
            const cleanup = p.then(g => g.dispose()).catch(() => { });
            teardowns.set(id, cleanup);
            void cleanup.finally(() => {
                if (teardowns.get(id) === cleanup)
                    teardowns.delete(id);
            });
        }
    }
    function signalFor(id: string, external?: AbortSignal) {
        let c = controllers.get(id);
        if (!c) {
            c = new AbortController();
            controllers.set(id, c);
        }
        return external ? AbortSignal.any([external, c.signal]) : c.signal;
    }
    async function gateway(id: string, signal: AbortSignal) {
        await teardowns.get(id);
        if (signal.aborted)
            fail('ABORTED');
        let p = gateways.get(id);
        if (!p) {
            const snapshot = await store.transact(s => run(s, id).snapshot);
            if (signal.aborted)
                fail('ABORTED');
            p = gatewayFactory(snapshot, signal);
            gateways.set(id, p);
        }
        const g = await p;
        if (signal.aborted || disposed)
            fail('ABORTED');
        return g;
    }
    function prune(s: DatabaseState, room = false) {
        const candidates = [...s.runs.values()].filter(r => terminal(r.snapshot.status) && ![...s.actions.values()].some(a => a.runId === r.snapshot.runId && unresolved(a))).sort((a, b) => a.snapshot.updatedAt.localeCompare(b.snapshot.updatedAt));
        for (const r of candidates) {
            if (time() - Date.parse(r.snapshot.updatedAt) < 7 * 86400000 && (!room || s.runs.size < 100))
                continue;
            remove(s, r);
        }
    }
    function remove(s: DatabaseState, r: StoredRun) {
        s.runs.delete(r.snapshot.runId);
        s.journal.delete(r.snapshot.runId);
        release(s, r);
        for (const a of s.actions.values())
            if (a.runId === r.snapshot.runId) {
                a.stage = 'tombstone';
                a.result = null;
            }
    }
    async function recover() {
        active();
        return store.transact(s => {
            const recovered: string[] = [];
            for (const r of s.runs.values()) {
                const l = s.leases.get(r.snapshot.tabId);
                if (l && l.expiresAt > time())
                    continue;
                for (const a of s.actions.values())
                    if (a.runId === r.snapshot.runId) {
                        if (a.stage === 'dispatching') {
                            a.stage = 'unknown';
                            a.updatedAt = time();
                            event(s, r, 'action.recovered', 'OUTCOME_UNKNOWN', a.actionId);
                        }
                        else if (a.stage === 'prepared' || a.stage === 'waiting_confirmation') {
                            a.stage = 'abandoned';
                            a.updatedAt = time();
                            event(s, r, 'action.recovered', 'REPLAN_REQUIRED', a.actionId);
                        }
                    }
                if (!terminal(r.snapshot.status) && r.snapshot.status !== 'paused') {
                    state(s, r, 'paused', 'RECOVERED');
                    recovered.push(r.snapshot.runId);
                }
                r.sessionId = null;
                r.generation = null;
                if (l?.runId === r.snapshot.runId)
                    s.leases.delete(r.snapshot.tabId);
            }
            prune(s);
            return recovered;
        });
    }
    await recover();
    async function heartbeat() {
        active();
        const stopped = await store.transact(s => {
            const stopped: string[] = [];
            for (const [tabId, l] of s.leases)
                if (l.sessionId === sessionId) {
                    const r = s.runs.get(l.runId);
                    if (!r || !['running', 'waiting_user'].includes(r.snapshot.status)) {
                        stopped.push(l.runId);
                        s.leases.delete(tabId);
                        continue;
                    }
                    if (l.expiresAt <= time())
                        fail('TAB_BUSY');
                    l.expiresAt = time() + leaseMs;
                }
            for (const id of controllers.keys()) {
                const r = s.runs.get(id), l = r ? s.leases.get(r.snapshot.tabId) : undefined;
                if (!r || !l || l.sessionId !== sessionId || l.runId !== id)
                    stopped.push(id);
            }
            return stopped;
        });
        for (const id of stopped)
            stopLocal(id);
    }
    const timer = autoHeartbeat ? setInterval(() => {
        void heartbeat().catch(() => {
            fault = true;
            for (const c of controllers.values())
                c.abort();
        });
    }, Math.min(1000, Math.max(250, Math.floor(leaseMs / 3)))) : undefined;
    async function pause(id: string, reason: 'USER_PAUSE' | 'NO_PROGRESS' | 'LOOP_ABORTED' = 'USER_PAUSE', expectedGeneration?: number) {
        active();
        await store.transact(s => {
            const r = run(s, id);
            if (expectedGeneration !== undefined && (r.generation !== expectedGeneration || r.sessionId !== sessionId))
                fail('ABORTED');
            if (terminal(r.snapshot.status))
                fail('POLICY_DENIED');
            state(s, r, 'paused', reason);
            for (const a of s.actions.values())
                if (a.runId === id) {
                    if (a.stage === 'prepared' || a.stage === 'waiting_confirmation')
                        a.stage = 'abandoned';
                    if (a.stage === 'dispatching')
                        a.stage = 'unknown';
                }
            release(s, r);
        });
        stopLocal(id);
    }
    async function interrupt(id: string, reason: string, cancel = false) {
        active();
        await store.transact(s => {
            const r = run(s, id);
            if (terminal(r.snapshot.status)) {
                if (cancel && r.snapshot.status === 'cancelled')
                    return;
                fail('POLICY_DENIED');
            }
            if (cancel) {
                r.snapshot = parseRunSnapshot({ ...r.snapshot, status: 'cancelled', result: { status: 'cancelled', reason: 'USER_CANCEL' } });
                r.reason = reason;
                event(s, r, 'run.state', reason);
            }
            else
                state(s, r, 'paused', reason);
            for (const a of s.actions.values())
                if (a.runId === id) {
                    if (a.stage === 'prepared' || a.stage === 'waiting_confirmation')
                        a.stage = 'abandoned';
                    else if (a.stage === 'dispatching')
                        a.stage = 'unknown';
                }
            release(s, r);
        });
        stopLocal(id);
    }
    async function start(id: string, external?: AbortSignal) {
        active();
        if (external?.aborted)
            fail('ABORTED');
        const generation = await store.transact(s => {
            const r = run(s, id);
            if (!['created', 'paused'].includes(r.snapshot.status))
                fail('POLICY_DENIED');
            const lease = claim(s, r);
            state(s, r, 'running', 'STARTING');
            return lease.generation;
        });
        const signal = signalFor(id, external), controller = controllers.get(id);
        try {
            const g = await gateway(id, signal), observation = await g.observe(signal);
            await store.transact(s => {
                const r = run(s, id);
                owner(s, r);
                if (r.generation !== generation || r.snapshot.status !== 'running' || signal.aborted)
                    fail('ABORTED');
                event(s, r, 'run.state', 'OBSERVED');
            });
            return observation;
        }
        catch (error) {
            await store.transact(s => {
                const r = run(s, id);
                if (r.snapshot.status === 'running' && r.sessionId === sessionId && r.generation === generation) {
                    state(s, r, 'paused', 'START_FAILED');
                    release(s, r);
                }
            }).catch(() => { });
            stopLocal(id, controller);
            throw error;
        }
    }
    async function finish(id: string, actionId: string, decision: GatewayResult | undefined) {
        return store.transact(s => {
            const r = run(s, id), a = s.actions.get(actionId)!;
            // Recovery clears the run owner before any new lease is claimed.
            // A surviving old host must not resolve the recovered unknown action.
            if (s.generations.get(r.snapshot.tabId) !== a.generation || a.sessionId !== sessionId || r.sessionId !== sessionId || r.generation !== a.generation)
                return { action: a };
            const live = r.snapshot.status === 'running' && ['prepared', 'dispatching'].includes(a.stage);
            if (decision?.kind === 'executed') {
                a.result = clean(decision.result);
                a.stage = a.result.dispatched === 'unknown' || a.result.dispatched !== 'no' && a.result.verified === 'unknown' ? 'unknown' : 'finished';
                if (live) {
                    if (a.stage === 'unknown' || a.result.error) {
                        state(s, r, 'paused', a.stage === 'unknown' ? 'OUTCOME_UNKNOWN' : 'ACTION_FAILED');
                        release(s, r);
                    }
                }
            }
            else if (decision?.kind === 'confirm' && live) {
                a.stage = 'waiting_confirmation';
                state(s, r, 'waiting_user', 'CONFIRMATION_REQUIRED');
                event(s, r, 'confirmation.required', 'CONFIRMATION_REQUIRED', actionId);
            }
            else {
                if (a.stage === 'prepared')
                    a.stage = 'abandoned';
                else if (a.stage === 'dispatching' || a.stage === 'unknown')
                    a.stage = decision ? 'abandoned' : 'unknown';
                if (live) {
                    state(s, r, 'paused', decision ? 'POLICY_STOP' : a.stage === 'abandoned' ? 'REPLAN_REQUIRED' : 'OUTCOME_UNKNOWN');
                    release(s, r);
                }
            }
            a.updatedAt = time();
            event(s, r, 'action.result', a.stage, actionId);
            return decision && live ? { action: a, decision } : { action: a };
        });
    }
    async function stopIfPaused(id: string, generation: number, controller: AbortController | undefined) {
        const stop = await store.transact(s => { const r = run(s, id); return r.generation === generation && !['running', 'waiting_user'].includes(r.snapshot.status); }).catch(() => false);
        if (stop)
            stopLocal(id, controller);
    }
    async function dispatchStep(id: string, request: ActionRequest, digest: string, external?: AbortSignal): Promise<StepReceipt> {
        const signal = signalFor(id, external), controller = controllers.get(id);
        const prepared = await store.transact(s => {
            const known = s.actions.get(request.actionId);
            if (known) {
                if (known.runId !== id || known.hash !== digest)
                    fail('POLICY_DENIED');
                return { known: true, action: known };
            }
            const r = run(s, id);
            owner(s, r);
            if (r.snapshot.status !== 'running' || signal.aborted)
                fail('ABORTED');
            if (blocked(s, r.snapshot.tabId))
                fail('OUTCOME_UNKNOWN');
            if (r.lastActionId && ['prepared', 'dispatching', 'waiting_confirmation'].includes(s.actions.get(r.lastActionId)?.stage || ''))
                fail('TAB_BUSY');
            if ([...s.actions.values()].filter(a => a.runId === id).length >= 256 || s.actions.size >= 25600)
                fail('BUDGET_EXCEEDED');
            const a: StoredAction = { actionId: request.actionId, runId: id, hash: digest, kind: request.action.kind, stage: 'prepared', createdAt: time(), updatedAt: time(), generation: r.generation!, sessionId, result: null, acknowledged: false };
            s.actions.set(a.actionId, a);
            r.lastActionId = a.actionId;
            event(s, r, 'action.prepared', 'PREPARED', a.actionId);
            return { known: false, action: a };
        });
        if (prepared.known) {
            const p = pending.get(JSON.stringify([id, request.actionId]));
            return p ? { action: prepared.action, decision: p.decision } : { action: prepared.action };
        }
        try {
            await onCheckpoint?.('prepared', request.actionId);
            await store.transact(s => {
                const r = run(s, id), a = s.actions.get(request.actionId)!;
                owner(s, r);
                if (r.snapshot.status !== 'running' || a.stage !== 'prepared' || signal.aborted)
                    fail('ABORTED');
                a.stage = 'dispatching';
                event(s, r, 'action.dispatching', 'DISPATCHING', a.actionId);
            });
            await onCheckpoint?.('dispatching', request.actionId);
            if (signal.aborted)
                fail('ABORTED');
            const g = await gateway(id, signal);
            await store.transact(s => {
                const r = run(s, id), a = s.actions.get(request.actionId)!;
                owner(s, r);
                if (r.snapshot.status !== 'running' || a.stage !== 'dispatching' || signal.aborted)
                    fail('ABORTED');
            });
            const decision = await g.submit(id, request, signal);
            await onCheckpoint?.('responded', request.actionId);
            const receipt = await finish(id, request.actionId, decision);
            if (receipt.action.stage === 'waiting_confirmation')
                pending.set(JSON.stringify([id, request.actionId]), { request, decision });
            await stopIfPaused(id, prepared.action.generation, controller);
            await onCheckpoint?.('finished', request.actionId);
            return receipt;
        }
        catch (error) {
            await finish(id, request.actionId, undefined).catch(() => { });
            await stopIfPaused(id, prepared.action.generation, controller);
            throw error;
        }
    }
    const api = {
        async scope(id: string): Promise<{
            generation: number;
            signal: AbortSignal;
        }> {
            active();
            const signal = signalFor(id);
            const generation = await store.transact(s => {
                const r = run(s, id);
                owner(s, r);
                if (r.snapshot.status !== 'running')
                    fail('ABORTED');
                return r.generation!;
            });
            return { generation, signal };
        },
        async observe(id: string, external?: AbortSignal): Promise<Observation> {
            const scope = await api.scope(id), signal = external ? AbortSignal.any([scope.signal, external]) : scope.signal, g = await gateway(id, signal);
            const value = await g.observe(signal);
            const current = await api.scope(id);
            if (current.generation !== scope.generation || signal.aborted)
                fail('ABORTED');
            return value;
        },
        async verify(id: string, conditions: import('@wisp/protocol').Condition[], external?: AbortSignal): Promise<Verification> {
            const scope = await api.scope(id), signal = external ? AbortSignal.any([scope.signal, external]) : scope.signal, g = await gateway(id, signal);
            const proof = parseVerification(await g.verify(conditions, signal));
            const current = await api.scope(id);
            if (current.generation !== scope.generation || signal.aborted)
                fail('ABORTED');
            return proof;
        },
        async waitForUser(id: string, expectedGeneration?: number, question?: string) {
            active();
            await store.transact(s => {
                const r = run(s, id);
                owner(s, r);
                if (r.snapshot.status !== 'running' || expectedGeneration !== undefined && r.generation !== expectedGeneration)
                    fail('ABORTED');
                state(s, r, 'waiting_user', 'ASK_USER');
            });
            if (question !== undefined)
                questions.set(id, question);
            else
                questions.delete(id);
        },
        sessionId, recover, heartbeat,
        async create({ runId = crypto.randomUUID(), tabId, goal }: {
            runId?: string;
            tabId: number;
            goal: string;
        }) {
            active();
            const snapshot = parseRunSnapshot({ runId, tabId, goal, status: 'created', updatedAt: new Date(time()).toISOString() });
            return store.transact(s => {
                if (s.runs.has(runId) || [...s.actions.values()].some(a => a.runId === runId))
                    fail('POLICY_DENIED');
                prune(s, true);
                if (s.runs.size >= 100)
                    fail('BUDGET_EXCEEDED');
                const r: StoredRun = { snapshot, reason: 'CREATED', sessionId: null, generation: null, lastActionId: null, seq: 0 };
                s.runs.set(runId, r);
                event(s, r, 'run.created', 'CREATED');
                return r.snapshot;
            });
        },
        async get(id: string) { active(); return store.transact(s => run(s, id)); },
        async events(id: string, afterSeq = 0) {
            active();
            if (!Number.isInteger(afterSeq) || afterSeq < 0)
                fail('POLICY_DENIED');
            return store.transact(s => {
                const r = run(s, id), events = s.journal.get(id) || [];
                if (afterSeq > r.seq || events[0] && afterSeq < events[0].seq - 1)
                    fail('BUDGET_EXCEEDED');
                return events.filter(e => e.seq > afterSeq);
            });
        },
        start, resume: start, pause,
        cancel: (id: string) => interrupt(id, 'USER_CANCEL', true),
        async notifyInput(tabId: number, source: 'program' | 'user' | 'unknown') {
            active();
            if (!['program', 'user', 'unknown'].includes(source))
                fail('POLICY_DENIED');
            if (source === 'program')
                return;
            const ids = await store.transact(s => [...s.runs.values()].filter(r => r.snapshot.tabId === tabId && ['running', 'waiting_user'].includes(r.snapshot.status)).map(r => r.snapshot.runId));
            for (const id of ids)
                await interrupt(id, 'USER_INTERFERENCE');
        },
        async execute(id: string, value: ActionRequest, signal?: AbortSignal): Promise<StepReceipt> {
            active();
            const request = parseActionRequest(value), digest = await hash(request), known = inflight.get(request.actionId);
            if (known) {
                if (known.runId !== id || known.hash !== digest)
                    fail('POLICY_DENIED');
                return structuredClone(await known.promise);
            }
            const promise = dispatchStep(id, request, digest, signal);
            inflight.set(request.actionId, { runId: id, hash: digest, promise });
            try {
                return structuredClone(await promise);
            }
            finally {
                inflight.delete(request.actionId);
            }
        },
        async pending(id: string) { active(); const r = await store.transact(s => run(s, id)); const p = r.lastActionId ? pending.get(JSON.stringify([id, r.lastActionId])) : undefined; return p ? structuredClone(p.decision) : r.snapshot.status === 'waiting_user' && r.reason === 'ASK_USER' && questions.has(id) ? { kind: 'ask_user' as const, question: questions.get(id)! } : null; },
        async confirm(id: string, message: unknown, sender: UiSender, external?: AbortSignal): Promise<StepReceipt> {
            active();
            const signal = signalFor(id, external), g = await gateway(id, signal), parsed = g.validateConfirmation(message, sender);
            if (parsed.runId !== id)
                fail('POLICY_DENIED');
            const r = await store.transact(s => run(s, id)), key = JSON.stringify([id, r.lastActionId]), p = pending.get(key);
            if (!p || p.decision.kind !== 'confirm' || p.decision.confirmation?.confirmationId !== parsed.payload.confirmationId)
                fail('POLICY_DENIED');
            if (parsed.payload.decision === 'reject') {
                try {
                    await g.confirm(message, sender, signal);
                }
                catch { }
                await interrupt(id, 'CONFIRMATION_REJECTED');
                return { action: await store.transact(s => s.actions.get(p.request.actionId)!) };
            }
            await store.transact(s => {
                const runState = run(s, id), a = s.actions.get(p.request.actionId)!;
                owner(s, runState);
                if (runState.snapshot.status !== 'waiting_user' || a.stage !== 'waiting_confirmation' || signal.aborted)
                    fail('ABORTED');
                a.stage = 'dispatching';
                state(s, runState, 'running', 'APPROVING');
                event(s, runState, 'action.dispatching', 'APPROVING', a.actionId);
            });
            pending.delete(key);
            try {
                const decision = await g.confirm(message, sender, signal);
                const receipt = await finish(id, p.request.actionId, decision);
                await stopIfPaused(id, receipt.action.generation, controllers.get(id));
                return receipt;
            }
            catch (error) {
                const receipt = await finish(id, p.request.actionId, undefined);
                await stopIfPaused(id, receipt.action.generation, controllers.get(id));
                throw error;
            }
        },
        async reconcile(id: string, value: ActionRequest, external?: AbortSignal) {
            active();
            const request = parseActionRequest(value), digest = await hash(request);
            if (!request.expected?.length)
                fail('POLICY_DENIED');
            const generation = await store.transact(s => {
                const r = run(s, id), a = s.actions.get(request.actionId);
                if (!a || a.runId !== id || a.hash !== digest || a.stage !== 'unknown' || a.acknowledged)
                    fail('POLICY_DENIED');
                return claim(s, r, true).generation;
            });
            const signal = signalFor(id, external), controller = controllers.get(id);
            try {
                const g = await gateway(id, signal), verification = parseVerification(await g.verify(request.expected, signal));
                await store.transact(s => {
                    const r = run(s, id), a = s.actions.get(request.actionId)!;
                    owner(s, r);
                    if (r.generation !== generation || a.stage !== 'unknown' || a.acknowledged)
                        fail('TAB_BUSY');
                    if (signal.aborted)
                        fail('ABORTED');
                    if (verification.status === 'passed') {
                        a.stage = 'finished';
                        a.acknowledged = true;
                        a.result = clean({ actionId: a.actionId, dispatched: 'unknown', responded: 'yes', verified: 'passed', evidence: verification.conditions.flatMap(c => c.evidence) });
                    }
                    event(s, r, 'action.reconciled', verification.status, a.actionId);
                });
                return verification;
            }
            finally {
                const same = await store.transact(s => {
                    const r = run(s, id);
                    if (r.generation !== generation)
                        return false;
                    release(s, r);
                    return true;
                }).catch(() => false);
                if (same)
                    stopLocal(id, controller);
            }
        },
        async acknowledgeUnknown(id: string, actionId: string) {
            active();
            await store.transact(s => {
                const r = run(s, id), a = s.actions.get(actionId);
                if (!a || a.runId !== id || a.stage !== 'unknown')
                    fail('POLICY_DENIED');
                claim(s, r, true);
                a.acknowledged = true;
                event(s, r, 'action.acknowledged', 'USER_ACKNOWLEDGED', a.actionId);
                release(s, r);
            });
            stopLocal(id);
        },
        async complete(id: string, result: Extract<RunResult, {
            status: 'completed';
        }>, verification: Verification, expectedGeneration?: number) {
            active();
            const proof = parseVerification(verification), parsed = parseRunResult(result);
            if (parsed.status !== 'completed' || proof.status !== 'passed' || !proof.conditions.length || !proof.conditions.every(c => c.evidence.length))
                fail('POLICY_DENIED');
            await store.transact(s => {
                const r = run(s, id);
                owner(s, r);
                if (expectedGeneration !== undefined && r.generation !== expectedGeneration)
                    fail('ABORTED');
                if (r.snapshot.status !== 'running' || blocked(s, r.snapshot.tabId))
                    fail('POLICY_DENIED');
                r.snapshot = parseRunSnapshot({ ...r.snapshot, status: 'completed', result: parsed }); r.reason='COMPLETED';
                event(s, r, 'run.state', 'COMPLETED');
                release(s, r);
            });
            stopLocal(id);
        },
        async fail(id: string, code: import('@wisp/protocol').ErrorCode, expectedGeneration?: number) {
            active();
            const error = parseError({ code, message: code, retryable: false });
            await store.transact(s => {
                const r = run(s, id);
                if (expectedGeneration !== undefined && (r.generation !== expectedGeneration || r.sessionId !== sessionId))
                    fail('ABORTED');
                if (terminal(r.snapshot.status))
                    fail('POLICY_DENIED');
                r.snapshot = parseRunSnapshot({ ...r.snapshot, status: 'failed', result: { status: 'failed', error } }); r.reason=code;
                event(s, r, 'run.state', 'FAILED');
                for (const a of s.actions.values())
                    if (a.runId === id) {
                        if (a.stage === 'prepared' || a.stage === 'waiting_confirmation')
                            a.stage = 'abandoned';
                        else if (a.stage === 'dispatching')
                            a.stage = 'unknown';
                    }
                release(s, r);
            });
            stopLocal(id);
        },
        async delete(id: string) {
            active();
            await store.transact(s => {
                const r = run(s, id);
                if (!terminal(r.snapshot.status) || [...s.actions.values()].some(a => a.runId === id && unresolved(a)))
                    fail('POLICY_DENIED');
                remove(s, r);
            });
        },
        async dispose() {
            if (disposed)
                return;
            if (timer)
                clearInterval(timer);
            for (const c of controllers.values())
                c.abort();
            const all = [...gateways.values()];
            gateways.clear();
            controllers.clear();
            pending.clear();
            questions.clear();
            disposed = true;
            await Promise.allSettled([...all.map(async (p) => (await p).dispose()), ...teardowns.values()]);
            await store.transact(s => {
                for (const r of s.runs.values())
                    if (r.sessionId === sessionId) {
                        if (!terminal(r.snapshot.status))
                            state(s, r, 'paused', 'HOST_DISPOSED');
                        for (const a of s.actions.values())
                            if (a.runId === r.snapshot.runId) {
                                if (a.stage === 'dispatching')
                                    a.stage = 'unknown';
                                else if (a.stage === 'prepared' || a.stage === 'waiting_confirmation')
                                    a.stage = 'abandoned';
                            }
                        release(s, r);
                    }
            }).catch(() => { });
        },
    };
    return { ...api, ...attachLoop(api, store, sessionId, loop ? { ...loop, now } : undefined) };
}
export type TaskRuntime = Awaited<ReturnType<typeof createTaskRuntime>>;

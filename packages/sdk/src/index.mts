import { createTaskRuntime, RuntimeError } from '@wisp/runtime';
import type { RuntimeOptions, TaskRuntime, JournalEntry } from '@wisp/runtime';
import { parseRunSnapshot, parseRunLimits, parseEvent, parseRequest, ERROR_CODES } from '@wisp/protocol';
import type { JsonValue, Condition, RunResult, RunLimits, RuntimeEvent, RunSnapshot } from '@wisp/protocol';
import type { UiSender } from '@wisp/policy';
export type { BrowserAdapter, ModelProvider, RunResult, RuntimeEvent } from '@wisp/protocol';
export type AgentOptions = Omit<RuntimeOptions, 'loop' | 'onCheckpoint'> & {
    modelFactory: NonNullable<RuntimeOptions['loop']>['modelFactory'];
    tabId?: number;
    uiSender?: () => UiSender;
    pollIntervalMs?: number;
};
export type RunInput = {
    goal: string;
    tabId?: number;
    schemas?: Record<string, JsonValue>;
    limits?: RunLimits;
    completionConditions?: Condition[];
};
export type EventOptions = {
    afterSeq?: number;
    onError?: (error: RuntimeError) => void;
};
const terminal = (status: string) => ['completed', 'failed', 'cancelled'].includes(status);
const safeError = (error: unknown) => new RuntimeError(error && typeof error === 'object' && 'code' in error && ERROR_CODES.includes(error.code as any) ? error.code as typeof ERROR_CODES[number] : 'DISCONNECTED');
function cursor(value: number) { if (!Number.isSafeInteger(value) || value < 0)
    throw new RuntimeError('POLICY_DENIED'); return value; }
const summaries = new Set([...ERROR_CODES, 'CREATED', 'STARTING', 'OBSERVED', 'START_FAILED', 'USER_PAUSE', 'USER_CANCEL', 'USER_INTERFERENCE', 'HOST_DISPOSED', 'RECOVERED', 'APPROVING', 'COMPLETED', 'FAILED', 'CONFIRMATION_REQUIRED', 'CONFIRMATION_REJECTED', 'ACTION_FAILED', 'POLICY_STOP', 'PREPARED', 'DISPATCHING', 'REPLAN_REQUIRED', 'NO_PROGRESS', 'LOOP_ABORTED', 'ASK_USER', 'DECIDE', 'EXTRACT', 'FAILED_ATTEMPT', 'DECIDE_INPUT', 'STOP', 'finished', 'unknown', 'abandoned', 'waiting_confirmation', 'passed', 'failed', 'unknown', 'USER_ACKNOWLEDGED']);
async function wire(entry: JournalEntry): Promise<RuntimeEvent> {
    const id = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(entry.runId + '\0' + entry.seq)))].map(x => x.toString(16).padStart(2, '0')).join('');
    const base = { version: '0.1', eventId: id, runId: entry.runId, seq: entry.seq, timestamp: entry.timestamp };
    const stepId = 'step-' + (entry.metrics?.step ?? entry.seq);
    if (entry.type === 'model.completed')
        return parseEvent({ ...base, type: entry.type, payload: { stepId, ...(entry.metrics?.usage ? { usage: entry.metrics.usage } : {}) } });
    if (entry.type === 'budget.updated' && entry.metrics?.budget)
        return parseEvent({ ...base, type: entry.type, payload: { budget: entry.metrics.budget } });
    const type = entry.type === 'run.created' || entry.type === 'run.state' ? 'run.state' : entry.type === 'step.observed' ? 'step.observed' : entry.type === 'verification.result' ? 'verification.result' : entry.type === 'confirmation.required' ? 'confirmation.required' : entry.type === 'action.prepared' ? 'action.prepared' : 'action.result';
    return parseEvent({ ...base, type, payload: { redacted: true, stepId, summary: summaries.has(entry.reason) ? entry.reason : 'REDACTED', ...(entry.actionId ? { actionId: entry.actionId } : {}), ...(type === 'run.state' && entry.state ? { status: entry.state } : {}) } });
}
type Subscription = {
    cursor: number;
    busy: boolean;
    active: boolean;
    callback: (event: RuntimeEvent) => void | Promise<void>;
    onError?: EventOptions['onError'];
};
export type RunHandle = {
    readonly runId: string;
    readonly result: Promise<RunResult>;
    snapshot(): Promise<RunSnapshot>;
    events(afterSeq?: number): Promise<{
        events: RuntimeEvent[];
        nextSeq: number;
    }>;
    onEvent(callback: Subscription['callback'], options?: EventOptions): () => void;
    pending(): ReturnType<TaskRuntime['pending']>;
    pause(): Promise<void>;
    resume(options?:{schemas?:Record<string,JsonValue>}): Promise<void>;
    cancel(): Promise<void>;
    confirm(input: {
        confirmationId: string;
        decision: 'approve' | 'reject';
    }): Promise<void>;
};
export function createAgent(options: AgentOptions) {
    const interval = options.pollIntervalMs ?? 50;
    if (!Number.isInteger(interval) || interval < 10 || interval > 1000)
        throw new RuntimeError('POLICY_DENIED');
    let disposed = false, polling = false;
    const handles = new Map<string, {
        handle: RunHandle;
        refresh: () => Promise<void>;
        close: () => void;
        done: () => boolean;
        hasListeners: () => boolean;
    }>();
    const ready = createTaskRuntime({ ...options, loop: { modelFactory: options.modelFactory } });
    void ready.catch(() => { });
    function active() { if (disposed)
        throw new RuntimeError('DISCONNECTED'); }
    async function page(runId: string, afterSeq: number) { active(); cursor(afterSeq); const runtime = await ready, entries = await runtime.events(runId, afterSeq), events: RuntimeEvent[] = []; let nextSeq = afterSeq; for (const entry of entries.slice(0, 100)) {
        const event = await wire(entry), candidate = [...events, event];
        if (new TextEncoder().encode(JSON.stringify({ events: candidate, nextSeq: event.seq })).length > 60000)
            break;
        events.push(event);
        nextSeq = event.seq;
    } return { events, nextSeq }; }
    function make(runId: string, creation: Promise<void>, schemas: Record<string, JsonValue> = {}, limits?: RunLimits) {
        let resolve!: (result: RunResult) => void, reject!: (error: RuntimeError) => void, settled = false, intent = 0, commanding = false, driving: Promise<void> | undefined;
        async function command(fn: () => Promise<void>) { if (commanding)
            throw new RuntimeError('TAB_BUSY'); commanding = true; try {
            await fn();
        }
        finally {
            commanding = false;
        } }
        const result = new Promise<RunResult>((a, b) => { resolve = a; reject = b; });
        void result.catch(() => { });
        const subscriptions = new Set<Subscription>();
        function settle(snapshot: RunSnapshot) { if (!settled && terminal(snapshot.status)) {
            settled = true;
            resolve(structuredClone(snapshot.result!));
        } }
        async function report(sub: Subscription, error: unknown) { sub.active = false; subscriptions.delete(sub); try {
            sub.onError?.(safeError(error));
        }
        catch { } }
        async function deliver(sub: Subscription) { if (sub.busy || !sub.active || disposed)
            return; sub.busy = true; try {
            await creation;
            while (sub.active && !disposed) {
                const batch = await page(runId, sub.cursor);
                for (const event of batch.events) {
                    if (!sub.active || disposed)
                        break;
                    await sub.callback(structuredClone(event));
                    sub.cursor = event.seq;
                }
                if (batch.events.length < 100)
                    break;
            }
        }
        catch (error) {
            await report(sub, error);
        }
        finally {
            sub.busy = false;
        } }
        async function refresh() { if (disposed)
            return; try {
            await creation;
            const snapshot = (await (await ready).get(runId)).snapshot;
            settle(snapshot);
            for (const sub of subscriptions)
                void deliver(sub);
        }
        catch (error) {
            if (!settled) {
                settled = true;
                reject(safeError(error));
            }
            for (const sub of [...subscriptions])
                void report(sub, error);
        } }
        async function runtime() { active(); await creation; active(); return ready; }
        async function launch(start: boolean, token: number) {
            try {
                const r = await runtime();
                if (token !== intent)
                    return;
                if (start)
                    await r.start(runId);
                else {
                    await r.configureLoop(runId, { schemas });
                    if (token !== intent)
                        return;
                    await r.resume(runId);
                }
                if (token === intent)
                    await launchDrive(r, token);
            }
            catch (error) {
                try {
                    const r = await ready, stored = await r.get(runId);
                    if (token === intent && !terminal(stored.snapshot.status) && stored.snapshot.status === 'running')
                        await r.fail(runId, safeError(error).code, stored.generation ?? undefined);
                }
                catch { }
            }
            finally {
                await refresh();
            }
        }
        const handle: RunHandle = { runId, result,
            async snapshot() { return structuredClone((await (await runtime()).get(runId)).snapshot); },
            async events(afterSeq = 0) { await creation; return page(runId, afterSeq); },
            onEvent(callback, opts = {}) { active(); if (typeof callback !== 'function' || subscriptions.size >= 32)
                throw new RuntimeError('POLICY_DENIED'); const sub: Subscription = { cursor: cursor(opts.afterSeq ?? 0), active: true, busy: false, callback, ...(opts.onError ? { onError: opts.onError } : {}) }; subscriptions.add(sub); void deliver(sub); return () => { sub.active = false; subscriptions.delete(sub); }; },
            async pending() { return (await runtime()).pending(runId); },
            async pause() { ++intent; const r = await runtime(); if (!terminal((await r.get(runId)).snapshot.status))
                await r.pause(runId); await refresh(); },
            async cancel() { ++intent; const r = await runtime(); if (!terminal((await r.get(runId)).snapshot.status))
                await r.cancel(runId); await refresh(); },
            async resume(opts={}) { await command(async () => { const token = ++intent, r = await runtime(); await driving; if(opts.schemas)schemas=structuredClone(opts.schemas);if (token !== intent)
                return; await r.configureLoop(runId, { schemas }); if (token !== intent)
                return; await r.resume(runId); if (token === intent)
                void launchDrive(r, token); await refresh(); }); },
            async confirm(input) { await command(async () => { const message = parseRequest({ version: '0.1', requestId: crypto.randomUUID(), type: 'run.confirm', runId, payload: input }, 'ui'); if (!options.uiSender)
                throw new RuntimeError('POLICY_DENIED'); const r = await runtime(), token = intent; await r.confirm(runId, message, options.uiSender()); if (token === intent && (await r.get(runId)).snapshot.status === 'running')
                void launchDrive(r, token); await refresh(); }); }
        };
        function launchDrive(r: TaskRuntime, token: number): Promise<void> { const previous = driving; const current = (async () => { try {
            await previous;
            if (token === intent)
                await r.drive(runId);
        }
        catch { }
        finally {
            await refresh();
        } })(); driving = current; return current; }
        handles.set(runId, { handle, refresh, close() { ++intent; for (const sub of subscriptions)
                sub.active = false; subscriptions.clear(); if (!settled) {
                settled = true;
                reject(new RuntimeError('DISCONNECTED'));
            } }, done: () => settled, hasListeners: () => subscriptions.size > 0 });
        void creation.catch(error => { if (!settled) {
            settled = true;
            resolve({ status: 'failed', error: { code: safeError(error).code, message: safeError(error).code, retryable: false } });
        } });
        return { handle, start: () => { void launch(true, intent); } };
    }
    function room() { active(); if (handles.size >= 100) {
        for (const [id, h] of handles)
            if (h.done() && !h.hasListeners()) {
                handles.delete(id);
                break;
            }
        if (handles.size >= 100)
            throw new RuntimeError('BUDGET_EXCEEDED');
    } }
    const timer = setInterval(() => { if (polling || disposed)
        return; polling = true; void Promise.allSettled([...handles.values()].map(h => h.refresh())).finally(() => { polling = false; }); }, interval);
    (timer as unknown as {
        unref?: () => void;
    }).unref?.();
    const publicReady = ready.then(() => undefined);
    void publicReady.catch(() => { });
    return { ready: publicReady,
        async recover(){active();return (await ready).recover();},
        async history(){active();await ready;return options.store.transact(s=>[...s.runs.values()].map(r=>({runId:r.snapshot.runId,tabId:r.snapshot.tabId,goal:r.snapshot.goal.length>80?r.snapshot.goal.slice(0,79)+'…':r.snapshot.goal,status:r.snapshot.status,updatedAt:r.snapshot.updatedAt,reason:r.reason,unknownActionId:[...s.actions.values()].find(a=>a.runId===r.snapshot.runId&&a.stage==='unknown'&&!a.acknowledged)?.actionId??null})).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)));},
        async deleteRun(id:string){active();await (await ready).delete(id);const h=handles.get(id);h?.close();handles.delete(id);},
        async notifyInput(tabId:number,source:'program'|'user'|'unknown'){active();await (await ready).notifyInput(tabId,source);},
        async acknowledgeUnknown(id:string,actionId:string){active();await (await ready).acknowledgeUnknown(id,actionId);},
        run(input: RunInput) {
            room();
            if (!input || typeof input !== 'object' || Object.keys(input).some(k => !['goal', 'tabId', 'schemas', 'limits', 'completionConditions'].includes(k)))
                throw new RuntimeError('MODEL_INVALID_OUTPUT');
            const runId = crypto.randomUUID(), snapshot = parseRunSnapshot({ runId, tabId: input.tabId ?? options.tabId, goal: input.goal, status: 'created', updatedAt: new Date().toISOString() }), schemas = structuredClone(input.schemas ?? {}), limits = parseRunLimits(input.limits ?? {}), completionConditions=structuredClone(input.completionConditions);
            const creation = ready.then(async (r) => { active(); await r.create({ runId, tabId: snapshot.tabId, goal: snapshot.goal }); try {
                await r.configureLoop(runId, { schemas, limits, ...(completionConditions?{completionConditions}:{}) });
            }
            catch (error) {
                await r.fail(runId, safeError(error).code);
            } });
            const made = make(runId, creation, schemas, limits);
            made.start();
            return made.handle;
        },
        async getRun(runId: string, { schemas = {} }: {
            schemas?: Record<string, JsonValue>;
        } = {}) { active(); if (handles.has(runId))
            return handles.get(runId)!.handle; const r = await ready; await r.get(runId); room(); if (handles.has(runId))
            return handles.get(runId)!.handle; const made = make(runId, Promise.resolve(), structuredClone(schemas)); await handles.get(runId)!.refresh(); return made.handle; },
        async dispose() { if (disposed)
            return; disposed = true; clearInterval(timer); for (const h of handles.values())
            h.close(); handles.clear(); await (await ready).dispose(); }
    };
}

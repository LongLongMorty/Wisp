import type { RunSnapshot, ActionResult, ErrorCode } from '@wisp/protocol';
export class RuntimeError extends Error {
    readonly code: ErrorCode;
    constructor(code: ErrorCode) { super(code); this.code = code; this.name = 'RuntimeError'; }
}
export type ActionStage = 'prepared' | 'dispatching' | 'waiting_confirmation' | 'finished' | 'unknown' | 'abandoned' | 'tombstone';
export type StoredAction = {
    actionId: string;
    runId: string;
    hash: string;
    kind: string;
    stage: ActionStage;
    createdAt: number;
    updatedAt: number;
    generation: number;
    sessionId: string;
    result: ActionResult | null;
    acknowledged: boolean;
};
export type StoredRun = {
    loop?: import('./loop.mts').LoopState;
    snapshot: RunSnapshot;
    reason: string;
    sessionId: string | null;
    generation: number | null;
    lastActionId: string | null;
    seq: number;
};
export type Lease = {
    tabId: number;
    runId: string;
    sessionId: string;
    generation: number;
    expiresAt: number;
};
export type JournalEntry = {
    state?: import('@wisp/protocol').RunState;
    seq: number;
    runId: string;
    timestamp: string;
    type: 'run.created' | 'run.state' | 'action.prepared' | 'action.dispatching' | 'action.result' | 'action.recovered' | 'action.reconciled' | 'action.acknowledged' | 'input.interference' | 'step.observed' | 'model.completed' | 'budget.updated' | 'verification.result' | 'confirmation.required';
    metrics?: {
        step: number;
        usage?: import('@wisp/protocol').Usage;
        budget?: import('@wisp/protocol').Budget;
    };
    actionId: string | null;
    reason: string;
};
export type DatabaseState = {
    version: 1;
    runs: Map<string, StoredRun>;
    actions: Map<string, StoredAction>;
    leases: Map<number, Lease>;
    generations: Map<number, number>;
    journal: Map<string, JournalEntry[]>;
};
export type RuntimeStore = {
    transact<T>(fn: (state: DatabaseState) => T): Promise<T>;
    close(): void;
};
export function emptyState(): DatabaseState { return { version: 1, runs: new Map(), actions: new Map(), leases: new Map(), generations: new Map(), journal: new Map() }; }
function validate(v: DatabaseState) {
    if (!v || v.version !== 1 || ![v.runs, v.actions, v.leases, v.generations, v.journal].every(x => x instanceof Map))
        throw new RuntimeError('DISCONNECTED');
}
function synchronous<T>(value: T) {
    if (value && typeof (value as {
        then?: unknown;
    }).then === 'function')
        throw new RuntimeError('POLICY_DENIED');
    return value;
}
export function createMemoryStore(): RuntimeStore {
    let state = emptyState(), closed = false, tail: Promise<unknown> = Promise.resolve();
    return { transact<T>(fn: (state: DatabaseState) => T) {
            const p = tail.then(() => {
                if (closed)
                    throw new RuntimeError('DISCONNECTED');
                const next = structuredClone(state);
                const result = synchronous(fn(next));
                validate(next);
                const cloned = structuredClone(result);
                state = next;
                return cloned;
            });
            tail = p.then(() => undefined, () => undefined);
            return p;
        }, close() { closed = true; } };
}
export async function openIndexedDbStore({ name = 'wisp-runtime-v01', factory = globalThis.indexedDB }: {
    name?: string;
    factory?: IDBFactory;
} = {}): Promise<RuntimeStore> {
    if (!factory || typeof name !== 'string' || !name || name.length > 128)
        throw new RuntimeError('DISCONNECTED');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
        let settled = false;
        const request = factory.open(name, 1);
        request.onupgradeneeded = () => request.result.createObjectStore('state');
        request.onerror = () => { settled = true; reject(new RuntimeError('DISCONNECTED')); };
        request.onblocked = () => { settled = true; reject(new RuntimeError('DISCONNECTED')); };
        request.onsuccess = () => {
            if (settled) {
                request.result.close();
                return;
            }
            resolve(request.result);
        };
    });
    let closed = false;
    db.onversionchange = () => { closed = true; db.close(); };
    return { transact<T>(fn: (state: DatabaseState) => T): Promise<T> {
            if (closed)
                return Promise.reject(new RuntimeError('DISCONNECTED'));
            return new Promise((resolve, reject) => {
                let result: T, error: unknown;
                let transaction: IDBTransaction;
                try {
                    transaction = db.transaction('state', 'readwrite', { durability: 'strict' });
                }
                catch {
                    reject(new RuntimeError('DISCONNECTED'));
                    return;
                }
                const store = transaction.objectStore('state'), request = store.get('root');
                transaction.oncomplete = () => resolve(result);
                transaction.onabort = () => reject(error instanceof RuntimeError ? error : new RuntimeError('DISCONNECTED'));
                transaction.onerror = () => { };
                request.onsuccess = () => {
                    try {
                        const state = (request.result as DatabaseState | undefined) || emptyState();
                        validate(state);
                        result = structuredClone(synchronous(fn(state)));
                        validate(state);
                        store.put(state, 'root');
                    }
                    catch (e) {
                        error = e;
                        transaction.abort();
                    }
                };
            });
        }, close() { closed = true; db.close(); } };
}

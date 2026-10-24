import type { Target } from '@wisp/protocol';
export type ConnectedNode = {
    isConnected: boolean;
};
export type ReferenceRegistry<T extends ConnectedNode> = {
    reference(node: T): string;
    publish(observationId: string, refs: readonly string[]): void;
    resolve(target: Target): T;
    invalidate(predicate: (node: T) => boolean): void;
    collect(): void;
    dispose(): void;
    size(): number;
};
export function createReferenceRegistry<T extends ConnectedNode>({ documentId, frameId, maxObservations = 8, maxEntries = 2048, id = () => crypto.randomUUID() }: {
    documentId: string;
    frameId: string;
    maxObservations?: number;
    maxEntries?: number;
    id?: () => string;
}): ReferenceRegistry<T> {
    const entries = new Map<string, T>(), byNode = new WeakMap<T, string>(), scopes = new Map<string, Set<string>>();
    let disposed = false;
    function fail(code: string): never { throw Object.assign(new Error(code), { code }); }
    if (!Number.isInteger(maxObservations) || maxObservations < 1 || maxObservations > 8 || !Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 2048)
        fail('BUDGET_EXCEEDED');
    function active() {
        if (disposed)
            fail('DISCONNECTED');
    }
    function collect() {
        const retained = new Set([...scopes.values()].flatMap(set => [...set]));
        for (const ref of entries.keys())
            if (!retained.has(ref))
                entries.delete(ref);
    }
    return {
        reference(node) {
            active();
            if (!node.isConnected)
                fail('STALE_TARGET');
            const known = byNode.get(node);
            if (known && entries.get(known) === node)
                return known;
            if (entries.size >= maxEntries)
                fail('BUDGET_EXCEEDED');
            const ref = id();
            if (entries.has(ref))
                fail('BUDGET_EXCEEDED');
            entries.set(ref, node);
            byNode.set(node, ref);
            return ref;
        },
        publish(observationId, refs) {
            active();
            if (scopes.has(observationId))
                fail('STALE_TARGET');
            for (const ref of refs)
                if (!entries.has(ref))
                    fail('STALE_TARGET');
            scopes.set(observationId, new Set(refs));
            while (scopes.size > maxObservations)
                scopes.delete(scopes.keys().next().value!);
            collect();
        },
        resolve(target) {
            active();
            if (target.documentId !== documentId || target.frameId !== frameId || !scopes.get(target.observationId)?.has(target.ref))
                fail('STALE_TARGET');
            const node = entries.get(target.ref);
            if (!node || !node.isConnected) {
                entries.delete(target.ref);
                fail('STALE_TARGET');
            }
            return node;
        },
        invalidate(predicate) {
            active();
            for (const [ref, node] of entries)
                if (!node.isConnected || predicate(node))
                    entries.delete(ref);
        },
        collect() { active(); collect(); },
        dispose() { disposed = true; entries.clear(); scopes.clear(); }, size() { return entries.size; },
    };
}

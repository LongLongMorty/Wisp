import { ProtocolError, ERROR_CODES, parseRunLimits, parseCondition } from '@wisp/protocol';
export const COMMANDS = ['session.get', 'session.set', 'session.clear', 'tabs.list', 'origin.grant', 'origin.revoke', 'history.list', 'run.start', 'run.get', 'run.events', 'run.pause', 'run.resume', 'run.cancel', 'run.confirm', 'run.takeover', 'run.delete', 'run.acknowledge'] as const;
export type Command = typeof COMMANDS[number];
export type PanelRequest = {
    version: '0.1';
    requestId: string;
    type: Command;
    payload: Record<string, unknown>;
};
export function fields(v: unknown, required: string[], optional: string[] = []): asserts v is Record<string, unknown> { if (!v || typeof v !== 'object' || Array.isArray(v) || ![Object.prototype, null].includes(Object.getPrototypeOf(v)) || Object.getOwnPropertySymbols(v).length)
    throw new ProtocolError('Invalid panel fields'); for (const [key, d] of Object.entries(Object.getOwnPropertyDescriptors(v)))
    if (![...required, ...optional].includes(key) || !('value' in d) || !d.enumerable)
        throw new ProtocolError('Invalid panel fields'); if (required.some(k => !Object.hasOwn(v, k)))
    throw new ProtocolError('Missing panel field'); }
export function text(v: unknown, max = 256): string { if (typeof v !== 'string' || !v.trim() || v.length > max)
    throw new ProtocolError('Invalid panel text'); return v; }
export function exactOrigin(v: unknown) { const value = text(v, 4096); let url: URL; try {
    url = new URL(value);
}
catch {
    throw new ProtocolError('Invalid origin');
} if (!['http:', 'https:'].includes(url.protocol) || url.origin !== value || url.username || url.password)
    throw new ProtocolError('Invalid origin'); return value; }
export function permissionPattern(origin: string) { const u = new URL(exactOrigin(origin)); return u.protocol + '//' + u.hostname + '/*'; }
export function parsePanelRequest(v: unknown): PanelRequest {
    fields(v, ['version', 'requestId', 'type', 'payload']);
    if (v.version !== '0.1' || !COMMANDS.includes(v.type as Command) || !/^[a-zA-Z0-9_-]{1,64}$/.test(text(v.requestId, 64)) || ['__proto__', 'constructor', 'prototype'].includes(v.requestId as string))
        throw new ProtocolError('Invalid panel envelope');
    const type = v.type as Command, p = v.payload;
    if (['session.get', 'session.clear', 'tabs.list', 'history.list'].includes(type))
        fields(p, []);
    else if (type === 'session.set') {
        fields(p, ['endpoint', 'model', 'apiKey', 'jsonMode']);
        text(p.endpoint, 4096);
        text(p.model);
        if (typeof p.apiKey !== 'string' || p.apiKey.length > 4096 || typeof p.jsonMode !== 'boolean')
            throw new ProtocolError('Invalid model settings');
    }
    else if (type.startsWith('origin.')) {
        fields(p, ['origin']);
        exactOrigin(p.origin);
    }
    else if (type === 'run.start') {
        fields(p, ['tabId', 'goal'], ['schemas', 'limits', 'completionConditions']);
        if (!Number.isSafeInteger(p.tabId) || (p.tabId as number) < 0)
            throw new ProtocolError('Invalid tab');
        text(p.goal, 8000);
        if(p.completionConditions!==undefined){if(!Array.isArray(p.completionConditions)||p.completionConditions.length>16)throw new ProtocolError('Invalid completion conditions');for(const c of p.completionConditions){if(parseCondition(c).kind==='value')throw new ProtocolError('Transient completion target');}}
        if (p.limits !== undefined)
            parseRunLimits(p.limits);
    }
    else {
        fields(p, ['runId'], type === 'run.events' ? ['afterSeq'] : type === 'run.resume' ? ['schemas'] : type === 'run.confirm' ? ['confirmationId', 'decision'] : type === 'run.acknowledge' ? ['actionId'] : []);
        text(p.runId);
        if (type === 'run.events' && p.afterSeq !== undefined && (!Number.isSafeInteger(p.afterSeq) || (p.afterSeq as number) < 0))
            throw new ProtocolError('Invalid cursor');
        if (type === 'run.confirm') {
            text(p.confirmationId);
            if (!['approve', 'reject'].includes(p.decision as string))
                throw new ProtocolError('Invalid decision');
        }
        if (type === 'run.acknowledge')
            text(p.actionId);
    }
    if (JSON.stringify(v).length > 64000 || new TextEncoder().encode(JSON.stringify(v)).length > 65536)
        throw new ProtocolError('Panel request too large');
    return v as PanelRequest;
}
export function errorCode(error: unknown) { return error && typeof error === 'object' && 'code' in error && ERROR_CODES.includes(error.code as any) ? error.code as typeof ERROR_CODES[number] : 'DISCONNECTED'; }

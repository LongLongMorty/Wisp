export const PROTOCOL_VERSION = '0.1';
export const MAX_PAYLOAD_BYTES = 65536;
export const ERROR_CODES = Object.freeze([
    'STALE_TARGET', 'NOT_ACTIONABLE', 'UNSUPPORTED_CAPABILITY', 'PERMISSION_DENIED',
    'POLICY_DENIED', 'TIMEOUT', 'ABORTED', 'OUTCOME_UNKNOWN', 'MODEL_INVALID_OUTPUT',
    'BUDGET_EXCEEDED', 'TAB_BUSY', 'DISCONNECTED', 'AMBIGUOUS_TARGET',
] as const);
export type ErrorCode = (typeof ERROR_CODES)[number];
export class ProtocolError extends Error {
    readonly code = 'MODEL_INVALID_OUTPUT' as const;
    constructor(message: string) { super(message); this.name = 'ProtocolError'; }
}
export function fail(path: string): never { throw new ProtocolError('Invalid protocol field: ' + path); }
export function object(value: unknown, required: readonly string[], optional: readonly string[], path: string): asserts value is Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        fail(path);
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Object.getOwnPropertySymbols(value).length)
        fail(path);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const [key, descriptor] of Object.entries(descriptors)) {
        if (!descriptor.enumerable || !('value' in descriptor) || ![...required, ...optional].includes(key))
            fail(path + '.fields');
    }
    for (const key of required)
        if (!Object.hasOwn(value, key))
            fail(path + '.' + key);
}
export function text(value: unknown, path: string, max = 256, allowEmpty = false): string {
    if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim()))
        fail(path);
    return value;
}
export function numeric(value: unknown, path: string, min = -1e9, max = 1e9): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
        fail(path);
    return value;
}
export function integer(value: unknown, path: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
    const n = numeric(value, path, min, max);
    if (!Number.isSafeInteger(n))
        fail(path);
    return n;
}
export function boolean(value: unknown, path: string): boolean { if (typeof value !== 'boolean')
    fail(path); return value; }
export function choice<const T extends readonly string[]>(value: unknown, values: T, path: string): T[number] {
    if (typeof value !== 'string' || !values.includes(value))
        fail(path);
    return value as T[number];
}
export function httpUrl(value: unknown, path: string): string {
    const valid = text(value, path, 4096);
    let url: URL;
    try {
        url = new URL(valid);
    }
    catch {
        fail(path);
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
        fail(path);
    return valid;
}
export function origin(value: unknown, path: string): string {
    const valid = httpUrl(value, path);
    if (new URL(valid).origin !== valid)
        fail(path);
    return valid;
}
export function utc(value: unknown, path: string): string {
    const valid = text(value, path, 32);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(valid))
        fail(path);
    const date = new Date(valid);
    const normalized = valid.includes('.') ? valid : valid.replace('Z', '.000Z');
    if (!Number.isFinite(date.getTime()) || date.toISOString() !== normalized)
        fail(path);
    return valid;
}
export function list<T>(value: unknown, parse: (value: unknown) => T, path: string, max = 200, min = 0): T[] {
    if (!Array.isArray(value) || value.length > max || value.length < min)
        fail(path);
    return Array.from(value, parse);
}
export function unique<T>(values: T[], path: string): T[] { if (new Set(values).size !== values.length)
    fail(path); return values; }
export function sized<T>(value: T, path: string, maxChars = Number.MAX_SAFE_INTEGER): T {
    const json = JSON.stringify(value);
    if (json.length > maxChars || new TextEncoder().encode(json).byteLength > MAX_PAYLOAD_BYTES)
        fail(path);
    return value;
}
export function decode<T>(json: unknown, parse: (value: unknown) => T): T {
    if (typeof json !== 'string' || new TextEncoder().encode(json).byteLength > MAX_PAYLOAD_BYTES)
        fail('payload');
    let value: unknown;
    try {
        value = JSON.parse(json);
    }
    catch {
        fail('payload.json');
    }
    return parse(value);
}
export type JsonValue = null | boolean | number | string | JsonValue[] | {
    [key: string]: JsonValue;
};
export function jsonValue(value: unknown): JsonValue {
    let nodes = 0;
    function visit(v: unknown, depth: number): JsonValue {
        if (++nodes > 2048 || depth > 8)
            fail('json.complexity');
        if (v === null || typeof v === 'boolean')
            return v;
        if (typeof v === 'string')
            return text(v, 'json.string', 8000, true);
        if (typeof v === 'number')
            return numeric(v, 'json.number', -Number.MAX_VALUE, Number.MAX_VALUE);
        if (Array.isArray(v))
            return list(v, item => visit(item, depth + 1), 'json.array', 2048);
        if (!v || typeof v !== 'object')
            fail('json.value');
        const keys = Object.keys(v);
        object(v, keys, [], 'json.object');
        if (keys.some(key => ['__proto__', 'constructor', 'prototype'].includes(key)))
            fail('json.keys');
        return Object.fromEntries(keys.map(key => [key, visit(v[key], depth + 1)]));
    }
    return sized(visit(value, 0), 'json.size', 24000);
}
